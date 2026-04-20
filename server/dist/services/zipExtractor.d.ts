import { AvailableResult, Layer } from '../types/study';
/**
 * Extrae un ZIP a un directorio destino.
 * Maneja ZIPs grandes con streaming para no saturar memoria.
 */
export declare function extractZip(zipPath: string, destDir: string): Promise<void>;
/**
 * Extrae un ZIP desde un Buffer a un directorio destino.
 */
export declare function extractZipFromBuffer(buf: Buffer, destDir: string): Promise<void>;
/**
 * Escanea el directorio de señal y detecta capas y resultados disponibles.
 * Patrones: cov-lyr0.tif, bs-lyr1.tif, ol-lyr0.tif
 */
export declare function detectSignalResults(signalDir: string, sessionDir: string): {
    layers: Layer[];
    results: AvailableResult[];
};
/**
 * Escanea el directorio de interferencia y detecta resultados disponibles.
 * Patrones: rssi-lyr0.tif, dsnr-lyr1.tif, etc.
 */
export declare function detectInterferenceResults(interferenceDir: string, sessionDir: string): AvailableResult[];
/**
 * Lee el XML ipto-lyrN.xml del ZIP de interferencia para obtener estadísticas
 * de SINR y Throughput si están disponibles.
 */
export declare function readInterferenceStats(interferenceDir: string): Promise<Record<string, Array<{
    threshold: string;
    percentage: number;
}>>>;
/**
 * Actualiza los nombres de las capas usando la información del XML del estudio
 * (que tiene los nombres reales de las bandas).
 */
export declare function enrichLayerNames(layers: Layer[], xmlLayers: Layer[]): Layer[];
//# sourceMappingURL=zipExtractor.d.ts.map