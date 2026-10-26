import { FN, mix } from "../../shared/palette.ts";

/* Pixel grids: sprites are authored as small arrays of colors, outlined, then turned into canvases. */

export interface Grid { w: number; h: number; px: (string | null)[]; }
export const grid = (w: number, h: number): Grid => ({ w, h, px: new Array(w * h).fill(null) });
export function put(g: Grid, x: number, y: number, c: string | null): void { x = Math.round(x); y = Math.round(y); if (c && x >= 0 && y >= 0 && x < g.w && y < g.h) g.px[y * g.w + x] = c; }
export function del(g: Grid, x: number, y: number): void { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.px[y * g.w + x] = null; }
export function get(g: Grid, x: number, y: number): string | null { return x >= 0 && y >= 0 && x < g.w && y < g.h ? g.px[y * g.w + x] : null; }
export function rect(g: Grid, x: number, y: number, w: number, h: number, c: string): void { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c); }
export const hline = (g: Grid, x: number, y: number, w: number, c: string) => rect(g, x, y, w, 1, c);
export const vline = (g: Grid, x: number, y: number, h: number, c: string) => rect(g, x, y, 1, h, c);

/** Dark outline outside the shape, a touch softer on the lit (top-left) edges. */
export function outlined(g: Grid, ink = FN.outline): Grid {
  const o = grid(g.w + 2, g.h + 2);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { const c = g.px[y * g.w + x]; if (c) o.px[(y + 1) * o.w + x + 1] = c; }
  const soft = mix(ink, "#6d6050", 0.35), src = o.px.slice();
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    if (src[y * o.w + x]) continue;
    let n = 0, lit = false;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < o.w && yy < o.h && src[yy * o.w + xx]) { n++; if (dx === 1 || dy === 1) lit = true; } }
    if (n) o.px[y * o.w + x] = lit && n === 1 ? soft : ink;
  }
  return o;
}

export function toCanvas(g: Grid, shadow?: { w: number; dy?: number }): HTMLCanvasElement {
  const pad = shadow ? 2 : 0;
  const c = document.createElement("canvas"); c.width = g.w + pad; c.height = g.h + pad; const x = c.getContext("2d")!;
  if (shadow) {
    /* soft ground shadow cast to the southeast, away from the northwest light */
    x.fillStyle = "rgba(12, 14, 24, 0.24)"; const sw = shadow.w, cx = Math.round(g.w / 2 + 1), by = g.h - 1 + (shadow.dy ?? 0);
    x.fillRect(cx - (sw >> 1), by, sw, 2); x.fillRect(cx - (sw >> 1) + 1, by + 2, sw - 2, 1); x.fillRect(cx - (sw >> 1) + 1, by - 1, sw - 2, 1);
  }
  for (let y = 0; y < g.h; y++) for (let i = 0; i < g.w; i++) { const p = g.px[y * g.w + i]; if (p) { x.fillStyle = p; x.fillRect(i, y, 1, 1); } }
  return c;
}

/** A cache of built sprites keyed by any string. */
export class SpriteCache {
  private m = new Map<string, HTMLCanvasElement>();
  get(key: string, build: () => HTMLCanvasElement): HTMLCanvasElement { let c = this.m.get(key); if (!c) { c = build(); this.m.set(key, c); } return c; }
  get size() { return this.m.size; }
}
