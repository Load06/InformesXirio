import { ColorRange, Layer, Sector } from '../types/study';
/**
 * Parsea el formato de color continuo de XIRIO:
 * "-30000:alpha,R,G,B:etiqueta;umbral:alpha,R,G,B:etiqueta;...#0"
 * El primer token con umbral ≤ -10000 es el color de no-dato (transparente).
 */
export declare function parseColorString(colorStr: string): ColorRange;
/**
 * Parsea el formato de color CATEGÓRICO del mejor servidor de XIRIO:
 * "alpha,R,G,B;sectorId:alpha,R,G,B;sectorId:alpha,R,G,B;..."
 *
 * El primer token (sin "id:") es el color de no-dato.
 * Los siguientes asocian un ID entero de sector a un color ARGB.
 * Se almacenan como ColorStops con threshold = sectorId, sin interpolación en uso real
 * (los valores del GeoTIFF son exactamente enteros, así que no habrá mezcla).
 */
export declare function parseBestServerColorString(colorStr: string): ColorRange;
interface ParsedStudy {
    studyName: string;
    serviceName: string;
    area: {
        bottom: number;
        left: number;
        right: number;
        top: number;
    };
    layers: Layer[];
    sectors: Sector[];
    colorRanges: Record<string, ColorRange>;
}
export declare function parseStudyXml(xmlFilePath: string): Promise<ParsedStudy>;
/**
 * Lee mtxbsres.xml del directorio de señal y devuelve un Map de código → nombre de sector.
 * Usa regex sobre el texto crudo para ser robusto ante namespaces y BOM.
 */
export declare function parseBestServerDictionary(signalDir: string): Promise<Map<number, string>>;
/**
 * Busca los colores del mejor servidor en los XML del directorio de señal.
 * Usa búsqueda por regex sobre el texto crudo del XML (sin depender de cómo
 * xml2js nombre los campos, evitando problemas de namespace prefix o BOM).
 *
 * Estrategia:
 *   1. Busca la etiqueta <BestServerColors> (o variantes) por nombre en el texto.
 *   2. Si no la encuentra por nombre, busca el patrón de color categórico
 *      (noDataColor;id:color;id:color;...) en el contenido de cualquier etiqueta.
 */
export declare function parseBestServerColors(signalDir: string): Promise<ColorRange>;
export {};
//# sourceMappingURL=xmlParser.d.ts.map