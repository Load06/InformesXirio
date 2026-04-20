import { StatsTable } from '../types/study';
/**
 * Procesa el ZIP de estadísticas y devuelve un mapa keyed por `${layerId}-${type}`.
 *
 * Estructura del ZIP:
 *   aqcov-lyr0csv.zip     → señal cobertura, lyr0
 *   aqbscov-lyr0csv.zip   → señal mejor servidor, lyr0
 *   aqrssi-lyr0csv.zip    → interferencia RSSI, lyr0
 *   aqdthaggcsv.zip       → throughput DL global (layer=agg)
 *   ...
 *
 * Cada ZIP anidado contiene un aqReport.csv con los datos.
 */
export declare function parseStatisticsZip(statsZipPath: string): Promise<Record<string, StatsTable>>;
//# sourceMappingURL=statisticsParser.d.ts.map