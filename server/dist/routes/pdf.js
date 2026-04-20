"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pdfGenerator_1 = require("../services/pdfGenerator");
const router = (0, express_1.Router)();
router.post('/', async (req, res) => {
    const { sessionId, selectedResults, colorRanges, mapOpacity, mapTileType, smoothColors, statsOptions, entitySurfaceCorrections, startPage, sectionNumeral, orientation, legendPosition } = req.body;
    if (!sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
        res.status(400).json({ error: 'sessionId inválido' });
        return;
    }
    try {
        const pdfBuffer = await (0, pdfGenerator_1.generatePdf)({ sessionId, selectedResults, colorRanges, mapOpacity, mapTileType, smoothColors, statsOptions, entitySurfaceCorrections, startPage, sectionNumeral, orientation, legendPosition });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="informe-xirio-${sessionId.substring(0, 8)}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.end(pdfBuffer);
    }
    catch (err) {
        console.error('Error generando PDF:', err);
        res.status(500).json({ error: 'Error al generar el PDF' });
    }
});
exports.default = router;
//# sourceMappingURL=pdf.js.map