export interface PdfGenerationOptions {
    sessionId: string;
    selectedResults: Array<{
        layer: string;
        type: string;
    }>;
    colorRanges: Record<string, any>;
    mapOpacity?: number;
    mapTileType?: 'osm' | 'satellite';
    smoothColors?: boolean;
    statsOptions?: Record<string, any>;
    entitySurfaceCorrections?: Record<string, number>;
    startPage?: number;
    sectionNumeral?: number;
    orientation?: 'landscape' | 'portrait';
    legendPosition?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
}
export declare function generatePdf(options: PdfGenerationOptions): Promise<Buffer>;
//# sourceMappingURL=pdfGenerator.d.ts.map