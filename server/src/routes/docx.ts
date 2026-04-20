import { Router, Request, Response } from 'express';
import { generateDocx } from '../services/docxGenerator';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const { sessionId, selectedResults, colorRanges, mapOpacity, mapTileType, smoothColors, statsOptions, entitySurfaceCorrections, startPage, sectionNumeral, legendPosition } = req.body;

  if (!sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    res.status(400).json({ error: 'sessionId inválido' });
    return;
  }

  try {
    const docxBuffer = await generateDocx({
      sessionId, selectedResults, colorRanges, mapOpacity, mapTileType, smoothColors,
      statsOptions, entitySurfaceCorrections, startPage, sectionNumeral, legendPosition,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="informe-xirio-${sessionId.substring(0, 8)}.docx"`
    );
    res.setHeader('Content-Length', docxBuffer.length);
    res.end(docxBuffer);
  } catch (err) {
    console.error('Error generando DOCX:', err);
    res.status(500).json({ error: 'Error al generar el DOCX' });
  }
});

export default router;
