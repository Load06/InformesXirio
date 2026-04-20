"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePdf = generatePdf;
const puppeteer_1 = __importDefault(require("puppeteer"));
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
async function generatePdf(options) {
    const { sessionId } = options;
    const browser = await puppeteer_1.default.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    });
    try {
        const page = await browser.newPage();
        // Viewport según orientación: landscape A4 (~297×210mm) o portrait A4 (~210×297mm) a 96dpi×1.5
        const isPortrait = options.orientation === 'portrait';
        await page.setViewport({
            width: isPortrait ? 1123 : 1587,
            height: isPortrait ? 1587 : 1123,
            deviceScaleFactor: 1.5,
        });
        // Timeout generoso para mapas con tiles OSM
        page.setDefaultNavigationTimeout(180000);
        page.setDefaultTimeout(180000);
        const reportUrl = `${CLIENT_URL}/report?session=${sessionId}&config=${encodeURIComponent(JSON.stringify({
            selectedResults: options.selectedResults,
            colorRanges: options.colorRanges,
            mapOpacity: options.mapOpacity ?? 0.6,
            mapTileType: options.mapTileType ?? 'osm',
            smoothColors: options.smoothColors ?? true,
            statsOptions: options.statsOptions ?? {
                showStats: true, showTotals: true, showPopAbs: false, showPopPct: false,
                showSurfAbs: false, showSurfPct: true, greenThreshold: 95,
            },
            entitySurfaceCorrections: options.entitySurfaceCorrections ?? {},
            startPage: options.startPage ?? 1,
            sectionNumeral: options.sectionNumeral ?? 4,
            orientation: options.orientation ?? 'landscape',
            legendPosition: options.legendPosition ?? 'bottomright',
        }))}`;
        await page.goto(reportUrl, { waitUntil: 'networkidle0' });
        // Esperar a que todos los mapas terminen de renderizar
        await page.waitForFunction('(window).__REPORT_READY__ === true', { timeout: 120000 });
        // Esperar a que los tiles de OSM terminen de descargarse
        await page.waitForNetworkIdle({ idleTime: 2000, timeout: 30000 }).catch(() => { });
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            preferCSSPageSize: true, // Usa @page CSS para orientación mixta
        });
        return Buffer.from(pdfBuffer);
    }
    finally {
        await browser.close();
    }
}
//# sourceMappingURL=pdfGenerator.js.map