import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { parseStudyXml, parseBestServerColors, parseBestServerDictionary } from '../services/xmlParser';
import {
  extractZip,
  detectSignalResults,
  detectInterferenceResults,
  enrichLayerNames,
} from '../services/zipExtractor';
import { parseStatisticsZip } from '../services/statisticsParser';
import { StudyMetadata, Layer, StatsTable } from '../types/study';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(os.tmpdir(), 'xirio-uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 600 * 1024 * 1024 } });

const uploadFields = upload.fields([
  { name: 'xml',                   maxCount: 1 },
  { name: 'signalZip',             maxCount: 1 },
  { name: 'interferenceZip',       maxCount: 1 },
  { name: 'statsZip',              maxCount: 1 },
  { name: 'statsInterferenceZip',  maxCount: 1 },
]);

router.post('/', uploadFields, async (req: Request, res: Response) => {
  const files = req.files as Record<string, Express.Multer.File[]>;

  if (!files?.xml?.[0]) {
    res.status(400).json({ error: 'Se requiere el archivo XML del estudio' });
    return;
  }

  const sessionId = uuidv4();
  const sessionDir = path.join(os.tmpdir(), `xirio-${sessionId}`);
  await fs.promises.mkdir(sessionDir, { recursive: true });

  try {
    // 1. Parsear XML del estudio (obtiene colores de señal e interferencia)
    const xmlFile = files.xml[0];
    const xmlParsed = await parseStudyXml(xmlFile.path);

    // 2. Extraer ZIPs
    const signalDir       = path.join(sessionDir, 'signal');
    const interferenceDir = path.join(sessionDir, 'interference');

    if (files.signalZip?.[0]) {
      await extractZip(files.signalZip[0].path, signalDir);
    }
    if (files.interferenceZip?.[0]) {
      await extractZip(files.interferenceZip[0].path, interferenceDir);
    }

    // 3. Colores del mejor servidor: la fuente canónica es BestServerColors en el
    //    study.xml dentro del ZIP de señal. Se usa siempre cuando esté disponible;
    //    si no se encuentra, se mantiene lo que parsó BestServerCustomColors del XML raíz.
    //    Además se leen los nombres reales de sector desde mtxbsres.xml.
    if (files.signalZip?.[0] && fs.existsSync(signalDir)) {
      const bsFromZip = await parseBestServerColors(signalDir);
      if (bsFromZip.stops.length > 0) {
        xmlParsed.colorRanges.bs = bsFromZip;
        console.log(`[Upload] BestServerColors del ZIP: ${bsFromZip.stops.length} sectores`);
      }

      // Actualizar etiquetas con nombres reales de sector desde mtxbsres.xml
      const bsDict = await parseBestServerDictionary(signalDir);
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
    const { layers: signalLayers, results: signalResults } =
      detectSignalResults(signalDir, sessionDir);
    const interferenceResults = detectInterferenceResults(interferenceDir, sessionDir);

    // 5. Construir lista de capas
    const enrichedLayers = enrichLayerNames(signalLayers, xmlParsed.layers);
    const allLayers: Layer[] = [...enrichedLayers.filter(l => !l.isGlobal)];

    const globalLayerFromSignal = signalLayers.find(l => l.isGlobal);
    if (globalLayerFromSignal) {
      allLayers.push({ ...globalLayerFromSignal, name: `${xmlParsed.serviceName} Global` });
    } else if (xmlParsed.layers.length > 0) {
      const globalId = xmlParsed.serviceName.toLowerCase().replace(/\s+/g, '');
      allLayers.push({ id: globalId, name: `${xmlParsed.serviceName} Global`, isGlobal: true });
    }

    // Capa 'agg' para throughput global de interferencia
    if (interferenceResults.some(r => r.layer === 'agg') && !allLayers.find(l => l.id === 'agg')) {
      allLayers.push({ id: 'agg', name: `${xmlParsed.serviceName} Global (Interferencia)`, isGlobal: true });
    }

    // 6. Parsear estadísticas (señal e interferencia se combinan en el mismo mapa)
    let statistics: Record<string, StatsTable> = {};
    if (files.statsZip?.[0]) {
      statistics = await parseStatisticsZip(files.statsZip[0].path);
    }
    if (files.statsInterferenceZip?.[0]) {
      const statsInterference = await parseStatisticsZip(files.statsInterferenceZip[0].path);
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
    const metadata: StudyMetadata = {
      sessionId,
      studyName:        xmlParsed.studyName,
      serviceName:      xmlParsed.serviceName,
      area:             xmlParsed.area,
      layers:           allLayers,
      sectors:          xmlParsed.sectors,
      colorRanges:      xmlParsed.colorRanges,
      availableResults: allResults,
      statistics,
    };

    await fs.promises.writeFile(
      path.join(sessionDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    res.json(metadata);
  } catch (err) {
    console.error('Error procesando archivos:', err);
    res.status(500).json({ error: 'Error al procesar los archivos' });
  } finally {
    for (const fieldFiles of Object.values(files)) {
      for (const file of fieldFiles) {
        fs.unlink(file.path, () => {});
      }
    }
  }
});

export default router;
