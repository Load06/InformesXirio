"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractZip = extractZip;
exports.extractZipFromBuffer = extractZipFromBuffer;
exports.detectSignalResults = detectSignalResults;
exports.detectInterferenceResults = detectInterferenceResults;
exports.readInterferenceStats = readInterferenceStats;
exports.enrichLayerNames = enrichLayerNames;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const unzipper = __importStar(require("unzipper"));
const study_1 = require("../types/study");
const SIGNAL_TYPES = ['cov', 'bs', 'ol'];
const INTERFERENCE_TYPES = ['rssi', 'rsrq', 'dsnr', 'usnr', 'dth', 'uth'];
/**
 * Extrae un ZIP a un directorio destino.
 * Maneja ZIPs grandes con streaming para no saturar memoria.
 */
async function extractZip(zipPath, destDir) {
    await fs.promises.mkdir(destDir, { recursive: true });
    return new Promise((resolve, reject) => {
        fs.createReadStream(zipPath)
            .pipe(unzipper.Extract({ path: destDir }))
            .on('close', resolve)
            .on('error', reject);
    });
}
/**
 * Extrae un ZIP desde un Buffer a un directorio destino.
 */
async function extractZipFromBuffer(buf, destDir) {
    await fs.promises.mkdir(destDir, { recursive: true });
    const directory = await unzipper.Open.buffer(buf);
    for (const file of directory.files) {
        if (file.type === 'File') {
            const filePath = path.join(destDir, file.path);
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            const content = await file.buffer();
            await fs.promises.writeFile(filePath, content);
        }
    }
}
/**
 * Escanea el directorio de señal y detecta capas y resultados disponibles.
 * Patrones: cov-lyr0.tif, bs-lyr1.tif, ol-lyr0.tif
 */
function detectSignalResults(signalDir, sessionDir) {
    const layers = [];
    const results = [];
    const layerSet = new Set();
    if (!fs.existsSync(signalDir))
        return { layers, results };
    const files = fs.readdirSync(signalDir);
    for (const file of files) {
        if (!file.endsWith('.tif'))
            continue;
        // Detectar tipo y capa
        // Patrones: cov-lyr0.tif, bs-lyr1.tif, ol-lyr0.tif
        const match = file.match(/^(cov|bs|ol)-(.+)\.tif$/);
        if (!match)
            continue;
        const [, type, layerId] = match;
        const relPath = path.relative(sessionDir, path.join(signalDir, file));
        if (!layerSet.has(layerId)) {
            layerSet.add(layerId);
        }
        results.push({
            layer: layerId,
            type,
            label: study_1.RESULT_LABELS[type] || type,
            tifPath: relPath.replace(/\\/g, '/'),
            hasStats: false, // se actualiza en upload.ts según los CSVs de estadísticas cargados
        });
    }
    // Construir lista de capas ordenadas: lyr0, lyr1, ..., luego global
    const lyrIds = [...layerSet].filter(id => id.startsWith('lyr')).sort();
    const globalIds = [...layerSet].filter(id => !id.startsWith('lyr'));
    for (const id of lyrIds) {
        layers.push({ id, name: `Capa ${id}`, isGlobal: false });
    }
    for (const id of globalIds) {
        layers.push({ id, name: id.toUpperCase(), isGlobal: true });
    }
    return { layers, results };
}
/**
 * Escanea el directorio de interferencia y detecta resultados disponibles.
 * Patrones: rssi-lyr0.tif, dsnr-lyr1.tif, etc.
 */
function detectInterferenceResults(interferenceDir, sessionDir) {
    const results = [];
    if (!fs.existsSync(interferenceDir))
        return results;
    const files = fs.readdirSync(interferenceDir);
    for (const file of files) {
        if (!file.endsWith('.tif'))
            continue;
        const relPath = path.relative(sessionDir, path.join(interferenceDir, file));
        // Resultados globales agregados: dthagg.tif, uthagg.tif
        const aggMatch = file.match(/^(dth|uth)agg\.tif$/);
        if (aggMatch) {
            const [, type] = aggMatch;
            results.push({
                layer: 'agg',
                type,
                label: study_1.RESULT_LABELS[type] || type,
                tifPath: relPath.replace(/\\/g, '/'),
                hasStats: false,
            });
            continue;
        }
        // Resultados por capa: rssi-lyrN.tif, dsnr-lyrN.tif, etc.
        const match = file.match(/^(rssi|rsrq|dsnr|usnr|dth|uth)-(.+)\.tif$/);
        if (!match)
            continue;
        const [, type, layerId] = match;
        results.push({
            layer: layerId,
            type,
            label: study_1.RESULT_LABELS[type] || type,
            tifPath: relPath.replace(/\\/g, '/'),
            hasStats: false,
        });
    }
    return results;
}
/**
 * Lee el XML ipto-lyrN.xml del ZIP de interferencia para obtener estadísticas
 * de SINR y Throughput si están disponibles.
 */
async function readInterferenceStats(interferenceDir) {
    const stats = {};
    if (!fs.existsSync(interferenceDir))
        return stats;
    const files = fs.readdirSync(interferenceDir);
    const iptoFiles = files.filter(f => f.startsWith('ipto-') && f.endsWith('.xml'));
    for (const file of iptoFiles) {
        // La capa se extrae del nombre: ipto-lyr0.xml → lyr0
        const match = file.match(/^ipto-(.+)\.xml$/);
        if (!match)
            continue;
        // TODO: parsear XML ipto para extraer percentiles de SINR/Throughput
        // Por ahora se omite — las estadísticas de interferencia no siempre están disponibles
    }
    return stats;
}
/**
 * Actualiza los nombres de las capas usando la información del XML del estudio
 * (que tiene los nombres reales de las bandas).
 */
function enrichLayerNames(layers, xmlLayers) {
    // Intentar mapear lyr0 → n40, lyr1 → n77 basándose en el orden del XML
    const xmlNonGlobal = xmlLayers.filter(l => !l.isGlobal);
    return layers.map((layer, idx) => {
        if (layer.isGlobal)
            return layer;
        const xmlLayer = xmlNonGlobal[idx];
        if (xmlLayer) {
            return { ...layer, name: xmlLayer.name };
        }
        return layer;
    });
}
//# sourceMappingURL=zipExtractor.js.map