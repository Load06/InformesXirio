import { fromUrl } from 'geotiff';
import type { GeoTIFF } from 'geotiff';
import type { ColorRange } from '../types/study';
import { getColor } from './colorParser';

export interface GeoTiffBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface RenderedGeoTiff {
  dataUrl: string;
  bounds: GeoTiffBounds;
  width: number;
  height: number;
}

/**
 * Carga y renderiza un GeoTIFF como imagen PNG coloreada.
 * Devuelve un dataURL y las coordenadas geográficas del bbox.
 * @param smooth - true: interpolación entre stops; false: colores estrictos por rango.
 */
export async function renderGeoTiff(
  tifUrl: string,
  colorRange: ColorRange,
  smooth = true
): Promise<RenderedGeoTiff> {
  const tiff: GeoTIFF = await fromUrl(tifUrl, { allowHttp: true });
  const image = await tiff.getImage();

  // Obtener bbox geográfico
  const bbox = image.getBoundingBox(); // [west, south, east, north] en CRS del fichero
  const fileDir = image.fileDirectory;

  // Proyección: asumir WGS84 (EPSG:4326) o Web Mercator (EPSG:3857)
  // XIRIO exporta en WGS84 típicamente
  let [west, south, east, north] = bbox;

  // Si las coordenadas están en metros (Web Mercator), convertir a WGS84
  if (Math.abs(west) > 360 || Math.abs(north) > 90) {
    [west, south] = mercatorToWgs84(west, south);
    [east, north] = mercatorToWgs84(east, north);
  }

  const width = image.getWidth();
  const height = image.getHeight();

  // Leer datos raster
  const rasters = await image.readRasters({ interleave: false });
  const band = rasters[0] as Float32Array | Int16Array | Uint8Array | Int32Array;

  // Obtener nodata value
  const noDataValue = fileDir.GDAL_NODATA
    ? parseFloat(fileDir.GDAL_NODATA)
    : -32768;

  // Debug: muestra rango de valores reales vs umbrales del color range
  {
    let vMin = Infinity, vMax = -Infinity, nonNd = 0;
    const sampleSize = Math.min(band.length, 50000);
    for (let i = 0; i < sampleSize; i++) {
      const v = band[i];
      if (v !== noDataValue && v > -30000) { vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); nonNd++; }
    }
    const stops = colorRange.stops;
    console.log(`[GeoTIFF] ${tifUrl.split('/').pop()} | dtype:${band.constructor.name} | noData:${noDataValue} | nonNdPx:${nonNd} | valRange:[${vMin},${vMax}] | colorStops:${stops.length} [${stops[0]?.threshold}…${stops[stops.length-1]?.threshold}]`);
  }

  // Renderizar a canvas
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const valueMultiplier = colorRange.valueMultiplier ?? 1;

  for (let i = 0; i < band.length; i++) {
    const rawValue = band[i];
    const pixelIdx = i * 4;

    if (rawValue === noDataValue || rawValue <= -30000) {
      // Transparente para sin-dato
      data[pixelIdx] = 0;
      data[pixelIdx + 1] = 0;
      data[pixelIdx + 2] = 0;
      data[pixelIdx + 3] = 0;
    } else {
      const value = rawValue * valueMultiplier;
      const [r, g, b, a] = getColor(value, colorRange, smooth);
      data[pixelIdx] = r;
      data[pixelIdx + 1] = g;
      data[pixelIdx + 2] = b;
      data[pixelIdx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const dataUrl = await blobToDataUrl(blob);

  return {
    dataUrl,
    bounds: { north, south, east, west },
    width,
    height,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convierte coordenadas Web Mercator (EPSG:3857) a WGS84 (EPSG:4326).
 */
function mercatorToWgs84(x: number, y: number): [number, number] {
  const lon = (x / 20037508.34) * 180;
  let lat = (y / 20037508.34) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lon, lat];
}
