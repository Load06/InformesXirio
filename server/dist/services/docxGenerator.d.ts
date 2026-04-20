export interface DocxGenerationOptions {
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
    legendPosition?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
}
export declare function generateDocx(options: DocxGenerationOptions): Promise<Buffer>;
//# sourceMappingURL=docxGenerator.d.ts.map