import * as fs from 'fs';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { StatsTable, StatsEntity } from '../types/study';

/**
 * Mapeo de prefijo de archivo → tipo de resultado.
 *
 * Solo se incluyen los archivos de resumen (aqXXX-lyrN) y sus variantes
 * de mejor servidor (aqbscov → bs).
 * Los archivos aqbsrssi, aqbsdsnr, etc. (desglose por sector de interferencia)
 * se omiten deliberadamente: no tienen un tipo de resultado propio y
 * colisionarían con las entradas de resumen.
 */
const FILE_TYPE_MAP: Record<string, string> = {
  bscov:   'bs',    // mejor servidor: aqbscov-lyrN → lyrN-bs
  cov:     'cov',   // cobertura señal: aqcov-lyrN → lyrN-cov
  rssi:    'rssi',
  rsrq:    'rsrq',
  dsnr:    'dsnr',
  usnr:    'usnr',
  dth:     'dth',
  uth:     'uth',
  dthagg:  'dth',   // throughput DL global → agg-dth
  uthagg:  'uth',   // throughput UL global → agg-uth
};

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
export async function parseStatisticsZip(
  statsZipPath: string
): Promise<Record<string, StatsTable>> {
  const result: Record<string, StatsTable> = {};

  if (!fs.existsSync(statsZipPath)) return result;

  const directory = await unzipper.Open.file(statsZipPath);

  for (const entry of directory.files) {
    if (entry.type !== 'File') continue;
    const filename = path.basename(entry.path);

    // Patrón: aq<subtype>-<layerRaw>csv.zip  (con guion antes del layer)
    // o bien: aq<subtype>csv.zip  (sin guion, para aggregated como aqdthagg)
    const match = filename.match(/^aq([a-z]+?)(?:-(.+?))?csv\.zip$/i);
    if (!match) continue;

    const [, subtypeRaw, layerRaw] = match;
    const subtype = subtypeRaw.toLowerCase();
    const type = FILE_TYPE_MAP[subtype];
    if (!type) continue;

    // Para aggregated (dthagg, uthagg) la capa es 'agg'
    const layerId = (subtype === 'dthagg' || subtype === 'uthagg')
      ? 'agg'
      : (layerRaw || '').toLowerCase();

    if (!layerId) continue;

    const key = `${layerId}-${type}`;

    try {
      const buf = await entry.buffer();
      const innerDir = await unzipper.Open.buffer(buf);

      for (const innerEntry of innerDir.files) {
        if (innerEntry.type !== 'File') continue;
        if (!innerEntry.path.toLowerCase().endsWith('.csv')) continue;

        const csvBuf = await innerEntry.buffer();
        const table = parseCsvBuffer(csvBuf);

        if (table.entities.length > 0) {
          // Primera entrada válida gana (evita que aqbsXXX sobrescriba aqXXX)
          if (!result[key]) {
            result[key] = table;
          }
          break;
        }
      }
    } catch (err) {
      console.warn(`[StatsParser] Error procesando ${filename}:`, err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}

/**
 * Parsea un CSV de estadísticas de XIRIO y devuelve un StatsTable completo.
 *
 * Codificación: UTF-16 LE con BOM (típico de XIRIO) o UTF-8.
 * Separador: ';'
 * Decimales: coma europea → se convierte a punto.
 *
 * Columnas esperadas (en cualquier orden):
 *   Mejor Servidor, Código, Topónimo,
 *   P Total, P>=<umbral>, %P>=<umbral>,
 *   S Total, S>=<umbral>, %S>=<umbral>
 */
function parseCsvBuffer(buf: Buffer): StatsTable {
  // ── Decodificar encoding ──────────────────────────────────────────────────
  let text: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.slice(2).toString('utf16le');
  } else if (buf[0] === 0xfe && buf[1] === 0xff) {
    text = buf.slice(2).swap16().toString('utf16le');
  } else if (buf.length > 4 && buf[1] === 0x00 && buf[3] === 0x00) {
    text = buf.toString('utf16le');
  } else {
    text = buf.toString('utf8');
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return emptyTable();

  const headers = lines[0].split(';').map((h) => h.trim());

  // ── Detectar índices de columnas ──────────────────────────────────────────
  const idxBestServer = headers.findIndex((h) => /^mejor\s*servidor$/i.test(h));
  const idxCode       = headers.findIndex((h) => /^c[oó]digo$/i.test(h));
  const idxName       = headers.findIndex((h) => /^top[oó]nimo$/i.test(h));
  const idxPTotal     = headers.findIndex((h) => /^p\s+total$/i.test(h));
  const idxSTotal     = headers.findIndex((h) => /^s\s+total$/i.test(h));

  // Columnas de umbrales — detectar por prefijo P>= y S>=
  const colsPAbs: number[] = [];  // índices de P>=
  const colsPPct: number[] = [];  // índices de %P>=
  const colsSAbs: number[] = [];  // índices de S>=
  const colsSPct: number[] = [];  // índices de %S>=
  const thresholdsFromP: string[] = [];
  const thresholdsFromS: string[] = [];

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (/^%P>=/i.test(h)) {
      colsPPct.push(i);
    } else if (/^%S>=/i.test(h)) {
      colsSPct.push(i);
    } else if (/^P>=/i.test(h)) {
      colsPAbs.push(i);
      thresholdsFromP.push(h.substring(1).replace('>=', '≥').replace('<=', '≤').trim());
    } else if (/^S>=/i.test(h)) {
      colsSAbs.push(i);
      thresholdsFromS.push(h.substring(1).replace('>=', '≥').replace('<=', '≤').trim());
    } else if (/^%P\d/i.test(h)) {
      // Throughput format: "%P5 Mbps", "%P10 Mbps"
      colsPPct.push(i);
    } else if (/^%S\d/i.test(h)) {
      colsSPct.push(i);
    } else if (/^P\d/i.test(h)) {
      // Throughput format: "P5 Mbps", "P10 Mbps"
      colsPAbs.push(i);
      thresholdsFromP.push('≥' + h.replace(/^P/i, '').trim());
    } else if (/^S\d/i.test(h)) {
      colsSAbs.push(i);
      thresholdsFromS.push('≥' + h.replace(/^S/i, '').trim());
    }
  }

  // Usar umbrales de P>= si existen, si no de S>=
  const thresholds = thresholdsFromP.length > 0 ? thresholdsFromP : thresholdsFromS;
  const nT = thresholds.length;

  if (nT === 0) return emptyTable();

  const isBestServer = idxBestServer !== -1;

  // ── Parsear filas de datos ────────────────────────────────────────────────
  const entities: StatsEntity[] = [];

  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li].split(';').map((v) => v.trim());
    if (cols.every((c) => c === '')) continue;

    function num(idx: number): number | undefined {
      if (idx < 0 || idx >= cols.length) return undefined;
      const v = cols[idx].replace(',', '.').replace('%', '');
      const n = parseFloat(v);
      return isNaN(n) ? undefined : n;
    }

    function numArr(indices: number[]): number[] {
      return indices.map((i) => num(i) ?? 0);
    }

    entities.push({
      bestServer:      isBestServer ? (cols[idxBestServer] || undefined) : undefined,
      code:            idxCode >= 0 ? (cols[idxCode] || undefined) : undefined,
      name:            idxName >= 0 ? (cols[idxName] || undefined) : undefined,
      populationTotal: num(idxPTotal),
      surfaceTotal:    num(idxSTotal),
      populationAbs:   numArr(colsPAbs),
      populationPct:   numArr(colsPPct),
      surfaceAbs:      numArr(colsSAbs),
      surfacePct:      numArr(colsSPct),
    });
  }

  return { thresholds, entities, isBestServer };
}

function emptyTable(): StatsTable {
  return { thresholds: [], entities: [], isBestServer: false };
}
