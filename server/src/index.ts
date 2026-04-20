import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import uploadRouter from './routes/upload';
import pdfRouter from './routes/pdf';
import docxRouter from './routes/docx';

const app = express();
const PORT = process.env.PORT || 3001;

// In production the frontend is built and served from the same Express process.
// CLIENT_URL should point to this server (e.g. http://localhost:3001) so Puppeteer
// can reach the /report page internally.
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors({
  origin: CLIENT_URL,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Servir archivos estáticos de sesiones (GeoTIFFs, etc.)
// GET /api/files/:sessionId/path/to/file.tif
app.use('/api/files/:sessionId', (req, res, next) => {
  const sessionId = req.params.sessionId;
  // Validar UUID para prevenir path traversal
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) {
    res.status(400).json({ error: 'sessionId inválido' });
    return;
  }
  const sessionDir = path.join(os.tmpdir(), `xirio-${sessionId}`);
  express.static(sessionDir)(req, res, next);
});

// Rutas API
app.use('/api/upload', uploadRouter);
app.use('/api/generate-pdf', pdfRouter);
app.use('/api/generate-docx', docxRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve compiled frontend (production).
// __dirname in prod = server/dist/  →  ../../client/dist
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: send index.html for any non-API route
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Servidor XIRIO Informes escuchando en http://localhost:${PORT}`);
});
