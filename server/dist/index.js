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
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const upload_1 = __importDefault(require("./routes/upload"));
const pdf_1 = __importDefault(require("./routes/pdf"));
const docx_1 = __importDefault(require("./routes/docx"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// In production the frontend is built and served from the same Express process.
// CLIENT_URL should point to this server (e.g. http://localhost:3001) so Puppeteer
// can reach the /report page internally.
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
app.use((0, cors_1.default)({
    origin: CLIENT_URL,
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
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
    express_1.default.static(sessionDir)(req, res, next);
});
// Rutas API
app.use('/api/upload', upload_1.default);
app.use('/api/generate-pdf', pdf_1.default);
app.use('/api/generate-docx', docx_1.default);
// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Serve compiled frontend (production).
// __dirname in prod = server/dist/  →  ../../client/dist
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
    app.use(express_1.default.static(clientDist));
    // SPA fallback: send index.html for any non-API route
    app.get('*', (_req, res) => {
        res.sendFile(path.join(clientDist, 'index.html'));
    });
}
app.listen(PORT, () => {
    console.log(`Servidor XIRIO Informes escuchando en http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map