import type { ColorRange, ColorStop } from '../types/study';

/**
 * Obtiene el color RGBA para un valor dado en el rango.
 *
 * Para rangos continuos (señal, interferencia):
 *   - smooth=true (default): interpola linealmente entre stops.
 *   - smooth=false: devuelve el color exacto del stop inferior (colores estrictos por rango).
 * Para rangos categóricos (mejor servidor): busca el stop con threshold == round(value).
 *
 * Si el valor está por debajo del primer stop o es NaN → transparente (no-dato).
 */
export function getColor(value: number, range: ColorRange, smooth = true): [number, number, number, number] {
  const { stops, noDataColor } = range;

  if (!isFinite(value) || stops.length === 0) {
    return [noDataColor.r, noDataColor.g, noDataColor.b, 0];
  }

  // Rango categórico si el flag está explícitamente marcado (ej. mejor servidor).
  // El fallback por auto-detección queda solo para rangos sin flag (retrocompatibilidad).
  const isCategorical = range.isCategorical !== undefined
    ? range.isCategorical
    : (stops.length > 1
        && stops[0].threshold >= 0
        && stops.every(s => Number.isInteger(s.threshold)));

  if (isCategorical) {
    const id = Math.round(value);
    const stop = stops.find(s => s.threshold === id);
    if (!stop) return [noDataColor.r, noDataColor.g, noDataColor.b, 0];
    return [stop.r, stop.g, stop.b, stop.alpha];
  }

  // Rango continuo: valor por debajo del mínimo → transparente
  if (value < stops[0].threshold) {
    return [noDataColor.r, noDataColor.g, noDataColor.b, 0];
  }

  // Valor por encima del máximo → color del último stop
  if (value >= stops[stops.length - 1].threshold) {
    const s = stops[stops.length - 1];
    return [s.r, s.g, s.b, s.alpha];
  }

  // Buscar el intervalo [lo, hi] que contiene el valor
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i];
    const hi = stops[i + 1];
    if (value >= lo.threshold && value < hi.threshold) {
      if (!smooth) {
        // Colores estrictos: usar el color del stop inferior del intervalo
        return [lo.r, lo.g, lo.b, lo.alpha];
      }
      // Interpolación lineal RGB
      const t = (value - lo.threshold) / (hi.threshold - lo.threshold);
      return [
        Math.round(lo.r   + (hi.r   - lo.r)   * t),
        Math.round(lo.g   + (hi.g   - lo.g)   * t),
        Math.round(lo.b   + (hi.b   - lo.b)   * t),
        Math.round(lo.alpha + (hi.alpha - lo.alpha) * t),
      ];
    }
  }

  return [noDataColor.r, noDataColor.g, noDataColor.b, 0];
}

/**
 * Convierte un ColorStop a string CSS rgba
 */
export function stopToCSS(stop: ColorStop): string {
  return `rgba(${stop.r},${stop.g},${stop.b},${(stop.alpha / 255).toFixed(2)})`;
}

/**
 * Parsea el formato de color de XIRIO en el cliente.
 * "-30000:0,255,255,255:Sin señal;-105:255,249,0,0:;..."
 */
export function parseColorString(colorStr: string): ColorRange {
  if (!colorStr) {
    return { stops: [], noDataColor: { r: 200, g: 200, b: 200, a: 0 } };
  }

  const clean = colorStr.replace(/#\d+$/, '').trim();
  const parts = clean.split(';').filter(Boolean);

  const stops: ColorStop[] = [];
  let noDataColor = { r: 200, g: 200, b: 200, a: 0 };

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const threshold = parseFloat(part.substring(0, colonIdx));
    const rest = part.substring(colonIdx + 1);
    const secondColon = rest.indexOf(':');
    const colorPart = secondColon !== -1 ? rest.substring(0, secondColon) : rest;
    const label = secondColon !== -1 ? rest.substring(secondColon + 1) : '';

    const components = colorPart.split(',').map(Number);
    if (components.length !== 4) continue;
    const [alpha, r, g, b] = components;

    if (threshold <= -10000) {
      noDataColor = { r, g, b, a: alpha };
    } else {
      stops.push({ threshold, alpha, r, g, b, label });
    }
  }

  stops.sort((a, b) => a.threshold - b.threshold);
  return { stops, noDataColor };
}

/**
 * Genera una imagen de leyenda como DataURL para incluir en el PDF o UI.
 * - smooth=true (default): gradiente continuo entre stops.
 * - smooth=false: bloques de color sólido, uno por stop.
 */
export function buildLegendDataUrl(range: ColorRange, width = 200, height = 20, smooth = true): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  if (range.stops.length === 0) return canvas.toDataURL();

  const stops = range.stops;
  const min = stops[0].threshold;
  const max = stops[stops.length - 1].threshold;
  const span = max - min || 1;

  if (smooth) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    for (const stop of stops) {
      const pos = (stop.threshold - min) / span;
      gradient.addColorStop(pos, `rgba(${stop.r},${stop.g},${stop.b},${stop.alpha / 255})`);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } else {
    // Bloques sólidos: cada stop ocupa el tramo hasta el siguiente
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const x0 = Math.round(((s.threshold - min) / span) * width);
      const x1 = i < stops.length - 1
        ? Math.round(((stops[i + 1].threshold - min) / span) * width)
        : width;
      ctx.fillStyle = `rgba(${s.r},${s.g},${s.b},${s.alpha / 255})`;
      ctx.fillRect(x0, 0, x1 - x0, height);
    }
  }

  return canvas.toDataURL();
}
