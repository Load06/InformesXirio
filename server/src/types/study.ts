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
  layer?: string; // lyr0, lyr1, ...
}

export interface Layer {
  id: string;       // lyr0, lyr1, ..., 5g (global)
  name: string;     // Banda n40, Banda n77, 5G global
  isGlobal: boolean;
}

export interface AvailableResult {
  layer: string;    // lyr0, lyr1, 5g
  type: string;     // cov, bs, ol, rssi, rsrq, dsnr, usnr, dth, uth
  label: string;    // Señal SS-RSRP, Mejor Servidor, etc.
  tifPath: string;  // path relativo a la sesión
  hasStats: boolean;
}

export interface StatsEntity {
  bestServer?: string;       // columna "Mejor Servidor" (solo BS)
  code?: string;             // columna "Código"
  name?: string;             // columna "Topónimo"
  populationTotal?: number;  // columna "P Total"
  surfaceTotal?: number;     // columna "S Total"
  // arrays paralelos a StatsTable.thresholds:
  populationAbs: number[];   // P>=threshold (habitantes)
  populationPct: number[];   // %P>=threshold
  surfaceAbs: number[];      // S>=threshold (km²)
  surfacePct: number[];      // %S>=threshold
}

export interface StatsTable {
  thresholds: string[];      // ["-105dBm", "-100dBm", ...]
  entities: StatsEntity[];
  isBestServer: boolean;     // true si el CSV tiene columna "Mejor Servidor"
}

export interface StatsOptions {
  showStats: boolean;        // incluir estadísticas en el informe
  showTotals: boolean;       // P Total / S Total (no aplica a mejor servidor)
  showPopAbs: boolean;       // P>=threshold (valores absolutos)
  showPopPct: boolean;       // %P>=threshold
  showSurfAbs: boolean;      // S>=threshold (valores absolutos)
  showSurfPct: boolean;      // %S>=threshold
}

export interface StudyMetadata {
  sessionId: string;
  studyName: string;
  serviceName: string;
  area: { bottom: number; left: number; right: number; top: number };
  layers: Layer[];
  sectors: Sector[];
  colorRanges: Record<string, ColorRange>; // keyed by type: cov, bs, ol, rssi, rsrq, dsnr, usnr, dth, uth
  availableResults: AvailableResult[];
  statistics: Record<string, StatsTable>; // keyed by `${layer}-${type}`
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
