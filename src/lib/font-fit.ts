/**
 * Fits a real font to the original glyph pixels so replacement text keeps the
 * same face, weight, size, position and colour as the text it replaces.
 * Browser-only (uses 2D canvases for metrics and shape matching).
 */

import { strokeStats } from "./image-analysis";

export const FAMILIES = [
  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  "Helvetica, Arial, sans-serif",
  "Roboto, 'Helvetica Neue', Arial, sans-serif",
  "Verdana, Geneva, sans-serif",
  "'Trebuchet MS', 'Segoe UI', sans-serif",
  "'Times New Roman', Times, serif",
  "Georgia, 'Times New Roman', serif",
  "ui-monospace, 'SF Mono', Menlo, monospace",
];

const WEIGHTS = [200, 300, 400, 500, 600, 700, 800, 900];

let measureCtx: CanvasRenderingContext2D | null = null;
const ctx2d = () => {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    measureCtx = c.getContext("2d")!;
  }
  return measureCtx;
};

let renderCanvas: HTMLCanvasElement | null = null;
const renderCtx = (w: number, h: number) => {
  if (!renderCanvas) renderCanvas = document.createElement("canvas");
  renderCanvas.width = Math.max(1, w);
  renderCanvas.height = Math.max(1, h);
  return renderCanvas.getContext("2d", { willReadFrequently: true })!;
};

export type FontSpec = {
  family: string;
  weight: number;
  italic: boolean;
  fontSize: number;
  letterSpacing: number;
};

const cssFont = (f: Omit<FontSpec, "letterSpacing">) =>
  `${f.italic ? "italic " : ""}${f.weight} ${f.fontSize}px ${f.family}`;

export type Metrics = {
  ascent: number;
  descent: number;
  left: number;
  right: number;
  width: number;
};

export function measure(text: string, f: FontSpec): Metrics {
  const ctx = ctx2d();
  ctx.font = cssFont(f);
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
    `${f.letterSpacing}px`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const m = ctx.measureText(text);
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
  return {
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
    width: m.width,
  };
}

export type Fit = FontSpec & {
  /** alphabetic baseline of the fitted text, in image pixels */
  baselineY: number;
  /** how well the fitted glyphs overlap the original ink (0..1) */
  score: number;
};

type Box = { x: number; y: number; w: number; h: number };

/** Shape + thickness match between rendered glyphs and the original ink mask. */
function overlap(
  text: string,
  spec: FontSpec,
  ink: Box,
  mask: Uint8Array,
  dy: number,
  dx = 0,
  targetStroke = 0,
): number {
  const base = measure(text, spec);
  const ctx = renderCtx(ink.w, ink.h);
  ctx.clearRect(0, 0, ink.w, ink.h);
  ctx.font = cssFont(spec);
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
    `${spec.letterSpacing}px`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#000";
  ctx.fillText(text, base.left + dx, base.ascent + dy);
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
  const px = ctx.getImageData(0, 0, ink.w, ink.h).data;

  let inter = 0;
  let union = 0;
  const rendered = new Uint8Array(mask.length);
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
    const a = mask[i]!;
    const b = px[p]!;
    rendered[i] = b;
    inter += a < b ? a : b;
    union += a > b ? a : b;
  }
  const iou = union ? inter / union : 0;
  if (!targetStroke || targetStroke <= 0) return iou;

  // Thickness match: a candidate whose strokes are visibly fatter or thinner
  // than the original is penalised, so boldness is reproduced faithfully.
  const { strokeWidth } = strokeStats(rendered, ink.w, ink.h);
  const ratio = strokeWidth > 0 ? strokeWidth / targetStroke : 0;
  const err = Math.min(1, Math.abs(Math.log(Math.max(ratio, 0.01))) / Math.log(2.2));
  return iou * (1 - 0.45 * err);
}

function sizeFor(text: string, family: string, weight: number, italic: boolean, ink: Box) {
  const probe: FontSpec = { family, weight, italic, fontSize: 100, letterSpacing: 0 };
  const m = measure(text, probe);
  const h = m.ascent + m.descent;
  if (!(h > 0)) return null;
  const fontSize = Math.max(4, (100 * ink.h) / h);
  const at: FontSpec = { family, weight, italic, fontSize, letterSpacing: 0 };
  const w = measure(text, at);
  const rendered = w.left + w.right;
  if (!(rendered > 0)) return null;
  const gaps = Math.max(1, text.length - 1);
  const maxLs = fontSize * 0.2;
  const letterSpacing = Math.max(-maxLs, Math.min(maxLs, (ink.w - rendered) / gaps));
  return { ...at, letterSpacing } as FontSpec;
}

/**
 * Pick the font face/weight/slant whose rendered glyphs best overlap the
 * original pixels, then solve size, spacing and baseline so it lands exactly.
 */
export function fitText(
  text: string,
  ink: Box,
  mask: Uint8Array,
  opts?: { families?: string[]; italic?: boolean; strokeWidth?: number },
): Fit {
  const probe = text.trim() || "Ag";
  const families = opts?.families?.length ? opts.families : FAMILIES;
  // Measured thickness of the original strokes drives weight selection.
  const targetStroke =
    opts?.strokeWidth && opts.strokeWidth > 0
      ? opts.strokeWidth
      : strokeStats(mask, ink.w, ink.h).strokeWidth;
  let best: Fit | null = null;

  const evaluate = (family: string, weight: number, italic: boolean) => {
    const spec = sizeFor(probe, family, weight, italic, ink);
    if (!spec) return;
    let bestDy = 0;
    let bestScore = -1;
    for (const dy of [0, -1, 1, -2, 2]) {
      const s = overlap(probe, spec, ink, mask, dy, 0, targetStroke);
      if (s > bestScore) {
        bestScore = s;
        bestDy = dy;
      }
    }
    const m = measure(probe, spec);
    const cand: Fit = {
      ...spec,
      baselineY: ink.y + m.ascent + bestDy,
      score: bestScore,
    };
    if (!best || cand.score > best.score) best = cand;
  };

  // coarse pass: find the family (upright and slanted, since an italic face
  // scores badly when only tested upright)
  for (const family of families) {
    evaluate(family, 400, false);
    evaluate(family, 700, false);
    if (opts?.italic !== false) evaluate(family, 400, true);
  }
  const family = (best as Fit | null)?.family ?? families[0]!;
  // fine pass: weight and slant within the winning family
  for (const weight of WEIGHTS) {
    evaluate(family, weight, false);
    if (opts?.italic !== false) evaluate(family, weight, true);
  }

  if (best) {
    // refine: sub-pixel size, spacing and baseline for a pixel-exact match
    let cur = best as Fit;
    for (const pass of [1, 0.4]) {
      const sizeStep = cur.fontSize * 0.03 * pass;
      const lsStep = Math.max(0.1, cur.fontSize * 0.02) * pass;
      for (const ds of [-2, -1, 0, 1, 2]) {
        for (const dls of [-2, -1, 0, 1, 2]) {
          const spec: FontSpec = {
            ...cur,
            fontSize: Math.max(4, cur.fontSize + ds * sizeStep),
            letterSpacing: cur.letterSpacing + dls * lsStep,
          };
          const m = measure(probe, spec);
          for (const dy of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) {
            const s = overlap(probe, spec, ink, mask, dy, 0, targetStroke);

            if (s > cur.score) {
              cur = { ...spec, baselineY: ink.y + m.ascent + dy, score: s };
            }
          }
        }
      }
    }
    return cur;
  }
  return {
    family: families[0]!,
    weight: 400,
    italic: false,
    fontSize: ink.h / 0.72,
    letterSpacing: 0,
    baselineY: ink.y + ink.h * 0.8,
    score: 0,
  };
}

/**
 * Draw origin for (possibly edited) text, keeping the line anchored to the
 * original ink box.
 */
export function originFor(
  text: string,
  fit: FontSpec,
  anchor: { x: number; y: number; w: number; baselineY: number },
  align: "left" | "center" | "right" = "left",
) {
  const m = measure(text || " ", fit);
  const rendered = m.left + m.right;
  let x = anchor.x + m.left;
  if (align === "center") x = anchor.x + (anchor.w - rendered) / 2 + m.left;
  if (align === "right") x = anchor.x + anchor.w - rendered + m.left;
  return { x, y: anchor.baselineY };
}
