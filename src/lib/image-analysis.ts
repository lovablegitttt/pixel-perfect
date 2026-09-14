export type Rgb = { r: number; g: number; b: number };

export const rgbToHex = ({ r, g, b }: Rgb) =>
  "#" +
  [r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

export const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

const lum = ({ r, g, b }: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const dist = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export type BoxStats = {
  /** dominant background colour of the box */
  background: string;
  /** ink colour, sampled from glyph cores only (no anti-aliased edges) */
  color: string;
  /** exact ink bounds in image pixel coordinates */
  ink: { x: number; y: number; w: number; h: number };
  /** coverage mask of the ink bounds, 0..255 per pixel, row-major ink.w x ink.h */
  mask: Uint8Array;
  /** ink coverage ratio inside the ink bounds */
  density: number;
  /** median glyph stroke thickness in pixels */
  strokeWidth: number;
  /** how uniform the ink colour is (0 = perfectly uniform, 1 = photo-like) */
  colorSpread: number;
  /** 0..1 confidence that these pixels are rendered text rather than art */
  textScore: number;
};

/**
 * Median horizontal stroke thickness of a glyph mask. Text has thin, regular
 * strokes; icons, logos and photos do not.
 */
export function strokeStats(mask: Uint8Array, w: number, h: number) {
  const runs: number[] = [];
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]! >= 128) run++;
      else {
        if (run > 0 && run < w) runs.push(run);
        run = 0;
      }
    }
    if (run > 0 && run < w) runs.push(run);
  }
  const med = median(runs) || 1;
  const mad = runs.length ? median(runs.map((r) => Math.abs(r - med))) / med : 1;
  return { strokeWidth: med, consistency: 1 - Math.min(1, mad), runs: runs.length };
}

/**
 * Analyse a text box inside image pixel data: samples the true background and
 * glyph-core ink colour, and returns the exact ink bounds plus a coverage mask
 * so a replacement font can be shape-matched against the original glyphs.
 */
export function analyseBox(
  data: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  box: { x: number; y: number; w: number; h: number },
): BoxStats {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(imgW, Math.ceil(box.x + box.w));
  const y1 = Math.min(imgH, Math.ceil(box.y + box.h));

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * imgW + x) * 4;
      const r = data[i]!,
        g = data[i + 1]!,
        b = data[i + 2]!;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const cur = buckets.get(key);
      total++;
      if (cur) {
        cur.n++;
        cur.r += r;
        cur.g += g;
        cur.b += b;
      } else buckets.set(key, { n: 1, r, g, b });
    }
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const avg = (c: { n: number; r: number; g: number; b: number }): Rgb => ({
    r: c.r / c.n,
    g: c.g / c.n,
    b: c.b / c.n,
  });
  const bg = sorted.length ? avg(sorted[0]!) : { r: 255, g: 255, b: 255 };
  const bgShare = sorted.length ? sorted[0]!.n / Math.max(1, total) : 0;
  // how many visually distinct colours the region contains
  const distinctColors = sorted.filter((c) => c.n / Math.max(1, total) > 0.01).length;

  // Farthest-from-background pixel distance drives both the ink colour and mask.
  let maxD = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * imgW + x) * 4;
      const d = dist({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }, bg);
      if (d > maxD) maxD = d;
    }
  }
  if (maxD < 24) maxD = 24;

  const w = x1 - x0;
  const h = y1 - y0;
  const cover = new Uint8Array(Math.max(0, w * h));
  const inkThr = maxD * 0.35;

  // Candidate ink samples with their coverage (alpha) so the true glyph colour
  // can be recovered even for small/thin text that has no fully opaque core.
  const cand: { r: number; g: number; b: number; a: number }[] = [];
  let top = -1,
    bottom = -1,
    left = x1,
    right = -1,
    inkCount = 0;
  let far: Rgb | null = null;
  let farD = -1;
  for (let y = y0; y < y1; y++) {
    let rowCount = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * imgW + x) * 4;
      const px = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
      const d = dist(px, bg);
      const a = Math.max(0, Math.min(1, d / maxD));
      cover[(y - y0) * w + (x - x0)] = Math.round(a * 255);
      if (d > inkThr) {
        rowCount++;
        inkCount++;
        if (x < left) left = x;
        if (x > right) right = x;
        cand.push({ ...px, a });
        if (d > farD) {
          farD = d;
          far = px;
        }
      }
    }
    if (rowCount > 0) {
      if (top < 0) top = y;
      bottom = y;
    }
  }

  // Exact ink colour: prefer the most opaque glyph pixels. If the glyphs are so
  // thin that nothing is fully opaque (small text, hairline fonts), un-mix the
  // partially covered pixels against the measured background:
  //   observed = a*fg + (1-a)*bg  =>  fg = (observed - (1-a)*bg) / a
  // Median across samples keeps it robust against stray/edge pixels.
  let fg: Rgb;
  let colorSpread = 0;
  if (cand.length) {
    const alphas = [...cand].sort((p, q) => q.a - p.a).map((p) => p.a);
    // top-decile coverage, but never below a level where un-mixing is stable
    const pick = Math.max(0.45, alphas[Math.min(alphas.length - 1, Math.floor(alphas.length * 0.1))]!);
    const opaque = cand.filter((p) => p.a >= 0.92);
    const use = opaque.length >= 4 ? opaque : cand.filter((p) => p.a >= pick);
    const src = use.length ? use : cand;
    const unmix = (v: number, bgv: number, a: number) =>
      a >= 0.98 ? v : Math.max(0, Math.min(255, (v - (1 - a) * bgv) / a));
    const rs = src.map((p) => unmix(p.r, bg.r, p.a));
    const gs = src.map((p) => unmix(p.g, bg.g, p.a));
    const bs = src.map((p) => unmix(p.b, bg.b, p.a));
    fg = { r: median(rs), g: median(gs), b: median(bs) };
    const devs = rs.map((_, i) => dist({ r: rs[i]!, g: gs[i]!, b: bs[i]! }, fg));
    colorSpread = Math.min(1, median(devs) / 120);
  } else if (far) {
    fg = far;
    colorSpread = 1;
  } else {
    fg = lum(bg) > 128 ? { r: 20, g: 20, b: 20 } : { r: 245, g: 245, b: 245 };
    colorSpread = 1;
  }

  const hasInk = top >= 0 && right >= left;
  const ink = hasInk
    ? { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
    : { x: x0, y: y0, w, h };

  // crop the coverage mask down to the ink bounds
  const mask = new Uint8Array(ink.w * ink.h);
  for (let y = 0; y < ink.h; y++) {
    const sy = ink.y - y0 + y;
    for (let x = 0; x < ink.w; x++) {
      const sx = ink.x - x0 + x;
      if (sy >= 0 && sy < h && sx >= 0 && sx < w) mask[y * ink.w + x] = cover[sy * w + sx]!;
    }
  }

  const density = inkCount / Math.max(1, ink.w * ink.h);
  const st = strokeStats(mask, ink.w, ink.h);

  // ---- is this actually text? -------------------------------------------
  // Rendered text: one flat background, one flat ink colour, thin regular
  // strokes, moderate coverage. Photos, icons and gradients fail these.
  const densityOk = density > 0.04 && density < 0.62;
  const strokeRatio = st.strokeWidth / Math.max(1, ink.h);
  const strokeOk = strokeRatio > 0.02 && strokeRatio < 0.45;
  const scores = [
    densityOk ? 1 : 0,
    strokeOk ? 1 : 0,
    st.consistency,
    1 - colorSpread,
    Math.min(1, bgShare / 0.35),
    distinctColors <= 6 ? 1 : Math.max(0, 1 - (distinctColors - 6) / 10),
  ];
  const textScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  return {
    background: rgbToHex(bg),
    color: rgbToHex(fg),
    ink,
    mask,
    density,
    strokeWidth: st.strokeWidth,
    colorSpread,
    textScore,
  };
}
