import { hash2 } from "./rng.ts";

/* Value noise with quintic smoothing. Cheap enough to run on 8 million tiles. */
export function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise in [0, 1]. */
export function fbm(x: number, y: number, s: number, octaves = 5, lac = 2.03, gain = 0.5): number {
  let t = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < octaves; i++) { t += vnoise(x * f, y * f, s + i * 131) * amp; n += amp; amp *= gain; f *= lac; }
  return t / n;
}

/** Ridged fractal noise in [0, 1]: sharp crests, good for mountain chains. */
export function ridged(x: number, y: number, s: number, octaves = 5): number {
  let t = 0, amp = 0.5, f = 1, n = 0, w = 1;
  for (let i = 0; i < octaves; i++) {
    let r = 1 - Math.abs(vnoise(x * f, y * f, s + i * 71) * 2 - 1);
    r = r * r * w; w = Math.min(1, r * 2);
    t += r * amp; n += amp; amp *= 0.5; f *= 2.1;
  }
  return t / n;
}

/** Bilinear sample of a low-resolution float field covering the whole map. */
export function sampleField(f: Float32Array, fw: number, fh: number, u: number, v: number): number {
  const x = Math.max(0, Math.min(fw - 1.001, u * (fw - 1))), y = Math.max(0, Math.min(fh - 1.001, v * (fh - 1)));
  const xi = x | 0, yi = y | 0, xf = x - xi, yf = y - yi, i = yi * fw + xi;
  const a = f[i], b = f[i + 1], c = f[i + fw], d = f[i + fw + 1];
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** In-place separable box blur on a float field, repeated for a smoother falloff. */
export function blur(f: Float32Array, w: number, h: number, r: number, passes = 2): void {
  const tmp = new Float32Array(f.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) { let acc = 0, n = 0; const row = y * w;
      for (let x = -r; x < w; x++) { const add = x + r; if (add < w) { acc += f[row + add]; n++; } if (x - r - 1 >= 0) { acc -= f[row + x - r - 1]; n--; } if (x >= 0) tmp[row + x] = acc / n; } }
    for (let x = 0; x < w; x++) { let acc = 0, n = 0;
      for (let y = -r; y < h; y++) { const add = y + r; if (add < h) { acc += tmp[add * w + x]; n++; } if (y - r - 1 >= 0) { acc -= tmp[(y - r - 1) * w + x]; n--; } if (y >= 0) f[y * w + x] = acc / n; } }
  }
}
