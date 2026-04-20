import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ColorRange, LegendPosition, Sector } from '../../types/study';
import { renderGeoTiff } from '../../lib/geotiffRenderer';
import { stopToCSS } from '../../lib/colorParser';

const TILE_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

interface MapViewerProps {
  sessionId: string;
  tifPath: string;
  colorRange: ColorRange;
  sectors: Sector[];
  /** Etiqueta del resultado para la leyenda */
  resultLabel: string;
  /** Unidad para la leyenda */
  unit?: string;
  /** Tipo de capa base: 'osm' (default) o 'satellite' (Esri World Imagery) */
  tileType?: 'osm' | 'satellite';
  /** Si true (default), interpola colores entre rangos; si false, colores estrictos por rango */
  smoothColors?: boolean;
  /** Esquina donde se posiciona la leyenda (default: bottomright) */
  legendPosition?: LegendPosition;
  onReady?: () => void;
  className?: string;
}

export function MapViewer({
  sessionId,
  tifPath,
  colorRange,
  sectors,
  resultLabel,
  unit,
  tileType = 'osm',
  smoothColors = true,
  legendPosition = 'bottomright',
  onReady,
  className,
}: MapViewerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Inicializar mapa Leaflet sin capa base (se añade en el efecto de tileType)
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      preferCanvas: true,
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Cambiar capa base cuando cambia tileType
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Eliminar capa base anterior
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
      tileLayerRef.current = null;
    }

    if (tileType === 'satellite') {
      tileLayerRef.current = L.tileLayer(TILE_SATELLITE, {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      }).addTo(map);
    } else {
      tileLayerRef.current = L.tileLayer(TILE_OSM, {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
    }
  }, [tileType]);

  // Cargar y renderizar GeoTIFF cuando cambia tifPath, colorRange o smoothColors
  useEffect(() => {
    if (!mapRef.current || !tifPath) return;
    const map = mapRef.current;

    setLoading(true);
    setError(null);

    const tifUrl = `/api/files/${sessionId}/${tifPath}`;

    renderGeoTiff(tifUrl, colorRange, smoothColors)
      .then(({ dataUrl, bounds }) => {
        // Eliminar overlay anterior
        if (overlayRef.current) {
          overlayRef.current.remove();
          overlayRef.current = null;
        }

        const leafletBounds: L.LatLngBoundsExpression = [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ];

        const overlay = L.imageOverlay(dataUrl, leafletBounds, {
          opacity: 0.85,
          interactive: false,
        }).addTo(map);

        overlayRef.current = overlay;
        map.fitBounds(leafletBounds, { padding: [20, 20] });

        // Dibujar sectores
        drawSectors(map, sectors);

        // Añadir leyenda
        addLegend(map, colorRange, resultLabel, unit, smoothColors, legendPosition);

        setLoading(false);
        onReady?.();
      })
      .catch((err) => {
        console.error('Error renderizando GeoTIFF:', err);
        setError('No se pudo cargar el mapa de cobertura');
        setLoading(false);
        onReady?.();
      });
  }, [sessionId, tifPath, colorRange, smoothColors]);

  return (
    <div className={`map-wrapper ${className || ''}`} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 400 }} />

      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(248,246,251,0.85)',
          zIndex: 1000, borderRadius: 'inherit',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6b1874' }}>
            <div className="animate-spin" style={{
              width: 20, height: 20, border: '2px solid #6b1874',
              borderTopColor: 'transparent', borderRadius: '50%',
            }} />
            <span style={{ fontSize: 13 }}>Cargando mapa...</span>
          </div>
        </div>
      )}

      {error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(255,255,255,0.92)',
          zIndex: 1000, color: '#dc2626', fontSize: 13,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Devuelve la URL del icono PNG para el azimut dado.
 * Redondea al múltiplo de 10 más cercano (0–350).
 * Si el azimut es null/undefined usa tx_viewer_null.png.
 */
function sectorIconUrl(azimuth: number | null | undefined): string {
  if (azimuth == null) return '/images/radio/tx_viewer_null.png';
  const snapped = Math.round(azimuth / 10) * 10 % 360;
  return `/images/radio/tx_viewer_${snapped}.png`;
}

/**
 * Dibuja los sectores usando imágenes PNG orientadas al azimuth.
 * Anchor en (20, 30): centro horizontal y 3/4 vertical de la imagen 40×40.
 */
function drawSectors(map: L.Map, sectors: Sector[]) {
  // Eliminar marcadores de sector anteriores
  map.eachLayer((layer) => {
    if ((layer as any)._isSectorMarker) map.removeLayer(layer);
  });

  for (const sector of sectors) {
    if (!sector.latitude || !sector.longitude) continue;
    if (sector.latitude === 0 && sector.longitude === 0) continue;

    const icon = L.icon({
      iconUrl: sectorIconUrl(sector.azimuth),
      iconSize: [40, 40],
      iconAnchor: [20, 30],
    });

    const marker = L.marker([sector.latitude, sector.longitude], {
      icon,
      title: sector.name,
      zIndexOffset: 1000,
    }).addTo(map);

    (marker as any)._isSectorMarker = true;
  }
}

/**
 * Añade una leyenda al mapa Leaflet con los colores del rango.
 * @param smooth - true: gradiente continuo; false: bloques de color por rango.
 */
function addLegend(map: L.Map, colorRange: ColorRange, title: string, unit?: string, smooth = true, position: LegendPosition = 'bottomright') {
  // Eliminar leyendas anteriores
  map.eachLayer((layer) => {
    if ((layer as any)._isLegend) map.removeLayer(layer);
  });

  const legend = new (L.Control.extend({
    options: { position },
    onAdd() {
      const div = L.DomUtil.create('div', 'map-legend');
      const stops = colorRange.stops;

      if (stops.length === 0) return div;

      // Barra de color: gradiente o bloques según modo
      let colorBarStyle: string;
      if (smooth) {
        const gradientStops = stops.map((s, i) => {
          const pct = ((i / (stops.length - 1)) * 100).toFixed(0);
          return `${stopToCSS(s)} ${pct}%`;
        }).join(', ');
        colorBarStyle = `background:linear-gradient(to top,${gradientStops})`;
      } else {
        const min = stops[0].threshold;
        const max = stops[stops.length - 1].threshold;
        const span = max - min || 1;
        const blockStops = stops.map((s, i) => {
          const pct0 = (1 - (s.threshold - min) / span) * 100;
          const pct1 = i > 0 ? (1 - (stops[i - 1].threshold - min) / span) * 100 : 100;
          return `${stopToCSS(s)} ${pct0.toFixed(1)}%, ${stopToCSS(s)} ${pct1.toFixed(1)}%`;
        }).join(', ');
        colorBarStyle = `background:linear-gradient(to top,${blockStops})`;
      }

      // Etiquetas: todos los stops en modo estricto, o máx/medio/mín en suavizado
      const indices: number[] = smooth
        ? (() => {
            const idx = [stops.length - 1];
            if (stops.length > 2) idx.push(Math.floor(stops.length / 2));
            idx.push(0);
            return idx;
          })()
        : stops.map((_, i) => i);

      const min = stops[0].threshold;
      const max = stops[stops.length - 1].threshold;
      const span = max - min || 1;

      const labelItems = indices.map(i => {
        const s = stops[i];
        const topPct = (1 - (s.threshold - min) / span) * 100;
        const text = s.label || String(s.threshold);
        return `<div style="position:absolute;left:0;top:${topPct.toFixed(1)}%;transform:translateY(-50%);font-size:9px;color:#4a3b5c;font-family:monospace;white-space:nowrap;line-height:1">${text}</div>`;
      }).join('');

      div.innerHTML = `
        <div style="font-size:9.5px;font-weight:700;color:#6b1874;margin-bottom:7px;text-align:center;text-transform:uppercase;letter-spacing:0.4px">${title}${unit ? ` (${unit})` : ''}</div>
        <div style="display:flex;gap:6px;align-items:stretch;height:80px">
          <div style="width:12px;flex-shrink:0;border-radius:3px;border:1px solid #e5dff0;${colorBarStyle}"></div>
          <div style="position:relative;flex:1;min-width:32px">${labelItems}</div>
        </div>`;

      return div;
    },
  }))();

  (legend as any)._isLegend = true;
  legend.addTo(map);
}
