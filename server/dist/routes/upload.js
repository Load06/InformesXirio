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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const uuid_1 = require("uuid");
const xmlParser_1 = require("../services/xmlParser");
const zipExtractor_1 = require("../services/zipExtractor");
const statisticsParser_1 = require("../services/statisticsParser");
const router = (0, express_1.Router)();
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        const uploadDir = path.join(os.tmpdir(), 'xirio-uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${(0, uuid_1.v4)()}${ext}`);
    },
});
const upload = (0, multer_1.default)({ storage, limits: { fileSize: 600 * 1024 * 1024 } });
const uploadFields = upload.fields([
    { name: 'xml', maxCount: 1 },
    { name: 'signalZip', maxCount: 1 },
    { name: 'interferenceZip', maxCount: 1 },
    { name: 'statsZip', maxCount: 1 },
    { name: 'statsInterferenceZip', maxCount: 1 },
]);
router.post('/', uploadFields, async (req, res) => {
    const files = req.files;
    if (!files?.xml?.[0]) {
        res.status(400).json({ error: 'Se requiere el archivo XML del estudio' });
        return;
    }
    const sessionId = (0, uuid_1.v4)();
    const sessionDir = path.join(os.tmpdir(), `xirio-${sessionId}`);
    await fs.promises.mkdir(sessionDir, { recursive: true });
    try {
        // 1. Parsear XML del estudio (obtiene colores de señal e interferencia)
        const xmlFile = files.xml[0];
        const xmlParsed = await (0, xmlParser_1.parseStudyXml)(xmlFile.path);
        // 2. Extraer ZIPs
        const signalDir = path.join(sessionDir, 'signal');
        const interferenceDir = path.join(sessionDir, 'interference');
        if (files.signalZip?.[0]) {
            await (0, zipExtractor_1.extractZip)(files.signalZip[0].path, signalDir);
        }
        if (files.interferenceZip?.[0]) {
            await (0, zipExtractor_1.extractZip)(files.interferenceZip[0].path, interferenceDir);
        }
        // 3. Colores del mejor servidor: la fuente canónica es BestServerColors en el
        //    study.xml dentro del ZIP de señal. Se usa siempre cuando esté disponible;
        //    si no se encuentra, se mantiene lo que parsó BestServerCustomColors del XML raíz.
        //    Además se leen los nombres reales de sector desde mtxbsres.xml.
        if (files.signalZip?.[0] && fs.existsSync(signalDir)) {
            const bsFromZip = await (0, xmlParser_1.parseBestServerColors)(signalDir);
            if (bsFromZip.stops.length > 0) {
                xmlParsed.colorRanges.bs = bsFromZip;
                console.log(`[Upload] BestServerColors del ZIP: ${bsFromZip.stops.length} sectores`);
            }
            // Actualizar etiquetas con nombres reales de sector desde mtxbsres.xml
            const bsDict = await (0, xmlParser_1.parseBestServerDictionary)(signalDir);
            if (bsDict.size > 0 && xmlParsed.colorRanges.bs.stops.length > 0) {
                xmlParsed.colorRanges.bs = {
                    ...xmlParsed.colorRanges.bs,
                    stops: xmlParsed.colorRanges.bs.stops.map(stop => ({
                        ...stop,
                        label: bsDict.get(stop.threshold) ?? stop.label,
                    })),
                };
                console.log(`[Upload] BS labels actualizados con nombres de ${bsDict.size} sectores`);
            }
        }
        // 4. Detectar resultados disponibles en los ZIPs
        const { layers: signalLayers, results: signalResults } = (0, zipExtractor_1.detectSignalResults)(signalDir, sessionDir);
        const interferenceResults = (0, zipExtractor_1.detectInterferenceResults)(interferenceDir, sessionDir);
        // 5. Construir lista de capas
        const enrichedLayers = (0, zipExtractor_1.enrichLayerNames)(signalLayers, xmlParsed.layers);
        const allLayers = [...enrichedLayers.filter(l => !l.isGlobal)];
        const globalLayerFromSignal = signalLayers.find(l => l.isGlobal);
        if (globalLayerFromSignal) {
            allLayers.push({ ...globalLayerFromSignal, name: `${xmlParsed.serviceName} Global` });
        }
        else if (xmlParsed.layers.length > 0) {
            const globalId = xmlParsed.serviceName.toLowerCase().replace(/\s+/g, '');
            allLayers.push({ id: globalId, name: `${xmlParsed.serviceName} Global`, isGlobal: true });
        }
        // Capa 'agg' para throughput global de interferencia
        if (interferenceResults.some(r => r.layer === 'agg') && !allLayers.find(l => l.id === 'agg')) {
            allLayers.push({ id: 'agg', name: `${xmlParsed.serviceName} Global (Interferencia)`, isGlobal: true });
        }
        // 6. Parsear estadísticas (señal e interferencia se combinan en el mismo mapa)
        let statistics = {};
        if (files.statsZip?.[0]) {
            statistics = await (0, statisticsParser_1.parseStatisticsZip)(files.statsZip[0].path);
        }
        if (files.statsInterferenceZip?.[0]) {
            const statsInterference = await (0, statisticsParser_1.parseStatisticsZip)(files.statsInterferenceZip[0].path);
            statistics = { ...statistics, ...statsInterference };
        }
        // 7. Combinar resultados y marcar cuáles tienen estadísticas
        const allResults = [...signalResults, ...interferenceResults].map(r => ({
            ...r,
            hasStats: r.hasStats || Boolean(statistics[`${r.layer}-${r.type}`]),
        }));
        // 8. Copiar XML a sesión (para servirlo al frontend si hace falta)
        await fs.promises.copyFile(xmlFile.path, path.join(sessionDir, 'study.xml'));
        // 9. Guardar y devolver metadata
        const metadata = {
            sessionId,
            studyName: xmlParsed.studyName,
            serviceName: xmlParsed.serviceName,
            area: xmlParsed.area,
            layers: allLayers,
            sectors: xmlParsed.sectors,
            colorRanges: xmlParsed.colorRanges,
            availableResults: allResults,
            statistics,
        };
        await fs.promises.writeFile(path.join(sessionDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
        res.json(metadata);
    }
    catch (err) {
        console.error('Error procesando archivos:', err);
        res.status(500).json({ error: 'Error al procesar los archivos' });
    }
    finally {
        for (const fieldFiles of Object.values(files)) {
            for (const file of fieldFiles) {
                fs.unlink(file.path, () => { });
            }
        }
    }
});
exports.default = router;
//# sourceMappingURL=upload.js.map