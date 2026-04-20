import puppeteer from 'puppeteer';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import PizZip from 'pizzip';

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

/**
 * Path to Plantilla.docx:
 *   Dev  (ts-node-dev): __dirname = server/src/services/  → ../../.. → project root
 *   Prod (node dist/):  __dirname = server/dist/services/ → ../../.. → project root
 */
const PLANTILLA_PATH = path.join(__dirname, '..', '..', '..', 'client', 'public', 'PlantillaH.docx');

// Column widths (twips). Content width = 13731 twips (PlantillaH.docx landscape).
const MAP_COL_TWP   = 8925;   // ~65 %
const STATS_COL_TWP = 4806;   // ~35 %
// Effective inner width for nested tables inside the stats cell.
// The stats cell has tcMar left=120 + right=120 → paragraph shading covers 4566 twips.
// Nested tables must match this width or they overflow the title band on the right.
const STATS_INNER_TWP = STATS_COL_TWP - 240; // 4566

// Max image height (twips) to ensure title + image + stats fit on one landscape A4 page.
// Landscape content height ≈ 8799 twips; reserve ~600 for the section title → 8200 safe max.
const MAX_IMG_HEIGHT_TWP = 7800;

// Pixels at 96 dpi for the map column (used for image sizing).
const MAP_COL_PX = Math.round(MAP_COL_TWP / 1440 * 96); // ≈ 393

// EMU (English Metric Units): 1 inch = 914400 EMU; 1 twip = 635 EMU
function twipsToEmu(twips: number): number {
  return Math.round(twips * 635);
}

export interface DocxGenerationOptions {
  sessionId: string;
  selectedResults: Array<{ layer: string; type: string }>;
  colorRanges: Record<string, any>;
  mapOpacity?: number;
  mapTileType?: 'osm' | 'satellite';
  smoothColors?: boolean;
  statsOptions?: Record<string, any>;
  entitySurfaceCorrections?: Record<string, number>;
  startPage?: number;
  sectionNumeral?: number;
  legendPosition?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
}

function applyEntityCorrection(entity: any, corrections: Record<string, number>): any {
  const key = entity.code ?? entity.name ?? '';
  const correctedTotal = corrections[key];
  if (!correctedTotal || correctedTotal <= 0) return entity;
  return {
    ...entity,
    surfaceTotal: correctedTotal,
    surfacePct: (entity.surfaceAbs as number[]).map((abs: number) => (abs / correctedTotal) * 100),
  };
}

// ─── OOXML text helpers ───────────────────────────────────────────────────────

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Single paragraph with optional style and bold text.
 *  When a style is used, auto-numbering inherited from that style is suppressed
 *  via <w:numId w:val="0"/> so that the provided text is used verbatim.
 */
function oPara(text: string, style?: string, bold = false, keepNext = false): string {
  const styleXml    = style ? `<w:pStyle w:val="${style}"/>` : '';
  // Suppress any list numbering that the style may inherit (numId=0 turns it off)
  const noNumXml    = style ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>' : '';
  const keepNextXml = keepNext ? '<w:keepNext/>' : '';
  const rPr         = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>
    <w:pPr>${styleXml}${noNumXml}${keepNextXml}<w:spacing w:before="80" w:after="80"/></w:pPr>
    <w:r>${rPr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>
  </w:p>`;
}

/** Empty paragraph (table cell terminator). */
function oEmptyPara(): string {
  return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>';
}

/** Section title band: purple background (#7030A0) with white bold text. */
function oTitleBand(text: string): string {
  return `<w:p>
    <w:pPr>
      <w:shd w:val="clear" w:color="auto" w:fill="7030A0"/>
      <w:spacing w:before="60" w:after="60"/>
    </w:pPr>
    <w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="FFFFFF"/></w:rPr>
      <w:t xml:space="preserve">${escXml(text)}</w:t>
    </w:r>
  </w:p>`;
}

/** Page-break paragraph. */
function oPageBreak(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

// ─── Image drawing element ────────────────────────────────────────────────────

/**
 * Returns a <w:drawing> inline element for a PNG image.
 * Uses inline namespace declarations for `a:` and `pic:` since they may not
 * be present in the parent document's namespace list.
 */
function oDrawing(rId: string, cxEmu: number, cyEmu: number, id: number, name: string): string {
  const n = escXml(name);
  return `<w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="${cxEmu}" cy="${cyEmu}"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:docPr id="${id}" name="${n}"/>
    <wp:cNvGraphicFramePr>
      <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
    </wp:cNvGraphicFramePr>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="${id}" name="${n}"/>
            <pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${rId}"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>`;
}

// ─── Stats OOXML builders ─────────────────────────────────────────────────────

const NO_BORDERS = `<w:tblBorders>
  <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
</w:tblBorders>`;

const INNER_H_BORDER = `<w:tblBorders>
  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E5DFF0"/>
</w:tblBorders>`;

function tCell(w: number, content: string, align?: string): string {
  const jc = align ? `<w:jc w:val="${align}"/>` : '';
  return `<w:tc>
    <w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>
    <w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${jc}</w:pPr>${content}</w:p>
  </w:tc>`;
}

function tCellBold(w: number, text: string, align?: string): string {
  const jc = align ? `<w:jc w:val="${align}"/>` : '';
  return `<w:tc>
    <w:tcPr>
      <w:tcW w:w="${w}" w:type="dxa"/>
      <w:shd w:val="clear" w:color="auto" w:fill="7030A0"/>
    </w:tcPr>
    <w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${jc}</w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="14"/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>
    </w:p>
  </w:tc>`;
}

function tCellText(w: number, text: string, align?: string): string {
  return tCell(w, `<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`, align);
}

/** Builds a threshold table (population or surface) for a single entity (stats panel). */
function buildThresholdTable(
  title: string,
  thresholds: string[],
  absVals: number[],
  pctVals: number[],
  showAbs: boolean,
  showPct: boolean,
  absLabel: string,
  pctLabel: string,
  totalWidth: number,
): string {
  const thrW  = 1200;
  const absW  = showAbs ? Math.round((totalWidth - thrW) * (showPct ? 0.5 : 1)) : 0;
  const pctW  = showPct ? (totalWidth - thrW - absW) : 0;

  const gridCols = `<w:gridCol w:w="${thrW}"/>` +
    (showAbs ? `<w:gridCol w:w="${absW}"/>` : '') +
    (showPct ? `<w:gridCol w:w="${pctW}"/>` : '');

  let rows = `<w:tr>
    ${tCellBold(thrW, 'Umbral')}
    ${showAbs ? tCellBold(absW, absLabel, 'right') : ''}
    ${showPct ? tCellBold(pctW, pctLabel, 'right') : ''}
  </w:tr>`;

  for (let i = 0; i < thresholds.length; i++) {
    const thr    = thresholds[i];
    const absVal = absVals.length > i
      ? absVals[i].toLocaleString('es-ES', { maximumFractionDigits: 2 })
      : '—';
    const pctVal = pctVals.length > i
      ? `${pctVals[i].toFixed(1)}%`
      : '—';
    rows += `<w:tr>
      ${tCellText(thrW, thr)}
      ${showAbs ? tCellText(absW, absVal, 'right') : ''}
      ${showPct ? tCellText(pctW, pctVal, 'right') : ''}
    </w:tr>`;
  }

  return `${oTitleBand(title)}
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="${totalWidth}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      ${INNER_H_BORDER}
    </w:tblPr>
    <w:tblGrid>${gridCols}</w:tblGrid>
    ${rows}
  </w:tbl>`;
}

/** Leyenda de colores para Mejor Servidor (en la columna de stats). */
function buildBsLegendXml(colorRange: any): string {
  if (!colorRange?.stops?.length) return oEmptyPara();

  const rows = colorRange.stops.map((s: any) => {
    const hex = [s.r, s.g, s.b]
      .map((n: number) => n.toString(16).padStart(2, '0'))
      .join('').toUpperCase();
    return `<w:tr>
      <w:tc>
        <w:tcPr>
          <w:tcW w:w="454" w:type="dxa"/>
          <w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>
        </w:tcPr>
        <w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>
          <w:r><w:t xml:space="preserve"> </w:t></w:r>
        </w:p>
      </w:tc>
      ${tCellText(4112, s.label || 'Sector')}
    </w:tr>`;
  }).join('');

  return `<w:p><w:r><w:rPr><w:b/><w:sz w:val="16"/></w:rPr>
    <w:t>Leyenda — Mejor Servidor</w:t></w:r></w:p>
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="${STATS_INNER_TWP}" w:type="dxa"/>
      <w:tblLayout w:type="fixed"/>
      ${NO_BORDERS}
    </w:tblPr>
    <w:tblGrid>
      <w:gridCol w:w="454"/>
      <w:gridCol w:w="4112"/>
    </w:tblGrid>
    ${rows}
  </w:tbl>`;
}

/** Stats for a single-entity section shown inline in the right panel. */
function buildStatsInlineXml(stats: any, _unit: string | undefined, opts: any, corrections: Record<string, number> = {}): string {
  const entity = applyEntityCorrection(stats.entities[0], corrections);
  if (!entity) return oEmptyPara();

  let xml = '';

  // Totals
  if (opts.showTotals && !stats.isBestServer &&
      (entity.populationTotal !== undefined || entity.surfaceTotal !== undefined)) {
    const rows: string[] = [];
    if (entity.populationTotal !== undefined) {
      rows.push(`<w:tr>
        ${tCellText(2734, 'Población total')}
        ${tCellText(1832, entity.populationTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 }), 'right')}
      </w:tr>`);
    }
    if (entity.surfaceTotal !== undefined) {
      rows.push(`<w:tr>
        ${tCellText(2734, 'Superficie total')}
        ${tCellText(1832, `${entity.surfaceTotal.toLocaleString('es-ES', { maximumFractionDigits: 2 })} km²`, 'right')}
      </w:tr>`);
    }
    xml += `${oTitleBand('Totales')}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="${STATS_INNER_TWP}" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
        ${INNER_H_BORDER}
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="2734"/><w:gridCol w:w="1832"/></w:tblGrid>
      ${rows.join('')}
    </w:tbl>`;
  }

  // Population coverage
  const hasPopData = entity.populationAbs.length > 0 || entity.populationPct.length > 0;
  if (hasPopData && (opts.showPopAbs || opts.showPopPct)) {
    xml += buildThresholdTable(
      'Cobertura de población', stats.thresholds,
      opts.showPopAbs ? entity.populationAbs : [],
      opts.showPopPct ? entity.populationPct : [],
      !!opts.showPopAbs, !!opts.showPopPct,
      'Hab.', '%', STATS_INNER_TWP,
    );
  }

  // Surface coverage
  const hasSurfData = entity.surfaceAbs.length > 0 || entity.surfacePct.length > 0;
  if (hasSurfData && (opts.showSurfAbs || opts.showSurfPct)) {
    xml += buildThresholdTable(
      'Cobertura de superficie', stats.thresholds,
      opts.showSurfAbs ? entity.surfaceAbs : [],
      opts.showSurfPct ? entity.surfacePct : [],
      !!opts.showSurfAbs, !!opts.showSurfPct,
      'km²', '%', STATS_INNER_TWP,
    );
  }

  return xml || oEmptyPara();
}

/** Stats cell XML: decide which component to render. */
function buildStatsCellXml(section: any, colorRanges: Record<string, any>, opts: any, corrections: Record<string, number> = {}): string {
  if (!opts.showStats || !section.includeStats || !section.stats) {
    return oEmptyPara();
  }
  const { stats, type, unit } = section;
  if (stats.isBestServer || type === 'bs') {
    return buildBsLegendXml(colorRanges[type]);
  }
  if (stats.entities.length === 0) {
    return `<w:p><w:r><w:t>Sin estadísticas disponibles.</w:t></w:r></w:p>`;
  }
  if (stats.entities.length > 1 || stats.isBestServer) {
    return `<w:p><w:r><w:t>Estadísticas en página siguiente.</w:t></w:r></w:p>`;
  }
  return buildStatsInlineXml(stats, unit, opts, corrections);
}

/** Returns true if the section needs a separate overflow stats page. */
function needsOverflowPage(section: any, opts: any): boolean {
  return (
    opts.showStats &&
    section.includeStats &&
    !!section.stats &&
    section.stats.entities.length > 0 &&
    (section.stats.isBestServer || section.stats.entities.length > 1)
  );
}

/** Full-width stats tables for the overflow page (multi-entity / BS). */
function buildOverflowXml(stats: any, opts: any, corrections: Record<string, number> = {}): string {
  const { thresholds, isBestServer } = stats;
  const entities = stats.entities.map((e: any) => applyEntityCorrection(e, corrections));
  const fullW = 13731; // content width (twips)

  let xml = '';

  // Totals table
  if (opts.showTotals && !isBestServer) {
    const col0 = 2400; // entity name
    const col1 = Math.round((fullW - col0) / 2);
    const col2 = fullW - col0 - col1;

    let rows = `<w:tr>
      ${tCellBold(col0, 'Entidad')}
      ${tCellBold(col1, 'Pob. total', 'right')}
      ${tCellBold(col2, 'Sup. (km²)', 'right')}
    </w:tr>`;
    for (const e of entities) {
      const name = e.name || e.code || '—';
      const pop  = e.populationTotal !== undefined
        ? e.populationTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 }) : '—';
      const surf = e.surfaceTotal !== undefined
        ? e.surfaceTotal.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : '—';
      rows += `<w:tr>
        ${tCellText(col0, name)}
        ${tCellText(col1, pop,  'right')}
        ${tCellText(col2, surf, 'right')}
      </w:tr>`;
    }

    xml += `${oTitleBand('Totales')}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="${fullW}" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
        ${INNER_H_BORDER}
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="${col0}"/>
        <w:gridCol w:w="${col1}"/>
        <w:gridCol w:w="${col2}"/>
      </w:tblGrid>
      ${rows}
    </w:tbl>`;
  }

  // Population
  const showPop = opts.showPopAbs || opts.showPopPct;
  if (showPop && entities.some((e: any) => e.populationAbs.length > 0 || e.populationPct.length > 0)) {
    const entityColW = isBestServer ? 1400 : 1800;
    const thrW       = opts.showPopAbs && opts.showPopPct
      ? Math.floor((fullW - entityColW) / thresholds.length / 2)
      : Math.floor((fullW - entityColW) / thresholds.length);

    const gridCols = `<w:gridCol w:w="${entityColW}"/>` +
      thresholds.map(() => opts.showPopAbs && opts.showPopPct
        ? `<w:gridCol w:w="${thrW}"/><w:gridCol w:w="${thrW}"/>`
        : `<w:gridCol w:w="${thrW}"/>`
      ).join('');

    let rows = `<w:tr>
      ${tCellBold(entityColW, 'Entidad')}`;
    for (const thr of thresholds) {
      if (opts.showPopAbs && opts.showPopPct) {
        rows += `${tCellBold(thrW, `${thr} Hab.`, 'right')}${tCellBold(thrW, `${thr} %`, 'right')}`;
      } else {
        rows += tCellBold(thrW, thr, 'right');
      }
    }
    rows += '</w:tr>';

    for (const e of entities) {
      rows += `<w:tr>${tCellText(entityColW, e.name || e.code || '—')}`;
      for (let j = 0; j < thresholds.length; j++) {
        if (opts.showPopAbs && opts.showPopPct) {
          const abs = (e.populationAbs[j] ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 0 });
          const pct = `${(e.populationPct[j] ?? 0).toFixed(1)}%`;
          rows += `${tCellText(thrW, abs, 'right')}${tCellText(thrW, pct, 'right')}`;
        } else if (opts.showPopAbs) {
          rows += tCellText(thrW, (e.populationAbs[j] ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 0 }), 'right');
        } else {
          rows += tCellText(thrW, `${(e.populationPct[j] ?? 0).toFixed(1)}%`, 'right');
        }
      }
      rows += '</w:tr>';
    }

    xml += `${oTitleBand('Cobertura de población')}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="${fullW}" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
        ${INNER_H_BORDER}
      </w:tblPr>
      <w:tblGrid>${gridCols}</w:tblGrid>
      ${rows}
    </w:tbl>`;
  }

  // Surface
  const showSurf = opts.showSurfAbs || opts.showSurfPct;
  if (showSurf && entities.some((e: any) => e.surfaceAbs.length > 0 || e.surfacePct.length > 0)) {
    const entityColW = 1800;
    const thrW       = opts.showSurfAbs && opts.showSurfPct
      ? Math.floor((fullW - entityColW) / thresholds.length / 2)
      : Math.floor((fullW - entityColW) / thresholds.length);

    const gridCols = `<w:gridCol w:w="${entityColW}"/>` +
      thresholds.map(() => opts.showSurfAbs && opts.showSurfPct
        ? `<w:gridCol w:w="${thrW}"/><w:gridCol w:w="${thrW}"/>`
        : `<w:gridCol w:w="${thrW}"/>`
      ).join('');

    let rows = `<w:tr>
      ${tCellBold(entityColW, 'Entidad')}`;
    for (const thr of thresholds) {
      if (opts.showSurfAbs && opts.showSurfPct) {
        rows += `${tCellBold(thrW, `${thr} km²`, 'right')}${tCellBold(thrW, `${thr} %`, 'right')}`;
      } else {
        rows += tCellBold(thrW, thr, 'right');
      }
    }
    rows += '</w:tr>';

    for (const e of entities) {
      rows += `<w:tr>${tCellText(entityColW, e.name || e.code || '—')}`;
      for (let j = 0; j < thresholds.length; j++) {
        if (opts.showSurfAbs && opts.showSurfPct) {
          const abs = (e.surfaceAbs[j] ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 2 });
          const pct = `${(e.surfacePct[j] ?? 0).toFixed(1)}%`;
          rows += `${tCellText(thrW, abs, 'right')}${tCellText(thrW, pct, 'right')}`;
        } else if (opts.showSurfAbs) {
          rows += tCellText(thrW, (e.surfaceAbs[j] ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 2 }), 'right');
        } else {
          rows += tCellText(thrW, `${(e.surfacePct[j] ?? 0).toFixed(1)}%`, 'right');
        }
      }
      rows += '</w:tr>';
    }

    xml += `${oTitleBand('Cobertura de superficie')}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="${fullW}" w:type="dxa"/>
        <w:tblLayout w:type="fixed"/>
        ${INNER_H_BORDER}
      </w:tblPr>
      <w:tblGrid>${gridCols}</w:tblGrid>
      ${rows}
    </w:tbl>`;
  }

  return xml || oEmptyPara();
}

// ─── DOCX assembly ────────────────────────────────────────────────────────────

interface ImageEntry {
  rId:    string;   // relationship ID, e.g. "rIdImg1"
  buffer: Buffer;   // PNG screenshot
  cxEmu:  number;   // width in EMU
  cyEmu:  number;   // height in EMU
  id:     number;   // unique docPr id
  name:   string;   // e.g. "Map1"
}

/**
 * Extracts the <w:sectPr>...</w:sectPr> block from document.xml text.
 * Falls back to a minimal sectPr if not found.
 */
function extractSectPr(docXml: string): string {
  const m = docXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  return m ? m[0] : '<w:sectPr/>';
}

/**
 * Extracts the opening <w:document ...> tag (possibly multiline).
 */
function extractDocOpenTag(docXml: string): string {
  // The opening tag ends with the first '>' that belongs to <w:document>
  // It spans many characters because of all the xmlns declarations.
  const start = docXml.indexOf('<w:document');
  if (start === -1) return '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  const end = docXml.indexOf('>', start);
  return docXml.substring(start, end + 1);
}

/**
 * Injects image relationships into word/_rels/document.xml.rels.
 */
function addImageRels(relsXml: string, images: ImageEntry[]): string {
  const insertions = images
    .map(img => `<Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.name}.png"/>`)
    .join('');
  return relsXml.replace('</Relationships>', `${insertions}</Relationships>`);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateDocx(options: DocxGenerationOptions): Promise<Buffer> {
  const { sessionId } = options;

  const DEFAULT_STATS: Record<string, any> = {
    showStats: true, showTotals: true,
    showPopAbs: true, showPopPct: true,
    showSurfAbs: true, showSurfPct: true,
    greenThreshold: 95,
  };
  const statsOptions = { ...DEFAULT_STATS, ...(options.statsOptions ?? {}) };
  const entitySurfaceCorrections: Record<string, number> = options.entitySurfaceCorrections ?? {};
  const sectionNumeral = options.sectionNumeral ?? 4;

  // ── 1. Read session metadata (needed before Puppeteer for labels) ─────────
  const sessionDir = path.join(os.tmpdir(), `xirio-${sessionId}`);
  const metadata: any = JSON.parse(
    fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8')
  );

  // Merge color ranges (request overrides metadata)
  const colorRanges: Record<string, any> = {
    ...metadata.colorRanges,
    ...options.colorRanges,
  };

  // Build ordered list of result sections (same order as report page)
  const selectedSet = new Set(
    options.selectedResults.map((r) => `${r.layer}-${r.type}`)
  );
  const statsIncludedMap = new Map<string, boolean>();
  options.selectedResults.forEach((r) => {
    statsIncludedMap.set(`${r.layer}-${r.type}`, true);
  });

  const layerOrder = metadata.layers.map((l: any) => l.id) as string[];

  interface ResultSection {
    layerId:      string;
    layerName:    string;
    type:         string;
    label:        string;
    unit?:        string;
    stats:        any;
    includeStats: boolean;
    sectionNumber: string;
  }

  const RESULT_LABELS: Record<string, string> = {
    cov: 'SS-RSRP', bs: 'Mejor Servidor', ol: 'Solapam.',
    rssi: 'RSSI', rsrq: 'SS-RSRQ', dsnr: 'DL-SINR', usnr: 'UL-SINR',
    dth: 'TH DL', uth: 'TH UL',
  };
  const RESULT_UNITS: Record<string, string> = {
    cov: 'dBm', rssi: 'dBm', rsrq: 'dB', dsnr: 'dB', usnr: 'dB', dth: 'Mbps', uth: 'Mbps',
  };

  const resultSections: ResultSection[] = [];
  layerOrder.forEach((lid: string, layerIdx: number) => {
    const layer = metadata.layers.find((l: any) => l.id === lid);
    if (!layer) return;

    const layerResults = metadata.availableResults.filter(
      (r: any) => r.layer === lid && selectedSet.has(`${r.layer}-${r.type}`)
    );
    layerResults.forEach((r: any, sectionIdx: number) => {
      resultSections.push({
        layerId:       lid,
        layerName:     layer.name,
        type:          r.type,
        label:         RESULT_LABELS[r.type] || r.type,
        unit:          RESULT_UNITS[r.type],
        stats:         metadata.statistics[`${r.layer}-${r.type}`] || null,
        includeStats:  statsIncludedMap.get(`${r.layer}-${r.type}`) ?? true,
        sectionNumber: `${sectionNumeral}.${layerIdx + 1}.${sectionIdx + 1}`,
      });
    });
  });

  // ── 2. Launch Puppeteer ──────────────────────────────────────────────────
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const images: ImageEntry[] = [];

  try {
    const page = await browser.newPage();
    // Landscape viewport for optimal map screenshot quality
    await page.setViewport({ width: 1587, height: 1123, deviceScaleFactor: 1.5 });
    page.setDefaultNavigationTimeout(180000);
    page.setDefaultTimeout(180000);

    // Force orientation=landscape so maps are rendered at their widest
    const reportUrl = `${CLIENT_URL}/report?session=${sessionId}&config=${encodeURIComponent(
      JSON.stringify({
        selectedResults: options.selectedResults,
        colorRanges:     options.colorRanges,
        mapOpacity:      options.mapOpacity ?? 0.6,
        mapTileType:     options.mapTileType ?? 'osm',
        smoothColors:    options.smoothColors ?? true,
        statsOptions,
        startPage:       options.startPage ?? 1,
        sectionNumeral,
        orientation:     'landscape',
        legendPosition:  options.legendPosition ?? 'bottomright',
      })
    )}`;

    await page.goto(reportUrl, { waitUntil: 'networkidle0' });
    await page.waitForFunction('(window).__REPORT_READY__ === true', { timeout: 120000 });

    // Esperar a que los tiles de OSM terminen de descargarse
    await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 }).catch(() => {});

    // ── 3. Screenshot each map container ─────────────────────────────────
    const mapContainers = await page.$$('.result-map-container');
    let imgCounter = 1;

    for (let i = 0; i < mapContainers.length; i++) {
      const container = mapContainers[i];
      const bbox = await container.boundingBox();
      if (!bbox || bbox.width === 0 || bbox.height === 0) continue;

      const screenshotBuf = await page.screenshot({
        type: 'png',
        clip: {
          x:      bbox.x,
          y:      bbox.y,
          width:  bbox.width,
          height: bbox.height,
        },
      });

      // Compute EMU dimensions: fix width to map column width, scale height.
      // If the proportional height exceeds MAX_IMG_HEIGHT_TWP, scale both axes
      // down proportionally so the image fits on the page without distortion.
      const aspectRatio = bbox.height / bbox.width;
      const cyTwipsUncapped = Math.round(MAP_COL_TWP * aspectRatio);
      const scale = cyTwipsUncapped > MAX_IMG_HEIGHT_TWP
        ? MAX_IMG_HEIGHT_TWP / cyTwipsUncapped
        : 1;
      const cxEmu = twipsToEmu(Math.round(MAP_COL_TWP * scale));
      const cyEmu = twipsToEmu(Math.round(MAP_COL_TWP * aspectRatio * scale));

      images.push({
        rId:    `rIdImg${imgCounter}`,
        buffer: Buffer.from(screenshotBuf),
        cxEmu,
        cyEmu,
        id:     imgCounter,
        name:   `Map${imgCounter}`,
      });
      imgCounter++;
    }
  } finally {
    await browser.close();
  }

  // ── 4. Open Plantilla.docx, extract structure ─────────────────────────────
  const plantillaBuf = fs.readFileSync(PLANTILLA_PATH);
  const zip = new PizZip(plantillaBuf);

  const originalDocXml = zip.file('word/document.xml')!.asText();
  const sectPrXml       = extractSectPr(originalDocXml);
  const docOpenTag      = extractDocOpenTag(originalDocXml);

  // ── 5. Add image files to word/media/ ─────────────────────────────────────
  for (const img of images) {
    zip.file(`word/media/${img.name}.png`, img.buffer);
  }

  // ── 6. Update word/_rels/document.xml.rels ────────────────────────────────
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const updatedRels = addImageRels(relsFile.asText(), images);
    zip.file('word/_rels/document.xml.rels', updatedRels);
  }

  // ── 7. Build body XML ─────────────────────────────────────────────────────
  let bodyXml = '';

  // Study title
  bodyXml += oPara(metadata.studyName, 'ApticaTituloPlantilla1');

  // Sections
  let imageIdx = 0;

  for (const section of resultSections) {
    const sectionTitle = `${section.sectionNumber} ${section.layerName} — ${section.label}`;

    // Section heading — keepNext ensures Word never orphans the title on its own page
    bodyXml += oPara(sectionTitle, 'ApticaTituloPlantilla2', false, true);

    // Get the image for this section
    const img = images[imageIdx++];

    // Stats cell XML
    const statsXml = buildStatsCellXml(
      { ...section, colorRange: colorRanges[section.type] },
      colorRanges,
      statsOptions,
      entitySurfaceCorrections,
    );

    if (img) {
      // 2-column layout table: map | stats
      bodyXml += `<w:tbl>
        <w:tblPr>
          <w:tblW w:w="13731" w:type="dxa"/>
          <w:tblLayout w:type="fixed"/>
          ${NO_BORDERS}
        </w:tblPr>
        <w:tblGrid>
          <w:gridCol w:w="${MAP_COL_TWP}"/>
          <w:gridCol w:w="${STATS_COL_TWP}"/>
        </w:tblGrid>
        <w:tr>
          <w:trPr><w:cantSplit/></w:trPr>
          <w:tc>
            <w:tcPr><w:tcW w:w="${MAP_COL_TWP}" w:type="dxa"/></w:tcPr>
            <w:p>
              <w:r>${oDrawing(img.rId, img.cxEmu, img.cyEmu, img.id, img.name)}</w:r>
            </w:p>
          </w:tc>
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="${STATS_COL_TWP}" w:type="dxa"/>
              <w:tcMar>
                <w:left w:w="120" w:type="dxa"/>
                <w:right w:w="120" w:type="dxa"/>
              </w:tcMar>
            </w:tcPr>
            ${statsXml}
            ${oEmptyPara()}
          </w:tc>
        </w:tr>
      </w:tbl>`;
    } else {
      // No screenshot available — just show stats
      bodyXml += statsXml;
    }

    // Overflow stats page
    if (needsOverflowPage(section, statsOptions)) {
      bodyXml += oPageBreak();
      bodyXml += oPara(`${sectionTitle} — Estadísticas`, 'ApticaTituloPlantilla2');
      bodyXml += buildOverflowXml(section.stats, statsOptions, entitySurfaceCorrections);
    }

    // Page break between sections
    bodyXml += oPageBreak();
  }

  // sectPr (preserves margins, header, footer from template)
  bodyXml += sectPrXml;

  // ── 8. Rebuild document.xml ───────────────────────────────────────────────
  const newDocXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
${docOpenTag}
  <w:body>
${bodyXml}
  </w:body>
</w:document>`;

  zip.file('word/document.xml', newDocXml);

  // ── 9. Return buffer ──────────────────────────────────────────────────────
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
