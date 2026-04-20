/**
 * ReportPage.tsx
 * Página renderizada por Puppeteer para generar el PDF.
 * URL: /report?session=<id>&config=<JSON>
 *
 * Estructura del PDF:
 *  - Portada (portrait)
 *  - Secciones 1, 2, 3 (portrait, parcialmente con datos del XML)
 *  - Sección 4 por cada resultado seleccionado (landscape)
 *    Layout landscape: [mapa 65%] [estadísticas 35%]
 */
import { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { RESULT_LABELS, LEGEND_LABELS, RESULT_UNITS } from '../types/study';
import type { StudyMetadata, ColorRange, StatsTable, StatsOptions, LegendPosition, EntitySurfaceCorrections, StatsEntity } from '../types/study';
import { renderGeoTiff } from '../lib/geotiffRenderer';
import { stopToCSS } from '../lib/colorParser';
import './ReportPage.css';

// Leer params de la URL
function getUrlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

// Parsear config desde la URL una sola vez (síncrono, disponible desde el primer render)
function parseReportConfig(): ReportConfig {
  try {
    const raw = getUrlParam('config') || '{}';
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return { selectedResults: [], colorRanges: {} };
  }
}

function applyEntityCorrection(entity: StatsEntity, corrections: EntitySurfaceCorrections): StatsEntity {
  const key = entity.code ?? entity.name ?? '';
  const correctedTotal = corrections[key];
  if (!correctedTotal || correctedTotal <= 0) return entity;
  return {
    ...entity,
    surfaceTotal: correctedTotal,
    surfacePct: entity.surfaceAbs.map(abs => (abs / correctedTotal) * 100),
  };
}

const DEFAULT_STATS_OPTIONS: StatsOptions = {
  showStats: true, showTotals: true, showPopAbs: false, showPopPct: false,
  showSurfAbs: false, showSurfPct: true, greenThreshold: 95,
};

interface ReportConfig {
  selectedResults: Array<{ layer: string; type: string; includeStats?: boolean }>;
  colorRanges: Record<string, ColorRange>;
  mapOpacity?: number;
  mapTileType?: 'osm' | 'satellite';
  smoothColors?: boolean;
  statsOptions?: StatsOptions;
  entitySurfaceCorrections?: EntitySurfaceCorrections;
  startPage?: number;
  sectionNumeral?: number;
  orientation?: 'landscape' | 'portrait';
  legendPosition?: LegendPosition;
}

interface SectionResult {
  layerId: string;
  layerName: string;
  type: string;
  label: string;
  unit?: string;
  tifPath: string;
  mapDataUrl: string | null;
  bounds: { north: number; south: number; east: number; west: number } | null;
  stats: StatsTable | null;
  includeStats: boolean;
}

export function ReportPage() {
  const sessionId = getUrlParam('session') || '';
  // Parsear config síncronamente para que los valores estén disponibles desde el primer render
  const config = parseReportConfig();

  const [metadata, setMetadata] = useState<StudyMetadata | null>(null);
  const [sections, setSections] = useState<SectionResult[]>([]);
  const mapOpacity   = config.mapOpacity ?? 0.6;
  const mapTileType  = config.mapTileType ?? 'osm';
  const statsOptions: StatsOptions = { ...DEFAULT_STATS_OPTIONS, ...(config.statsOptions ?? {}) };
  const entitySurfaceCorrections: EntitySurfaceCorrections = config.entitySurfaceCorrections ?? {};
  const [colorRanges, setColorRanges] = useState<Record<string, ColorRange>>({});
  const startPage     = config.startPage ?? 1;
  const sectionNumeral = config.sectionNumeral ?? 4;
  const orientation   = config.orientation ?? 'landscape';
  const legendPosition = config.legendPosition ?? 'bottomright';
  const [ready, setReady] = useState(false);

  useEffect(() => {
    axios.get<StudyMetadata>(`/api/files/${sessionId}/metadata.json`)
      .then(async ({ data }) => {
        setMetadata(data);

        const merged: ReportConfig['colorRanges'] = {
          ...data.colorRanges,
          ...config.colorRanges,
        };
        setColorRanges(merged);

        const selectedSet = new Set(
          config.selectedResults.map((r) => `${r.layer}-${r.type}`)
        );
        const statsIncludedMap = new Map(
          config.selectedResults.map((r) => [`${r.layer}-${r.type}`, r.includeStats ?? true])
        );

        // Filtrar y ordenar resultados
        const toRender = data.availableResults.filter((r) =>
          selectedSet.has(`${r.layer}-${r.type}`)
        );

        // Renderizar GeoTIFFs en paralelo (lotes de 3 para no saturar)
        const results: SectionResult[] = [];
        for (let i = 0; i < toRender.length; i += 3) {
          const batch = toRender.slice(i, i + 3);
          const rendered = await Promise.all(
            batch.map(async (r) => {
              const colorRange = merged[r.type] || { stops: [], noDataColor: { r: 128, g: 128, b: 128, a: 0 } };
              const tifUrl = `/api/files/${sessionId}/${r.tifPath}`;
              let mapDataUrl: string | null = null;
              let bounds = null;

              try {
                const res = await renderGeoTiff(tifUrl, colorRange, config.smoothColors ?? true);
                mapDataUrl = res.dataUrl;
                bounds = res.bounds;
              } catch (err) {
                console.warn(`No se pudo renderizar ${r.tifPath}:`, err);
              }

              const layer = data.layers.find((l) => l.id === r.layer);
              return {
                layerId: r.layer,
                layerName: layer?.name || r.layer,
                type: r.type,
                label: RESULT_LABELS[r.type] || r.type,
                unit: RESULT_UNITS[r.type],
                tifPath: r.tifPath,
                mapDataUrl,
                bounds,
                stats: data.statistics[`${r.layer}-${r.type}`] || null,
                includeStats: statsIncludedMap.get(`${r.layer}-${r.type}`) ?? true,
              } as SectionResult;
            })
          );
          results.push(...rendered);
        }

        setSections(results);
        setReady(true);
        (window as any).__REPORT_READY__ = true;
      })
      .catch((err) => {
        console.error('Error cargando metadatos:', err);
        setReady(true);
        (window as any).__REPORT_READY__ = true;
      });
  }, []);

  if (!metadata) {
    return <div className="report-loading">Cargando informe...</div>;
  }

  // Agrupar secciones por capa
  const layerOrder = metadata.layers.map((l) => l.id);
  const sectionsByLayer = layerOrder.map((lid) => ({
    layer: metadata.layers.find((l) => l.id === lid)!,
    sections: sections.filter((s) => s.layerId === lid),
  }));

  // Construir lista plana de páginas para numeración secuencial correcta.
  // Portada = startPage. Las páginas de resultado empiezan en startPage + 1.
  interface PageEntry {
    isStats: boolean;
    section: SectionResult;
    layerIdx: number;
    sectionIdx: number;
    layer: (typeof sectionsByLayer)[0]['layer'];
  }
  const pageEntries: PageEntry[] = [];
  sectionsByLayer.forEach(({ layer, sections: layerSections }, layerIdx) => {
    layerSections.forEach((section, sectionIdx) => {
      pageEntries.push({ isStats: false, section, layerIdx, sectionIdx, layer });
      const needsFullPage = statsOptions.showStats && section.includeStats &&
        section.stats &&
        section.stats.entities.length > 0 &&
        (section.stats.isBestServer || section.stats.entities.length > 1);
      if (needsFullPage) {
        pageEntries.push({ isStats: true, section, layerIdx, sectionIdx, layer });
      }
    });
  });

  return (
    <div className="report">
      {/* ─── PORTADA ─── */}
      <div className="page page-portrait cover-page">
        <div className="cover-content">
          <div className="cover-logo">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <rect width="56" height="56" rx="12" fill="#6b1874" />
              <path d="M14 42L28 14L42 42" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 33H37" stroke="white" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span className="cover-brand">XIRIO Informes</span>
          </div>
          <h1 className="cover-title">{metadata.studyName}</h1>
          <p className="cover-subtitle">Informe de resultados de simulación {metadata.serviceName}</p>
          <div className="cover-meta">
            <div className="cover-meta-row">
              <span>Fecha:</span>
              <span>{new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
            <div className="cover-meta-row">
              <span>Servicio:</span>
              <span>{metadata.serviceName}</span>
            </div>
            <div className="cover-meta-row">
              <span>Capas:</span>
              <span>{metadata.layers.map((l) => l.name).join(', ')}</span>
            </div>
            <div className="cover-meta-row">
              <span>Sectores:</span>
              <span>{metadata.sectors.filter((s) => s.latitude !== 0).length}</span>
            </div>
          </div>
        </div>
        <div className="page-footer">
          <span>Generado con XIRIO Informes</span>
          <span>Página {startPage}</span>
        </div>
      </div>

      {/* ─── RESULTADOS Y ESTADÍSTICAS (LANDSCAPE) ─── */}
      {pageEntries.map((entry, idx) => {
        const pageNumber = startPage + 1 + idx;
        const sectionNum = `${sectionNumeral}.${entry.layerIdx + 1}.${entry.sectionIdx + 1}`;
        if (entry.isStats) {
          return (
            <StatsTablePage
              key={`${entry.layer.id}-${entry.section.type}-stats`}
              section={entry.section}
              sectionNumber={sectionNum}
              studyName={metadata!.studyName}
              opts={statsOptions}
              corrections={entitySurfaceCorrections}
              pageNumber={pageNumber}
              orientation={orientation}
            />
          );
        }
        return (
          <ResultPage
            key={`${entry.layer.id}-${entry.section.type}`}
            section={entry.section}
            sectionNumber={sectionNum}
            studyName={metadata!.studyName}
            sectors={metadata!.sectors}
            pageNumber={pageNumber}
            mapOpacity={mapOpacity}
            mapTileType={mapTileType}
            statsOptions={statsOptions}
            corrections={entitySurfaceCorrections}
            colorRanges={colorRanges}
            orientation={orientation}
            legendPosition={legendPosition}
          />
        );
      })}

      {!ready && (
        <div className="report-loading">Renderizando mapas...</div>
      )}
    </div>
  );
}

const TILE_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

interface ResultPageProps {
  section: SectionResult;
  sectionNumber: string;
  studyName: string;
  sectors: StudyMetadata['sectors'];
  pageNumber: number;
  mapOpacity?: number;
  mapTileType?: 'osm' | 'satellite';
  statsOptions?: StatsOptions;
  corrections?: EntitySurfaceCorrections;
  colorRanges?: Record<string, ColorRange>;
  orientation?: 'landscape' | 'portrait';
  legendPosition?: LegendPosition;
}

function ResultPage({ section, sectionNumber, studyName, sectors, pageNumber, mapOpacity = 0.6, mapTileType = 'osm', statsOptions = DEFAULT_STATS_OPTIONS, corrections = {}, colorRanges = {}, orientation = 'landscape', legendPosition = 'bottomright' }: ResultPageProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    if (!section.mapDataUrl || !section.bounds) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      keyboard: false,
      zoomSnap: 0,       // zoom fraccional: fitBounds usa el zoom exacto sin redondear
      zoomDelta: 0.5,
    });

    L.tileLayer(mapTileType === 'satellite' ? TILE_SATELLITE : TILE_OSM, {
      maxZoom: 18,
    }).addTo(map);

    const bounds = section.bounds;
    const leafletBounds: L.LatLngBoundsExpression = [
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
    ];

    L.imageOverlay(section.mapDataUrl, leafletBounds, { opacity: mapOpacity }).addTo(map);
    map.fitBounds(leafletBounds, { padding: [4, 4] });

    // Dibujar sectores con iconos PNG orientados al azimuth.
    // Anchor en (20, 30): centro horizontal y 3/4 vertical de la imagen 40×40.
    for (const s of sectors) {
      if (!s.latitude || !s.longitude || (s.latitude === 0 && s.longitude === 0)) continue;
      const snapped = s.azimuth != null ? Math.round(s.azimuth / 10) * 10 % 360 : null;
      const iconUrl = snapped != null
        ? `/images/radio/tx_viewer_${snapped}.png`
        : '/images/radio/tx_viewer_null.png';
      L.marker([s.latitude, s.longitude], {
        icon: L.icon({ iconUrl, iconSize: [40, 40], iconAnchor: [20, 30] }),
      }).addTo(map);
    }

    leafletRef.current = map;
    return () => { map.remove(); leafletRef.current = null; };
  }, [section.mapDataUrl, section.bounds]);

  return (
    <div className={`page ${orientation === 'portrait' ? 'page-portrait' : 'page-landscape'} result-page`}>
      <div className="page-header">
        <span className="page-header-title">{studyName}</span>
        <span className="page-header-section">{sectionNumber} {section.layerName} — {section.label}</span>
      </div>

      <div className="result-layout">
        {/* Mapa */}
        <div className="result-map">
          {section.mapDataUrl && section.bounds ? (
            <div ref={mapRef} className="result-map-container" />
          ) : (
            <div className="result-map-placeholder">
              Mapa no disponible
            </div>
          )}

          {/* Leyenda sobre el mapa — no se muestra para Mejor Servidor (va en panel derecho) */}
          {section.type !== 'bs' && <LegendOverlay section={section} legendPosition={legendPosition} />}
        </div>

        {/* Panel derecho: título + estadísticas o leyenda BS */}
        <div className="result-stats">
          <div className="result-stats-title">
            <div className="result-section-number">{sectionNumber}</div>
            <div>
              <div className="result-layer-name">{section.layerName}</div>
              <div className="result-type-name">{section.label}</div>
            </div>
          </div>

          {section.type === 'bs' ? (
            // Para Mejor Servidor: mostrar leyenda de sectores en el panel derecho
            <BsLegendPanel colorRange={colorRanges[section.type]} />
          ) : statsOptions.showStats && section.includeStats && section.stats && section.stats.entities.length === 1 && !section.stats.isBestServer ? (
            <StatsInline stats={section.stats} unit={section.unit} opts={statsOptions} corrections={corrections} />
          ) : statsOptions.showStats && section.includeStats && section.stats && section.stats.entities.length > 0 ? (
            <p className="no-stats">Estadísticas en página siguiente.</p>
          ) : (
            <p className="no-stats">Sin estadísticas disponibles.</p>
          )}

          <div className="result-stats-logo">
            <img src="/images/Xirio Online_HRes.png" alt="XIRIO Online" />
          </div>
        </div>
      </div>

      <div className="page-footer">
        <span>{studyName}</span>
        <span>Página {pageNumber}</span>
      </div>
    </div>
  );
}

// ─── BsLegendPanel ───────────────────────────────────────────────────────────
// Leyenda de sectores para Mejor Servidor — ocupa el panel derecho en lugar
// de las estadísticas, que siempre van en página separada.
// Usa 1 ó 2 columnas según el número de sectores para aprovechar el espacio.

function BsLegendPanel({ colorRange }: { colorRange?: ColorRange }) {
  if (!colorRange?.stops?.length) return null;

  const stops = colorRange.stops;
  const useTwoCols = stops.length > 12;

  return (
    <div className="bs-legend-panel">
      <div className="bs-legend-title">Leyenda — Mejor Servidor</div>
      <div className={`bs-legend-grid ${useTwoCols ? 'bs-legend-grid-2col' : ''}`}>
        {stops.map((s, i) => (
          <div key={i} className="bs-legend-row">
            <span
              className="bs-legend-swatch"
              style={{ background: `rgb(${s.r},${s.g},${s.b})` }}
            />
            <span className="bs-legend-label">{s.label || `Sector ${i}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendOverlay({ section, legendPosition = 'bottomright' }: { section: SectionResult; legendPosition?: LegendPosition }) {
  // Acceder al colorRange desde la URL config
  const configStr = getUrlParam('config') || '{}';
  let config: ReportConfig = { selectedResults: [], colorRanges: {} };
  try { config = JSON.parse(decodeURIComponent(configStr)); } catch { /* */ }

  // Las colorRanges se cargan en el estado pero aquí las leemos del config
  const range = config.colorRanges?.[section.type];
  if (!range?.stops?.length) return null;

  const barHeight = Math.max(80, range.stops.length * 16);

  const CORNER_STYLE: Record<LegendPosition, React.CSSProperties> = {
    topleft:     { top: 16, left: 12 },
    topright:    { top: 16, right: 12 },
    bottomleft:  { bottom: 16, left: 12 },
    bottomright: { bottom: 16, right: 12 },
  };

  const shortTitle = LEGEND_LABELS[section.type] ?? section.label;

  return (
    <div className="map-legend-overlay" style={CORNER_STYLE[legendPosition]}>
      <div className="legend-title-text">
        {shortTitle}{section.unit ? ` (${section.unit})` : ''}
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'stretch', height: barHeight }}>
        <div className="legend-gradient-bar" style={{
          margin: 0,
          height: barHeight,
          background: `linear-gradient(to top, ${range.stops.map((s: any, i: number) => {
            const pct = ((i / (range.stops.length - 1)) * 100).toFixed(0);
            return `${stopToCSS(s)} ${pct}%`;
          }).join(', ')})`,
        }} />
        <div className="legend-labels-col" style={{ justifyContent: 'space-between' }}>
          {[...range.stops].reverse().map((s: any, i: number) => (
            <span key={i} className="legend-label-text">
              {s.label || s.threshold}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── StatsInline ─────────────────────────────────────────────────────────────
// Estadísticas para entidad única (no BS) — se muestra en el panel derecho
// junto al mapa, divididas en 3 bloques: Totales, Población, Superficie.

interface StatsInlineProps {
  stats: StatsTable;
  unit?: string;
  opts: StatsOptions;
  corrections?: EntitySurfaceCorrections;
}

function StatsInline({ stats, opts, corrections = {} }: StatsInlineProps) {
  const entity = applyEntityCorrection(stats.entities[0], corrections);
  if (!entity) return null;

  const hasPopData = entity.populationAbs.length > 0 || entity.populationPct.length > 0;
  const hasSurfData = entity.surfaceAbs.length > 0 || entity.surfacePct.length > 0;

  return (
    <div className="stats-inline">
      {/* Bloque Totales (no para BS) */}
      {opts.showTotals && !stats.isBestServer && (entity.populationTotal !== undefined || entity.surfaceTotal !== undefined) && (
        <div className="stats-inline-block">
          <div className="stats-block-title">Totales</div>
          <table className="stats-compact-table">
            <tbody>
              {entity.populationTotal !== undefined && (
                <tr>
                  <td className="stats-label-cell">Población total</td>
                  <td className="stats-value-cell">{entity.populationTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</td>
                </tr>
              )}
              {entity.surfaceTotal !== undefined && (
                <tr>
                  <td className="stats-label-cell">Superficie total</td>
                  <td className="stats-value-cell">{entity.surfaceTotal.toLocaleString('es-ES', { maximumFractionDigits: 2 })} km²</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Bloque Población */}
      {hasPopData && (opts.showPopAbs || opts.showPopPct) && (
        <div className="stats-inline-block">
          <div className="stats-block-title">Cobertura de población</div>
          <table className="stats-threshold-table">
            <thead>
              <tr>
                <th>Umbral</th>
                {opts.showPopAbs && <th>Habitantes</th>}
                {opts.showPopPct && <th>%</th>}
              </tr>
            </thead>
            <tbody>
              {stats.thresholds.map((thr, i) => (
                <tr key={i}>
                  <td>{thr}</td>
                  {opts.showPopAbs && <td>{(entity.populationAbs[i] ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}</td>}
                  {opts.showPopPct && (
                    <td>
                      <div className="pct-bar">
                        <div className="pct-fill" style={{
                          width: `${Math.min(entity.populationPct[i] ?? 0, 100)}%`,
                          background: (entity.populationPct[i] ?? 0) >= (opts.greenThreshold ?? 95) ? 'rgba(22,163,74,0.55)' : 'rgba(107,24,116,0.45)',
                        }} />
                        <span className="pct-value">{(entity.populationPct[i] ?? 0).toFixed(1)}%</span>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bloque Superficie */}
      {hasSurfData && (opts.showSurfAbs || opts.showSurfPct) && (
        <div className="stats-inline-block">
          <div className="stats-block-title">Cobertura de superficie</div>
          <table className="stats-threshold-table">
            <thead>
              <tr>
                <th>Umbral</th>
                {opts.showSurfAbs && <th>km²</th>}
                {opts.showSurfPct && <th>%</th>}
              </tr>
            </thead>
            <tbody>
              {stats.thresholds.map((thr, i) => (
                <tr key={i}>
                  <td>{thr}</td>
                  {opts.showSurfAbs && <td>{(entity.surfaceAbs[i] ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>}
                  {opts.showSurfPct && (
                    <td>
                      <div className="pct-bar">
                        <div className="pct-fill" style={{
                          width: `${Math.min(entity.surfacePct[i] ?? 0, 100)}%`,
                          background: (entity.surfacePct[i] ?? 0) >= (opts.greenThreshold ?? 95) ? 'rgba(22,163,74,0.55)' : 'rgba(107,24,116,0.45)',
                        }} />
                        <span className="pct-value">{(entity.surfacePct[i] ?? 0).toFixed(1)}%</span>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── StatsTablePage ───────────────────────────────────────────────────────────
// Página adicional landscape con tabla completa para multi-entidad o BS.

interface StatsTablePageProps {
  section: SectionResult;
  sectionNumber: string;
  studyName: string;
  opts: StatsOptions;
  corrections?: EntitySurfaceCorrections;
  pageNumber: number;
  orientation?: 'landscape' | 'portrait';
}

function StatsTablePage({ section, sectionNumber, studyName, opts, corrections = {}, pageNumber, orientation = 'landscape' }: StatsTablePageProps) {
  const stats = section.stats!;
  const { thresholds, isBestServer } = stats;
  const entities = stats.entities.map(e => applyEntityCorrection(e, corrections));
  const manyThresholds = thresholds.length > 6;

  // Columnas a mostrar según opts: para cada umbral, qué subcolumnas
  const showPopBlock  = opts.showPopAbs || opts.showPopPct;
  const showSurfBlock = opts.showSurfAbs || opts.showSurfPct;

  return (
    <div className={`page ${orientation === 'portrait' ? 'page-portrait' : 'page-landscape'} stats-full-page`}>
      <div className="page-header">
        <span className="page-header-title">{studyName}</span>
        <span className="page-header-section">{sectionNumber} {section.layerName} — {section.label} — Estadísticas</span>
      </div>

      <div className="stats-full-content">
        {/* ── Bloque Totales (no para mejor servidor) ── */}
        {opts.showTotals && !isBestServer && (
          <div className="stats-page-block">
            <div className="stats-page-block-title">Totales</div>
            <table className="stats-full-table">
              <thead>
                <tr>
                  {isBestServer && <th className="col-server">Mejor Servidor</th>}
                  <th className="col-entity">Entidad</th>
                  <th>Población total</th>
                  <th>Superficie total (km²)</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((e, i) => (
                  <tr key={i}>
                    {isBestServer && <td>{e.bestServer || '—'}</td>}
                    <td>{e.name || e.code || '—'}</td>
                    <td>{e.populationTotal !== undefined ? e.populationTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 }) : '—'}</td>
                    <td>{e.surfaceTotal !== undefined ? e.surfaceTotal.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Bloque Población ── */}
        {showPopBlock && entities.some(e => e.populationAbs.length > 0 || e.populationPct.length > 0) && (
          <div className="stats-page-block">
            <div className="stats-page-block-title">Cobertura de población</div>
            <table className={`stats-full-table ${manyThresholds ? 'stats-compact-font' : ''}`}>
              <thead>
                <tr>
                  {isBestServer && <th className="col-server">Mejor Servidor</th>}
                  <th className="col-entity">Entidad</th>
                  {thresholds.map((thr) => (
                    opts.showPopAbs && opts.showPopPct ? (
                      <th key={thr} colSpan={2} className={manyThresholds ? 'th-rotated-parent' : ''}>
                        <span className={manyThresholds ? 'th-rotated' : ''}>{thr}</span>
                      </th>
                    ) : (
                      <th key={thr} className={manyThresholds ? 'th-rotated-parent' : ''}>
                        <span className={manyThresholds ? 'th-rotated' : ''}>{thr}</span>
                      </th>
                    )
                  ))}
                </tr>
                {(opts.showPopAbs || opts.showPopPct) && (opts.showPopAbs && opts.showPopPct) && (
                  <tr className="subheader-row">
                    {isBestServer && <td />}
                    <td />
                    {thresholds.map((thr) => (
                      <>
                        <td key={`${thr}-hab`}>Hab.</td>
                        <td key={`${thr}-pct`}>%</td>
                      </>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {entities.map((e, i) => (
                  <tr key={i}>
                    {isBestServer && <td>{e.bestServer || '—'}</td>}
                    <td>{e.name || e.code || '—'}</td>
                    {thresholds.map((_thr, j) => (
                      <>
                        {opts.showPopAbs && <td key={`${i}-${j}-abs`}>{(e.populationAbs[j] ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}</td>}
                        {opts.showPopPct && <td key={`${i}-${j}-pct`}>{(e.populationPct[j] ?? 0).toFixed(1)}%</td>}
                      </>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Bloque Superficie ── */}
        {showSurfBlock && entities.some(e => e.surfaceAbs.length > 0 || e.surfacePct.length > 0) && (
          <div className="stats-page-block">
            <div className="stats-page-block-title">Cobertura de superficie</div>
            <table className={`stats-full-table ${manyThresholds ? 'stats-compact-font' : ''}`}>
              <thead>
                <tr>
                  {isBestServer && <th className="col-server">Mejor Servidor</th>}
                  <th className="col-entity">Entidad</th>
                  {thresholds.map((thr) => (
                    opts.showSurfAbs && opts.showSurfPct ? (
                      <th key={thr} colSpan={2} className={manyThresholds ? 'th-rotated-parent' : ''}>
                        <span className={manyThresholds ? 'th-rotated' : ''}>{thr}</span>
                      </th>
                    ) : (
                      <th key={thr} className={manyThresholds ? 'th-rotated-parent' : ''}>
                        <span className={manyThresholds ? 'th-rotated' : ''}>{thr}</span>
                      </th>
                    )
                  ))}
                </tr>
                {opts.showSurfAbs && opts.showSurfPct && (
                  <tr className="subheader-row">
                    {isBestServer && <td />}
                    <td />
                    {thresholds.map((thr) => (
                      <>
                        <td key={`${thr}-km`}>km²</td>
                        <td key={`${thr}-pct`}>%</td>
                      </>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {entities.map((e, i) => (
                  <tr key={i}>
                    {isBestServer && <td>{e.bestServer || '—'}</td>}
                    <td>{e.name || e.code || '—'}</td>
                    {thresholds.map((_thr, j) => (
                      <>
                        {opts.showSurfAbs && <td key={`${i}-${j}-abs`}>{(e.surfaceAbs[j] ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>}
                        {opts.showSurfPct && <td key={`${i}-${j}-pct`}>{(e.surfacePct[j] ?? 0).toFixed(1)}%</td>}
                      </>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="page-footer">
        <span>{studyName}</span>
        <span>Página {pageNumber}</span>
      </div>
    </div>
  );
}
