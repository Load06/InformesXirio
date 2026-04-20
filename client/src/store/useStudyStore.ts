import { create } from 'zustand';
import type { StudyMetadata, ColorRange, StatsOptions, LegendPosition, EntitySurfaceCorrections } from '../types/study';

export type AppStep = 'upload' | 'config' | 'preview';

interface SelectedResult {
  layer: string;
  type: string;
  selected: boolean;
  includeStats: boolean;
}

const DEFAULT_STATS_OPTIONS: StatsOptions = {
  showStats:      true,
  showTotals:     true,
  showPopAbs:     false,
  showPopPct:     false,
  showSurfAbs:    false,
  showSurfPct:    true,
  greenThreshold: 95,
};

interface StudyStore {
  step: AppStep;
  metadata: StudyMetadata | null;
  selectedResults: SelectedResult[];
  customColorRanges: Record<string, ColorRange>;
  mapOpacity: number;
  mapTileType: 'osm' | 'satellite';
  smoothColors: boolean;
  statsOptions: StatsOptions;
  entitySurfaceCorrections: EntitySurfaceCorrections;
  startPage: number;
  sectionNumeral: number;
  orientation: 'landscape' | 'portrait';
  legendPosition: LegendPosition;
  isUploading: boolean;
  uploadProgress: number;
  isGeneratingPdf: boolean;
  isGeneratingDocx: boolean;
  error: string | null;

  setStep: (step: AppStep) => void;
  setMetadata: (metadata: StudyMetadata) => void;
  toggleResult: (layer: string, type: string) => void;
  toggleResultStats: (layer: string, type: string) => void;
  setAllResults: (selected: boolean) => void;
  updateColorRange: (key: string, range: ColorRange) => void;
  setMapOpacity: (opacity: number) => void;
  setMapTileType: (type: 'osm' | 'satellite') => void;
  setSmoothColors: (smooth: boolean) => void;
  setStatsOptions: (opts: StatsOptions) => void;
  setEntitySurfaceCorrection: (key: string, value: number | null) => void;
  setStartPage: (page: number) => void;
  setSectionNumeral: (numeral: number) => void;
  setOrientation: (o: 'landscape' | 'portrait') => void;
  setLegendPosition: (p: LegendPosition) => void;
  setUploading: (uploading: boolean, progress?: number) => void;
  setGeneratingPdf: (generating: boolean) => void;
  setGeneratingDocx: (generating: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

// Tipos de señal y los que se seleccionan por defecto en capas no-globales
const SIGNAL_TYPES = ['cov', 'bs', 'ol'];
const SIGNAL_SELECTED = ['cov'];
const INTERF_SELECTED = ['dsnr', 'usnr', 'dth', 'uth'];
const GLOBAL_SELECTED = ['cov', 'dth', 'uth'];

export const useStudyStore = create<StudyStore>((set) => ({
  step: 'upload',
  metadata: null,
  selectedResults: [],
  customColorRanges: {},
  mapOpacity: 0.6,
  mapTileType: 'osm',
  smoothColors: true,
  statsOptions: { ...DEFAULT_STATS_OPTIONS },
  entitySurfaceCorrections: {},
  startPage: 1,
  sectionNumeral: 4,
  orientation: 'landscape',
  legendPosition: 'bottomright',
  isUploading: false,
  uploadProgress: 0,
  isGeneratingPdf: false,
  isGeneratingDocx: false,
  error: null,

  setStep: (step) => set({ step }),

  setMetadata: (metadata) => {
    // Lookup de capas globales
    const layerGlobal = Object.fromEntries(metadata.layers.map(l => [l.id, l.isGlobal]));

    // Seleccionar por defecto según tipo de resultado y si la capa es global
    const selectedResults = metadata.availableResults.map((r) => {
      let selected: boolean;
      if (layerGlobal[r.layer]) {
        selected = GLOBAL_SELECTED.includes(r.type);
      } else if (SIGNAL_TYPES.includes(r.type)) {
        selected = SIGNAL_SELECTED.includes(r.type);
      } else {
        selected = INTERF_SELECTED.includes(r.type);
      }
      return { layer: r.layer, type: r.type, selected, includeStats: r.hasStats };
    });

    // Inicializar rangos de colores desde el estudio
    const customColorRanges = { ...metadata.colorRanges };

    set({ metadata, selectedResults, customColorRanges });
  },

  toggleResult: (layer, type) => {
    set((state) => ({
      selectedResults: state.selectedResults.map((r) =>
        r.layer === layer && r.type === type ? { ...r, selected: !r.selected } : r
      ),
    }));
  },

  toggleResultStats: (layer, type) => {
    set((state) => ({
      selectedResults: state.selectedResults.map((r) =>
        r.layer === layer && r.type === type ? { ...r, includeStats: !r.includeStats } : r
      ),
    }));
  },

  setAllResults: (selected) => {
    set((state) => ({
      selectedResults: state.selectedResults.map((r) => ({ ...r, selected })),
    }));
  },

  updateColorRange: (key, range) => {
    set((state) => ({
      customColorRanges: { ...state.customColorRanges, [key]: range },
    }));
  },

  setMapOpacity: (opacity) => set({ mapOpacity: opacity }),

  setMapTileType: (type) => set({ mapTileType: type }),

  setSmoothColors: (smooth) => set({ smoothColors: smooth }),

  setStatsOptions: (opts) => set({ statsOptions: opts }),

  setEntitySurfaceCorrection: (key, value) =>
    set((state) => {
      const next = { ...state.entitySurfaceCorrections };
      if (value === null || value <= 0) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return { entitySurfaceCorrections: next };
    }),

  setStartPage: (page) => set({ startPage: page }),

  setSectionNumeral: (numeral) => set({ sectionNumeral: numeral }),

  setOrientation: (o) => set({ orientation: o }),

  setLegendPosition: (p) => set({ legendPosition: p }),

  setUploading: (uploading, progress = 0) =>
    set({ isUploading: uploading, uploadProgress: progress }),

  setGeneratingPdf: (generating) => set({ isGeneratingPdf: generating }),

  setGeneratingDocx: (generating) => set({ isGeneratingDocx: generating }),

  setError: (error) => set({ error }),

  reset: () =>
    set({
      step: 'upload',
      metadata: null,
      selectedResults: [],
      customColorRanges: {},
      mapOpacity: 0.6,
      mapTileType: 'osm',
      smoothColors: true,
      statsOptions: { ...DEFAULT_STATS_OPTIONS },
      entitySurfaceCorrections: {},
      startPage: 1,
      sectionNumeral: 4,
      orientation: 'landscape',
      legendPosition: 'bottomright',
      isUploading: false,
      uploadProgress: 0,
      isGeneratingPdf: false,
      isGeneratingDocx: false,
      error: null,
    }),
}));
