import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as path from 'path';
import { ColorRange, ColorStop, Layer, Sector } from '../types/study';

// ─── Parsers de cadenas de color ────────────────────────────────────────────

/**
 * Parsea el formato de color continuo de XIRIO:
 * "-30000:alpha,R,G,B:etiqueta;umbral:alpha,R,G,B:etiqueta;...#0"
 * El primer token con umbral ≤ -10000 es el color de no-dato (transparente).
 */
export function parseColorString(colorStr: string): ColorRange {
  if (!colorStr) return emptyRange();

  const clean = colorStr.replace(/#\d+$/, '').trim();
  const parts = clean.split(';').filter(Boolean);

  const stops: ColorStop[] = [];
  let noDataColor = { r: 200, g: 200, b: 200, a: 0 };

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const threshold = parseFloat(part.substring(0, colonIdx));
    const rest = part.substring(colonIdx + 1);
    const secondColon = rest.indexOf(':');
    const colorPart = secondColon !== -1 ? rest.substring(0, secondColon) : rest;
    const label = secondColon !== -1 ? rest.substring(secondColon + 1) : '';

    const components = colorPart.split(',').map(s => Number(s.trim()));
    if (components.length !== 4) continue;
    const [alpha, r, g, b] = components;

    if (threshold <= -10000) {
      noDataColor = { r, g, b, a: alpha };
    } else {
      stops.push({ threshold, alpha, r, g, b, label });
    }
  }

  stops.sort((a, b) => a.threshold - b.threshold);
  return { stops, noDataColor };
}

/**
 * Parsea el formato de color CATEGÓRICO del mejor servidor de XIRIO:
 * "alpha,R,G,B;sectorId:alpha,R,G,B;sectorId:alpha,R,G,B;..."
 *
 * El primer token (sin "id:") es el color de no-dato.
 * Los siguientes asocian un ID entero de sector a un color ARGB.
 * Se almacenan como ColorStops con threshold = sectorId, sin interpolación en uso real
 * (los valores del GeoTIFF son exactamente enteros, así que no habrá mezcla).
 */
export function parseBestServerColorString(colorStr: string): ColorRange {
  if (!colorStr) return emptyRange();

  const parts = colorStr.trim().split(';').filter(Boolean);
  const stops: ColorStop[] = [];
  let noDataColor = { r: 200, g: 200, b: 200, a: 0 };

  for (const part of parts) {
    const trimmed = part.trim();
    const colonIdx = trimmed.indexOf(':');

    if (colonIdx === -1) {
      // Sin ID → color de no-dato: "alpha,R,G,B"
      const c = trimmed.split(',').map(s => Number(s.trim()));
      if (c.length === 4) noDataColor = { r: c[1], g: c[2], b: c[3], a: c[0] };
    } else {
      // Con ID → "sectorId:alpha,R,G,B"
      const id = parseInt(trimmed.substring(0, colonIdx), 10);
      const c = trimmed.substring(colonIdx + 1).split(',').map(s => Number(s.trim()));
      if (c.length === 4 && !isNaN(id)) {
        stops.push({ threshold: id, alpha: c[0], r: c[1], g: c[2], b: c[3], label: `Sector ${id}` });
      }
    }
  }

  stops.sort((a, b) => a.threshold - b.threshold);
  return { stops, noDataColor, isCategorical: true };
}

function emptyRange(): ColorRange {
  return { stops: [], noDataColor: { r: 200, g: 200, b: 200, a: 0 } };
}

// ─── Parseo del XML del estudio ──────────────────────────────────────────────

interface ParsedStudy {
  studyName: string;
  serviceName: string;
  area: { bottom: number; left: number; right: number; top: number };
  layers: Layer[];
  sectors: Sector[];
  colorRanges: Record<string, ColorRange>;
}

export async function parseStudyXml(xmlFilePath: string): Promise<ParsedStudy> {
  const content = fs.readFileSync(xmlFilePath, 'utf8');
  const parser = new xml2js.Parser({ explicitArray: true, ignoreAttrs: false });
  const result = await parser.parseStringPromise(content);

  const root = result['ObjectRoot'];
  const objects = root['Objects']?.[0];
  const linkObj = objects?.['LinkXirioObject']?.[0];
  const link = linkObj?.['Link']?.[0];

  if (!link) throw new Error('Estructura XML no reconocida');

  const studyName: string = link['Name']?.[0] || 'Estudio';
  const serviceName: string = link['Service']?.[0]?.['Link']?.[0]?.['ServiceName']?.[0] || '5G';

  // Área geográfica
  const areaEl = link['Area']?.[0];
  const area = {
    bottom: parseFloat(areaEl?.['Bottom']?.[0] || '0'),
    left:   parseFloat(areaEl?.['Left']?.[0]   || '0'),
    right:  parseFloat(areaEl?.['Right']?.[0]  || '0'),
    top:    parseFloat(areaEl?.['Top']?.[0]    || '0'),
  };

  /**
   * Lee un campo string de un objeto xml2js directo (sin recursar).
   */
  function field(obj: any, name: string): string {
    const v = obj?.[name]?.[0];
    if (!v) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object' && typeof v._ === 'string') return v._.trim();
    return '';
  }

  /**
   * Busca recursivamente un campo por nombre en todo el árbol XML.
   * Devuelve el primer valor de tipo string que encuentre, en búsqueda en profundidad.
   * Maneja tanto strings planos como objetos { _: "..." } generados por xml2js
   * cuando el elemento tiene atributos XML.
   */
  function findFieldRecursive(obj: any, name: string): string {
    if (!obj || typeof obj !== 'object') return '';
    const v = obj[name]?.[0];
    if (v) {
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'object' && typeof v._ === 'string' && v._.trim()) return v._.trim();
    }
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (Array.isArray(val)) {
        for (const child of val) {
          if (child && typeof child === 'object') {
            const found = findFieldRecursive(child, name);
            if (found) return found;
          }
        }
      }
    }
    return '';
  }

  // Buscar campos de color de forma recursiva para ser robustos ante cualquier
  // estructura XML (MultiCoverage5GParameters puede estar a distintos niveles).
  const colorFields: Record<string, string> = {};
  const COLOR_FIELD_NAMES = [
    'CoverageColors', 'OverlapColors', 'BestServerCustomColors',
    'RSSIColors', 'SS_RSRQColors', 'SSDL_SINRColors', 'SSUL_SINRColors',
    'ThroughputDLColors', 'ThroughputULColors',
  ];
  for (const name of COLOR_FIELD_NAMES) {
    colorFields[name] = findFieldRecursive(link, name);
  }

  /**
   * Para throughput: los thresholds del XML están en kbps (igual que el GeoTIFF),
   * pero la leyenda debe mostrarse en Mbps. Se marca isCategorical:false para
   * evitar el bug de auto-detección con thresholds enteros ≥ 0, y se generan
   * etiquetas en Mbps dividiendo por 1000.
   */
  function toMbpsRange(range: ColorRange): ColorRange {
    return {
      ...range,
      isCategorical: false,
      stops: range.stops.map(s => ({
        ...s,
        label: s.label || String(Math.round(s.threshold / 1000)),
      })),
    };
  }

  const colorRanges: Record<string, ColorRange> = {
    cov:  parseColorString(colorFields['CoverageColors']),
    rssi: parseColorString(colorFields['RSSIColors']),
    rsrq: parseColorString(colorFields['SS_RSRQColors']),
    dsnr: parseColorString(colorFields['SSDL_SINRColors']),
    usnr: parseColorString(colorFields['SSUL_SINRColors']),
    dth:  toMbpsRange(parseColorString(colorFields['ThroughputDLColors'])),
    uth:  toMbpsRange(parseColorString(colorFields['ThroughputULColors'])),
    ol:   parseColorString(colorFields['OverlapColors']),
    bs:   parseBestServerColorString(colorFields['BestServerCustomColors']),
  };

  // Capas y sectores
  const coverages = link['Coverages']?.[0]?.['LinkCoverageStudy'] || [];
  const layerMap = new Map<string, Layer>();
  const sectors: Sector[] = [];

  for (const cov of coverages) {
    const covLink = cov['Link']?.[0];
    if (!covLink) continue;

    const name: string   = field(covLink, 'Name');
    const id             = field(covLink, 'Id') || name;
    const layerRaw: string = field(covLink, 'Layer');

    const txLink = covLink['Tx']?.[0]?.['Link']?.[0];
    const coords = txLink?.['Location']?.[0]?.['Link']?.[0]?.['Coords']?.[0];
    const txRadioEl = txLink?.['Params']?.[0]?.['TxRadioElements']?.[0]?.['TxRadioElement']?.[0];

    let lon = 0, lat = 0;
    if (coords) {
      lon = parseFloat(field(coords, 'x') || '0');
      lat = parseFloat(field(coords, 'y') || '0');
    }
    const azimuth = parseFloat(field(txRadioEl, 'Azimut') || '0');

    sectors.push({ id, name, longitude: lon, latitude: lat, azimuth, layer: layerRaw });

    if (layerRaw && !layerMap.has(layerRaw)) {
      layerMap.set(layerRaw, { id: layerRaw, name: `Banda ${layerRaw}`, isGlobal: false });
    }
  }

  return { studyName, serviceName, area, layers: [...layerMap.values()], sectors, colorRanges };
}

// ─── Diccionario del mejor servidor (mtxbsres.xml) ───────────────────────────

/**
 * Lee mtxbsres.xml del directorio de señal y devuelve un Map de código → nombre de sector.
 * Usa regex sobre el texto crudo para ser robusto ante namespaces y BOM.
 */
export async function parseBestServerDictionary(signalDir: string): Promise<Map<number, string>> {
  const dict = new Map<number, string>();
  if (!fs.existsSync(signalDir)) return dict;

  // Buscar mtxbsres.xml recursivamente
  const allFiles: string[] = [];
  function collectMtx(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectMtx(full);
      else if (entry.name.toLowerCase() === 'mtxbsres.xml') allFiles.push(full);
    }
  }
  collectMtx(signalDir);

  if (allFiles.length === 0) {
    console.log('[XMLParser] mtxbsres.xml: no encontrado');
    return dict;
  }

  const xmlPath = allFiles[0];
  try {
    const raw = fs.readFileSync(xmlPath);
    const content = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF
      ? raw.slice(3).toString('utf8')
      : raw.toString('utf8');

    const itemRegex = /<BestServerItem[\s\S]*?<\/BestServerItem>/g;
    const codeRegex = /<Code>(\d+)<\/Code>/;
    const nameRegex = /<Name>([^<]+)<\/Name>/;

    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(content)) !== null) {
      const item = m[0];
      const codeMatch = item.match(codeRegex);
      const nameMatch = item.match(nameRegex);
      if (codeMatch && nameMatch) {
        dict.set(parseInt(codeMatch[1], 10), nameMatch[1].trim());
      }
    }

    console.log(`[XMLParser] mtxbsres.xml: ${dict.size} sectores en ${path.basename(xmlPath)}`);
  } catch (err) {
    console.warn('[XMLParser] Error leyendo mtxbsres.xml:', err instanceof Error ? err.message : String(err));
  }

  return dict;
}

// ─── Colores del mejor servidor (study.xml dentro del ZIP de señal) ──────────

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
export async function parseBestServerColors(signalDir: string): Promise<ColorRange> {
  if (!fs.existsSync(signalDir)) return emptyRange();

  const allFiles: string[] = [];
  function collectXml(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectXml(full);
      else if (entry.name.endsWith('.xml')) allFiles.push(full);
    }
  }
  collectXml(signalDir);

  // Regex 1: busca etiquetas conocidas (con o sin prefijo de namespace)
  const TAG_REGEX = /<(?:[\w:]*)?BestServer(?:Custom)?Colors[^>]*>\s*([\s\S]*?)\s*<\/(?:[\w:]*)?BestServer(?:Custom)?Colors>/i;

  // Regex 2: patrón de contenido categórico — "alpha,R,G,B;id:alpha,R,G,B;id:..." con ≥5 sectores
  const CONTENT_REGEX = />(\d+,\s*\d+,\s*\d+,\s*\d+(?:;\s*\d+\s*:\s*\d+,\s*\d+,\s*\d+,\s*\d+){5,})</g;

  // Primera pasada: buscar por nombre de etiqueta
  for (const xmlPath of allFiles) {
    try {
      // Quitar BOM UTF-8 si existe
      const raw = fs.readFileSync(xmlPath);
      const content = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF
        ? raw.slice(3).toString('utf8')
        : raw.toString('utf8');

      const m = content.match(TAG_REGEX);
      if (m) {
        const colorStr = m[1].trim();
        const range = parseBestServerColorString(colorStr);
        if (range.stops.length > 0) {
          return range;
        }
      }
    } catch (err) {
      console.warn(`[XMLParser] Error en ${path.basename(xmlPath)}:`, err instanceof Error ? err.message : String(err));
    }
  }

  // Segunda pasada: buscar por patrón de contenido en el texto crudo
  let bestResult: { colorStr: string; count: number; file: string } | null = null;

  for (const xmlPath of allFiles) {
    try {
      const raw = fs.readFileSync(xmlPath);
      const content = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF
        ? raw.slice(3).toString('utf8')
        : raw.toString('utf8');

      CONTENT_REGEX.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CONTENT_REGEX.exec(content)) !== null) {
        const colorStr = m[1].trim();
        const count = (colorStr.match(/\d+\s*:/g) || []).length;
        if (!bestResult || count > bestResult.count) {
          bestResult = { colorStr, count, file: path.basename(xmlPath) };
        }
      }
    } catch { /* silencioso */ }
  }

  if (bestResult) {
    const range = parseBestServerColorString(bestResult.colorStr);
    if (range.stops.length > 0) return range;
  }

  console.log('[XMLParser] BestServerColors: no encontrado en el ZIP de señal');
  return emptyRange();
}
