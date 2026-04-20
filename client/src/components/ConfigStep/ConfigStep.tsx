import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckSquare, Square, Palette, ArrowLeft, FileDown, FileText, Loader, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import axios from 'axios';
import { useStudyStore } from '../../store/useStudyStore';
import { RESULT_LABELS, RESULT_ORDER } from '../../types/study';
import type { ColorRange, ColorStop, StatsOptions, LegendPosition, StatsEntity } from '../../types/study';
import { stopToCSS } from '../../lib/colorParser';
import styles from './ConfigStep.module.css';

export function ConfigStep() {
  const {
    metadata,
    selectedResults,
    customColorRanges,
    mapOpacity,
    mapTileType,
    smoothColors,
    statsOptions,
    startPage,
    sectionNumeral,
    orientation,
    legendPosition,
    toggleResult,
    toggleResultStats,
    setAllResults,
    setMapOpacity,
    setMapTileType,
    setSmoothColors,
    setStatsOptions,
    entitySurfaceCorrections,
    setEntitySurfaceCorrection,
    setStartPage,
    setSectionNumeral,
    setOrientation,
    setLegendPosition,
    setStep,
    setGeneratingPdf,
    setGeneratingDocx,
    setError,
    isGeneratingPdf,
    isGeneratingDocx,
    error,
  } = useStudyStore();

  const [expandedColor, setExpandedColor] = useState<string | null>(null);

  if (!metadata) return null;

  // Agrupar resultados por capa, fusionando las capas globales en un único grupo
  const globalLayers = metadata.layers.filter((l) => l.isGlobal);
  const nonGlobalLayers = metadata.layers.filter((l) => !l.isGlobal);

  const byLayer = [
    ...nonGlobalLayers.map((layer) => ({
      layer,
      results: metadata.availableResults
        .filter((r) => r.layer === layer.id)
        .sort((a, b) => RESULT_ORDER.indexOf(a.type) - RESULT_ORDER.indexOf(b.type)),
    })),
    ...(globalLayers.length > 0 ? [{
      layer: globalLayers[0],
      results: globalLayers
        .flatMap((gl) => metadata.availableResults.filter((r) => r.layer === gl.id))
        .sort((a, b) => RESULT_ORDER.indexOf(a.type) - RESULT_ORDER.indexOf(b.type)),
    }] : []),
  ];

  const allSelected = selectedResults.every((r) => r.selected);
  const someSelected = selectedResults.some((r) => r.selected);

  async function handleGeneratePdf() {
    if (!metadata) return;

    const selected = selectedResults
      .filter((r) => r.selected)
      .map(({ layer, type, includeStats }) => ({ layer, type, includeStats }));

    if (selected.length === 0) {
      setError('Selecciona al menos un resultado para incluir en el informe');
      return;
    }

    setError(null);
    setGeneratingPdf(true);

    try {
      const response = await axios.post(
        '/api/generate-pdf',
        {
          sessionId: metadata.sessionId,
          selectedResults: selected,
          colorRanges: customColorRanges,
          mapOpacity,
          mapTileType,
          smoothColors,
          statsOptions,
          entitySurfaceCorrections,
          startPage,
          sectionNumeral,
          orientation,
          legendPosition,
        },
        { responseType: 'blob' }
      );

      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `informe-${metadata.studyName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Error al generar el PDF';
      setError(msg);
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function handleGenerateDocx() {
    if (!metadata) return;

    const selected = selectedResults
      .filter((r) => r.selected)
      .map(({ layer, type, includeStats }) => ({ layer, type, includeStats }));

    if (selected.length === 0) {
      setError('Selecciona al menos un resultado para incluir en el informe');
      return;
    }

    setError(null);
    setGeneratingDocx(true);

    try {
      const response = await axios.post(
        '/api/generate-docx',
        {
          sessionId: metadata.sessionId,
          selectedResults: selected,
          colorRanges: customColorRanges,
          mapOpacity,
          mapTileType,
          smoothColors,
          statsOptions,
          entitySurfaceCorrections,
          startPage,
          sectionNumeral,
          legendPosition,
        },
        { responseType: 'blob' }
      );

      const url = URL.createObjectURL(new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `informe-${metadata.studyName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.docx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Error al generar el DOCX';
      setError(msg);
    } finally {
      setGeneratingDocx(false);
    }
  }

  function isSelected(layer: string, type: string) {
    return selectedResults.find((r) => r.layer === layer && r.type === type)?.selected ?? false;
  }

  function isStatsIncluded(layer: string, type: string) {
    return selectedResults.find((r) => r.layer === layer && r.type === type)?.includeStats ?? false;
  }

  // Entidades para la corrección de superficie: primero cov (señal), luego cualquier tipo no-BS
  function getSourceEntities(): StatsEntity[] | null {
    const stats = metadata!.statistics;
    const keys = Object.keys(stats);
    const covKey = keys.find(k => k.endsWith('-cov') && !stats[k].isBestServer && stats[k].entities.length > 0);
    if (covKey) return stats[covKey].entities;
    const anyKey = keys.find(k => !stats[k].isBestServer && stats[k].entities.length > 0);
    return anyKey ? stats[anyKey].entities : null;
  }

  const sourceEntities = getSourceEntities();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => setStep('upload')}>
          <ArrowLeft size={16} />
          Volver
        </button>
        <div>
          <h1 className={styles.title}>Configuración del Informe</h1>
          <p className={styles.studyName}>{metadata.studyName}</p>
        </div>
      </div>

      <div className={styles.layout}>
        {/* Panel izquierdo: selección de resultados */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Resultados a incluir</h2>
            <div className={styles.selectAll}>
              <button
                className={styles.selectAllBtn}
                onClick={() => setAllResults(!allSelected)}
              >
                {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
              </button>
            </div>
          </div>

          <div className={styles.layerList}>
            {byLayer.map(({ layer, results }) => (
              <div key={layer.id} className={styles.layerGroup}>
                <div className={styles.layerTitle}>
                  <div className={`${styles.layerBadge} ${layer.isGlobal ? styles.globalBadge : ''}`}>
                    {layer.name}
                  </div>
                </div>

                <div className={styles.resultList}>
                  {results.map((result) => {
                    const selected = isSelected(result.layer, result.type);
                    return (
                      <label key={`${result.layer}-${result.type}`} className={styles.resultItem}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleResult(result.layer, result.type)}
                          className={styles.checkbox}
                        />
                        <span className={styles.resultLabel}>
                          {RESULT_LABELS[result.type] || result.type}
                        </span>
                        {result.hasStats && (
                          <button
                            type="button"
                            className={`${styles.statsBadge} ${isStatsIncluded(result.layer, result.type) ? styles.statsBadgeActive : ''}`}
                            title={isStatsIncluded(result.layer, result.type) ? 'Estadísticas incluidas (clic para excluir)' : 'Estadísticas excluidas (clic para incluir)'}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleResultStats(result.layer, result.type); }}
                          >
                            estadísticas
                          </button>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Panel derecho: rangos de colores */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Rangos de color</h2>
            <p className={styles.panelSubtitle}>Configura los umbrales y colores para cada tipo de resultado</p>
          </div>

          <div className={styles.colorList}>
            {Object.entries(customColorRanges)
              .filter(([key]) => {
                // Solo mostrar colores de tipos que tengan resultados seleccionados
                return selectedResults.some((r) => r.selected && r.type === key);
              })
              .map(([key, range]) => {
                const isExpanded = expandedColor === key;
                const hasStops = range.stops.length > 0;

                return (
                  <div key={key} className={styles.colorGroup}>
                    <button
                      className={styles.colorHeader}
                      onClick={() => setExpandedColor(isExpanded ? null : key)}
                    >
                      <div className={styles.colorPreview}>
                        {hasStops ? (
                          <div
                            className={styles.gradientBar}
                            style={{
                              background: `linear-gradient(to right, ${range.stops.map((s, i) => {
                                const pct = ((i / (range.stops.length - 1)) * 100).toFixed(0);
                                return `${stopToCSS(s)} ${pct}%`;
                              }).join(', ')})`,
                            }}
                          />
                        ) : (
                          <div className={styles.noColor}>Sin color definido</div>
                        )}
                      </div>
                      <div className={styles.colorLabel}>
                        <Palette size={14} />
                        {RESULT_LABELS[key] || key}
                      </div>
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>

                    {isExpanded && hasStops && (
                      <ColorEditor
                        rangeKey={key}
                        range={range}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Panel de opciones de estadísticas */}
      {metadata.availableResults.some((r) => r.hasStats) && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Estadísticas</h2>
          </div>

          {/* Toggle maestro */}
          <label className={`${styles.statsOptionLabel} ${styles.statsMasterToggle}`}>
            <input
              type="checkbox"
              checked={statsOptions.showStats}
              onChange={(e) => setStatsOptions({ ...statsOptions, showStats: e.target.checked })}
            />
            <span>
              Incluir estadísticas en el informe
              <span className={styles.statsOptionDesc}>Tablas de cobertura de población y superficie por umbral</span>
            </span>
          </label>

          {/* Sub-opciones — solo activas si showStats=true */}
          {statsOptions.showStats && (
            <>
              <div className={styles.statsOptionsGrid}>
                {(
                  [
                    { key: 'showTotals',  label: 'Totales',             desc: 'Población total y superficie total' },
                    { key: 'showPopAbs',  label: 'Población absoluta',  desc: 'Habitantes que superan cada umbral' },
                    { key: 'showPopPct',  label: '% Población',         desc: 'Porcentaje de población por umbral' },
                    { key: 'showSurfAbs', label: 'Superficie absoluta', desc: 'km² que superan cada umbral' },
                    { key: 'showSurfPct', label: '% Superficie',        desc: 'Porcentaje de superficie por umbral' },
                  ] as { key: keyof StatsOptions; label: string; desc: string }[]
                ).map(({ key, label, desc }) => (
                  <label key={key} className={styles.statsOptionLabel}>
                    <input
                      type="checkbox"
                      checked={statsOptions[key] as boolean}
                      onChange={(e) => setStatsOptions({ ...statsOptions, [key]: e.target.checked })}
                    />
                    <span>
                      {label}
                      <span className={styles.statsOptionDesc}>{desc}</span>
                    </span>
                  </label>
                ))}
              </div>

              {(statsOptions.showPopPct || statsOptions.showSurfPct) && (
                <div className={styles.greenThresholdRow}>
                  <label className={styles.greenThresholdLabel} htmlFor="greenThreshold">
                    Umbral de color verde
                    <span className={styles.statsOptionDesc}>Las barras de porcentaje se pintan en verde cuando superan este valor</span>
                  </label>
                  <div className={styles.greenThresholdControl}>
                    <input
                      id="greenThreshold"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={statsOptions.greenThreshold}
                      className={styles.greenThresholdInput}
                      onChange={(e) => {
                        const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                        setStatsOptions({ ...statsOptions, greenThreshold: val });
                      }}
                    />
                    <span className={styles.greenThresholdUnit}>%</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Panel de corrección de superficie total */}
      {statsOptions.showStats && sourceEntities && sourceEntities.length > 0 && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Corregir superficie total</h2>
            <p className={styles.panelSubtitle}>
              Introduce un valor inferior al total original para corregir el sesgo raster/vectorial. Los porcentajes de superficie se recalcularán usando este valor como el 100%.
            </p>
          </div>
          <div className={styles.surfaceCorrBody}>
            <div className={styles.surfaceCorrHeader}>
              <span>Entidad</span>
              <span>S Total original</span>
              <span>S Total corregida</span>
            </div>
            {sourceEntities.map((entity) => {
              const key = entity.code ?? entity.name ?? '';
              const displayName = entity.name ?? entity.code ?? '—';
              const original = entity.surfaceTotal;
              const corrected = entitySurfaceCorrections[key];
              return (
                <div key={key} className={styles.surfaceCorrRow}>
                  <span className={styles.surfaceCorrName}>{displayName}</span>
                  <span className={styles.surfaceCorrOriginal}>
                    {original != null ? `${original.toFixed(2)} km²` : '—'}
                  </span>
                  <div className={styles.surfaceCorrInputWrap}>
                    <input
                      type="number"
                      className={styles.surfaceCorrInput}
                      min={0}
                      max={original ?? undefined}
                      step={0.01}
                      placeholder={original != null ? original.toFixed(2) : ''}
                      value={corrected != null ? corrected : ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? null : parseFloat(e.target.value);
                        setEntitySurfaceCorrection(key, val);
                      }}
                    />
                    <span className={styles.surfaceCorrUnit}>km²</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Panel de numeración y paginación */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Numeración, paginación y orientación</h2>
        </div>
        <div className={styles.docSettingsGrid}>
          <div className={styles.docSettingItem}>
            <label className={styles.docSettingLabel} htmlFor="startPage">
              Página de inicio
              <span className={styles.statsOptionDesc}>Número de la primera página (portada)</span>
            </label>
            <div className={styles.greenThresholdControl}>
              <input
                id="startPage"
                type="number"
                min={1}
                max={999}
                step={1}
                value={startPage}
                className={styles.greenThresholdInput}
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value) || 1);
                  setStartPage(val);
                }}
              />
            </div>
          </div>

          <div className={styles.docSettingItem}>
            <label className={styles.docSettingLabel} htmlFor="sectionNumeral">
              Numeral de sección de resultados
              <span className={styles.statsOptionDesc}>Primer nivel del índice (ej. 4 → 4.1.1, 5 → 5.1.1)</span>
            </label>
            <div className={styles.greenThresholdControl}>
              <input
                id="sectionNumeral"
                type="number"
                min={1}
                max={99}
                step={1}
                value={sectionNumeral}
                className={styles.greenThresholdInput}
                onChange={(e) => {
                  const val = Math.max(1, parseInt(e.target.value) || 1);
                  setSectionNumeral(val);
                }}
              />
            </div>
          </div>

          <div className={`${styles.docSettingItem} ${styles.docSettingItemFull}`}>
            <span className={styles.docSettingLabel}>
              Orientación de páginas de resultados (PDF y DOCX)
              <span className={styles.statsOptionDesc}>La portada siempre es vertical</span>
            </span>
            <div className={styles.orientationToggle}>
              <button
                type="button"
                className={`${styles.orientationBtn} ${orientation === 'landscape' ? styles.orientationBtnActive : ''}`}
                onClick={() => setOrientation('landscape')}
              >
                <RectangleHorizontal size={15} />
                Horizontal
              </button>
              <button
                type="button"
                className={`${styles.orientationBtn} ${orientation === 'portrait' ? styles.orientationBtnActive : ''}`}
                onClick={() => setOrientation('portrait')}
              >
                <RectangleVertical size={15} />
                Vertical
              </button>
            </div>
          </div>

          <div className={`${styles.docSettingItem} ${styles.docSettingItemFull}`}>
            <span className={styles.docSettingLabel}>
              Posición de la leyenda en el mapa
            </span>
            <div className={styles.legendCornerGrid}>
              {([
                ['topleft',    '↖', 'Sup. Izq.'],
                ['topright',   '↗', 'Sup. Der.'],
                ['bottomleft', '↙', 'Inf. Izq.'],
                ['bottomright','↘', 'Inf. Der.'],
              ] as [LegendPosition, string, string][]).map(([pos, arrow, label]) => (
                <button
                  key={pos}
                  type="button"
                  className={`${styles.orientationBtn} ${legendPosition === pos ? styles.orientationBtnActive : ''}`}
                  onClick={() => setLegendPosition(pos)}
                >
                  <span style={{ fontSize: 14 }}>{arrow}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <span>{error}</span>
        </div>
      )}

      <div className={styles.footer}>
        <div className={styles.summary}>
          <span className={styles.summaryCount}>
            {selectedResults.filter((r) => r.selected).length} resultados seleccionados
          </span>
          <span className={styles.summaryLayers}>
            en {metadata.layers.length} capas
          </span>
        </div>

        <div className={styles.opacityControl}>
          <span className={styles.opacityLabel}>Transparencia del mapa</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(mapOpacity * 100)}
            className={styles.opacitySlider}
            onChange={(e) => setMapOpacity(parseInt(e.target.value) / 100)}
          />
          <span className={styles.opacityValue}>{Math.round(mapOpacity * 100)}%</span>
        </div>

        <div className={styles.mapOptionsRow}>
          <div className={styles.toggleGroup}>
            <span className={styles.toggleGroupLabel}>Mapa base</span>
            <div className={styles.toggleButtons}>
              <button
                className={`${styles.toggleBtn} ${mapTileType === 'osm' ? styles.toggleBtnActive : ''}`}
                onClick={() => setMapTileType('osm')}
              >
                OSM
              </button>
              <button
                className={`${styles.toggleBtn} ${mapTileType === 'satellite' ? styles.toggleBtnActive : ''}`}
                onClick={() => setMapTileType('satellite')}
              >
                Satélite
              </button>
            </div>
          </div>

          <div className={styles.toggleGroup}>
            <span className={styles.toggleGroupLabel}>Colores</span>
            <div className={styles.toggleButtons}>
              <button
                className={`${styles.toggleBtn} ${smoothColors ? styles.toggleBtnActive : ''}`}
                onClick={() => setSmoothColors(true)}
              >
                Suavizados
              </button>
              <button
                className={`${styles.toggleBtn} ${!smoothColors ? styles.toggleBtnActive : ''}`}
                onClick={() => setSmoothColors(false)}
              >
                Estrictos
              </button>
            </div>
          </div>
        </div>

        <div className={styles.exportButtons}>
          <button
            className={styles.generateDocxBtn}
            onClick={handleGenerateDocx}
            disabled={isGeneratingDocx || isGeneratingPdf || !someSelected}
          >
            {isGeneratingDocx ? (
              <>
                <Loader size={16} className="animate-spin" />
                Generando DOCX...
              </>
            ) : (
              <>
                <FileText size={16} />
                Exportar DOCX
              </>
            )}
          </button>

          <button
            className={styles.generateBtn}
            onClick={handleGeneratePdf}
            disabled={isGeneratingPdf || isGeneratingDocx || !someSelected}
          >
            {isGeneratingPdf ? (
              <>
                <Loader size={16} className="animate-spin" />
                Generando PDF...
              </>
            ) : (
              <>
                <FileDown size={16} />
                Generar informe PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Editor de colores inline
function ColorEditor({ rangeKey, range }: { rangeKey: string; range: ColorRange }) {
  const { updateColorRange } = useStudyStore();

  function updateStop(idx: number, field: keyof ColorStop, value: number) {
    const newStops = range.stops.map((s, i) =>
      i === idx ? { ...s, [field]: value } : s
    );
    updateColorRange(rangeKey, { ...range, stops: newStops });
  }

  function stopColor(stop: ColorStop): string {
    return `#${stop.r.toString(16).padStart(2, '0')}${stop.g.toString(16).padStart(2, '0')}${stop.b.toString(16).padStart(2, '0')}`;
  }

  function handleColorChange(idx: number, hex: string) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const newStops = range.stops.map((s, i) =>
      i === idx ? { ...s, r, g, b } : s
    );
    updateColorRange(rangeKey, { ...range, stops: newStops });
  }

  return (
    <div className={styles.colorEditor}>
      <div className={styles.colorEditorHeader}>
        <span>Umbral</span>
        <span>Color</span>
        <span>Etiqueta</span>
      </div>
      {range.stops.map((stop, idx) => (
        <div key={idx} className={styles.colorRow}>
          <input
            type="number"
            value={stop.threshold}
            className={styles.thresholdInput}
            onChange={(e) => updateStop(idx, 'threshold', parseFloat(e.target.value))}
          />
          <input
            type="color"
            value={stopColor(stop)}
            className={styles.colorInput}
            onChange={(e) => handleColorChange(idx, e.target.value)}
          />
          <span className={styles.stopLabel}>{stop.label || '—'}</span>
        </div>
      ))}
    </div>
  );
}
