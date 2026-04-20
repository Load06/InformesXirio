export interface ColorStop {
  threshold: number;
  alpha: number;
  r: number;
  g: number;
  b: number;
  label: string;
}

export interface ColorRange {
  stops: ColorStop[];
  noDataColor: { r: number; g: number; b: number; a: number };
  /** Si true, los valores del GeoTIFF se comparan exactamente con el threshold (mapa categórico, ej. mejor servidor). */
  isCategorical?: boolean;
  /** Multiplicador a aplicar a cada valor del GeoTIFF antes de buscar el color (ej. 0.001 para kbps→Mbps). */
  valueMultiplier?: number;
}

export interface Sector {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  azimuth: number;
  height?: number;
  layer?: string;
}

export interface Layer {
  id: string;
  name: string;
  isGlobal: boolean;
}

export interface AvailableResult {
  layer: string;
  type: string;
  label: string;
  tifPath: string;
  hasStats: boolean;
}

export interface StatsEntity {
  bestServer?: string;
  code?: string;
  name?: string;
  populationTotal?: number;
  surfaceTotal?: number;
  populationAbs: number[];
  populationPct: number[];
  surfaceAbs: number[];
  surfacePct: number[];
}

export interface StatsTable {
  thresholds: string[];
  entities: StatsEntity[];
  isBestServer: boolean;
}

export interface StatsOptions {
  showStats: boolean;        // incluir estadísticas en el informe
  showTotals: boolean;       // P Total / S Total (no aplica a mejor servidor)
  showPopAbs: boolean;
  showPopPct: boolean;
  showSurfAbs: boolean;
  showSurfPct: boolean;
  greenThreshold: number;    // % a partir del cual la barra se pinta de verde (defecto: 95)
}

export interface StudyMetadata {
  sessionId: string;
  studyName: string;
  serviceName: string;
  area: { bottom: number; left: number; right: number; top: number };
  layers: Layer[];
  sectors: Sector[];
  colorRanges: Record<string, ColorRange>;
  availableResults: AvailableResult[];
  statistics: Record<string, StatsTable>;
}

export interface StatRow {
  threshold: string | number;
  percentage: number;
  label?: string;
}

export const RESULT_LABELS: Record<string, string> = {
  cov: 'Señal SS-RSRP',
  bs: 'Mejor Servidor',
  ol: 'Solapamiento',
  rssi: 'RSSI',
  rsrq: 'SS-RSRQ',
  dsnr: 'DL-SINR',
  usnr: 'UL-SINR',
  dth: 'Throughput Teórico DL',
  uth: 'Throughput Teórico UL',
};

export const LEGEND_LABELS: Record<string, string> = {
  cov:  'SS-RSRP',
  bs:   'Mejor Servidor',
  ol:   'Solapam.',
  rssi: 'RSSI',
  rsrq: 'SS-RSRQ',
  dsnr: 'DL-SINR',
  usnr: 'UL-SINR',
  dth:  'TH DL',
  uth:  'TH UL',
};

export type LegendPosition = 'topleft' | 'topright' | 'bottomleft' | 'bottomright';

/** Mapa de correcciones de superficie total por entidad. Clave: entity.code ?? entity.name */
export type EntitySurfaceCorrections = Record<string, number>;

export const RESULT_UNITS: Record<string, string> = {
  cov: 'dBm',
  rssi: 'dBm',
  rsrq: 'dB',
  dsnr: 'dB',
  usnr: 'dB',
  dth: 'Mbps',
  uth: 'Mbps',
};

export const RESULT_ORDER: string[] = ['cov', 'bs', 'ol', 'rssi', 'rsrq', 'dsnr', 'usnr', 'dth', 'uth'];
