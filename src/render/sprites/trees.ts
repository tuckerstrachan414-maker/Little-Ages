import { CANOPY, FN, shade, mix } from "../../shared/palette.ts";
import { hash2 } from "../../shared/rng.ts";
import { Tree, DECIDUOUS, type Season } from "../../shared/types.ts";
import { grid, put, get, rect, vline, outlined, toCanvas, SpriteCache, type Grid } from "./grid.ts";

/*
  Tree sprites at 8 sprite pixels per tile. Every species has its own silhouette and seasonal
  colors; canopies are lit from the northwest and built from leafy clumps rather than smooth
  ellipses. Winter strips deciduous trees to their branches and dusts everything with snow.
*/

type Ramp = { d: string; m: string; l: string; h: string };
const ramp = (c: string): Ramp => ({ d: shade(c, 0.14), m: c, l: shade(c, -0.09), h: shade(c, -0.18) });
const TRUNK = { d: FN.trunkD, m: FN.trunk, l: shade(FN.trunk, -0.1) };

function canopy(g: Grid, cx: number, cy: number, rx: number, ry: number, r: Ramp, seed: number, rough = 0.28) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
    const dx = (x - cx) / (rx + 0.5), dy = (y - cy) / (ry + 0.5), d = dx * dx + dy * dy;
    const edge = 1 - hash2(x * 3 + seed, y * 5, 17) * rough;
    if (d > edge) continue;
    const lightT = (dx + dy) * 0.7 - (1 - d) * 0.3;
    let c = lightT < -0.55 ? r.h : lightT < -0.15 ? r.l : lightT > 0.45 ? r.d : r.m;
    /* leafy clumps: a few cells flip one step lighter or darker */
    const k = hash2(x + seed * 7, y, 23);
    if (k < 0.1) c = c === r.d ? r.m : r.d; else if (k > 0.93 && lightT < 0.2) c = r.l;
    put(g, x, y, c);
  }
}
function trunk(g: Grid, cx: number, top: number, bottom: number, wide = 1, colors = TRUNK) {
  for (let y = top; y <= bottom; y++) { put(g, cx, y, colors.m); if (wide > 1) put(g, cx + 1, y, colors.d); if (wide > 2) put(g, cx - 1, y, colors.l); if (wide > 3) put(g, cx + 2, y, colors.d); }
}
function bareBranches(g: Grid, cx: number, top: number, spread: number, height: number, seed: number, snow: boolean) {
  const twig = mix(FN.trunk, "#8a7a6a", 0.4);
  for (let b = 0; b < 5; b++) {
    const side = b % 2 ? 1 : -1, len = spread * (0.5 + hash2(b, seed, 3) * 0.6), y0 = top + Math.round(height * (0.25 + b * 0.14));
    for (let s = 0; s <= len; s++) { const x = cx + side * s, y = y0 - Math.round(s * 0.8); put(g, x, y, s > len * 0.6 ? twig : FN.trunk); if (snow && s > 0 && hash2(x, y, seed) < 0.5) put(g, x, y - 1, FN.snow); }
  }
  vline(g, cx, top, height, FN.trunk);
  if (snow) put(g, cx, top - 1, FN.snow);
}
/*
  A bare winter crown seen from above: a few strong limbs (outlined with the trunk) under a
  soft haze of fine twigs that is not outlined, so a winter wood reads light and airy
  instead of a thicket of dark sticks. Returns the twig layer, drawn after outlining.
*/
function winterCrown(g: Grid, cx: number, cy: number, rx: number, ry: number, seed: number, snow: boolean, tint = "#8f7c74"): Grid {
  const haze = grid(g.w, g.h), lit = shade(tint, -0.12), dark = shade(tint, 0.14), limb = shade(FN.trunk, -0.04);
  const base = cy + Math.round(ry * 0.45), n = 4 + Math.floor(hash2(seed, 1, 11) * 2);
  for (let b = 0; b < n; b++) {
    const a = -Math.PI * (0.18 + 0.64 * (b + 0.5) / n) + (hash2(b, seed, 12) - 0.5) * 0.3;
    const len = Math.hypot(Math.cos(a) * rx, Math.sin(a) * ry) * 0.85;
    for (let s = 0; s <= len; s += 0.5) {
      const x = cx + Math.cos(a) * s, y = base + Math.sin(a) * s;
      put(g, x, y, s > len * 0.7 ? mix(limb, tint, 0.35) : limb);
      if (s < len * 0.35) put(g, x + (Math.cos(a) < 0 ? 1 : -1), y, shade(limb, 0.12));
      if (snow && s > 1 && hash2(Math.round(x), Math.round(y), seed + 3) < 0.55) put(haze, x, y - 1, FN.snow);
    }
    /* one fork per limb, splitting off toward the edge of the crown */
    const fs = len * 0.5, fa = a + (b % 2 ? 0.55 : -0.55);
    for (let s = 0; s <= len * 0.38; s += 0.5) put(g, cx + Math.cos(a) * fs + Math.cos(fa) * s, base + Math.sin(a) * fs + Math.sin(fa) * s, mix(limb, tint, 0.5));
  }
  vline(g, cx, base, g.h - base, FN.trunk);
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
    const dx = (x - cx) / (rx + 0.5), dy = (y - cy) / (ry + 0.5), d = dx * dx + dy * dy;
    if (d > 1 - hash2(x, y, seed + 5) * 0.25 || get(g, x, y)) continue;
    if (hash2(x * 7 + seed, y, 29) > 0.72 - d * 0.3) continue;
    const l = (dx + dy) * 0.7 - (1 - d) * 0.25;
    put(haze, x, y, snow && dy < -0.2 && hash2(x, y, seed + 6) < 0.22 ? FN.snow : l < -0.35 ? lit : l > 0.35 ? dark : tint);
  }
  return haze;
}
function snowCap(g: Grid, amount: number, seed: number) {
  for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) {
    if (!g.px[y * g.w + x]) continue;
    if (y === 0 || !g.px[(y - 1) * g.w + x]) { if (hash2(x, y, seed) < amount) put(g, x, y, hash2(x, y, seed + 1) < 0.3 ? FN.snowD : FN.snow); break; }
  }
}

function build(sp: number, season: Season, v: number, snowy: boolean): HTMLCanvasElement {
  const s = [0.85, 1, 1.15][v], seed = sp * 13 + v * 7;
  const winterBare = season === 3 && DECIDUOUS.has(sp) && sp !== Tree.BerryBush;
  const col = CANOPY[sp] ? CANOPY[sp][season === 3 && !DECIDUOUS.has(sp) ? 3 : season] : FN.leaf;
  const R = ramp(col);
  let g: Grid; let shadowW = 8; let twigs: Grid | null = null;
  const W = (n: number) => Math.round(n * s);
  switch (sp) {
    case Tree.Oak: case Tree.Maple: case Tree.Beech: {
      const rx = W(sp === Tree.Beech ? 6 : sp === Tree.Oak ? 5.5 : 5), ry = W(sp === Tree.Beech ? 4 : sp === Tree.Maple ? 5 : 4.5), th = W(sp === Tree.Maple ? 4 : 3) + 1;
      g = grid(rx * 2 + 5, ry * 2 + th + 4); const cx = Math.floor(g.w / 2), cy = ry + 2;
      if (winterBare) { trunk(g, cx, cy + ry - 2, g.h - 1, 1); twigs = winterCrown(g, cx, cy, rx, ry, seed, snowy, sp === Tree.Beech ? "#9a8478" : "#8f7c74"); }
      else { trunk(g, cx, cy + ry - 2, g.h - 1, 2); canopy(g, cx, cy, rx, ry, R, seed); canopy(g, cx - rx * 0.45, cy + ry * 0.25, rx * 0.5, ry * 0.5, R, seed + 1); canopy(g, cx + rx * 0.5, cy + ry * 0.3, rx * 0.5, ry * 0.55, R, seed + 2); }
      shadowW = rx * 2; break;
    }
    case Tree.Birch: case Tree.Aspen: {
      const rx = W(sp === Tree.Birch ? 3.5 : 3), ry = W(sp === Tree.Birch ? 5.5 : 6), th = W(5);
      g = grid(rx * 2 + 5, ry * 2 + th + 4); const cx = Math.floor(g.w / 2), cy = ry + 2;
      const bark = { m: FN.bark, d: shade(FN.bark, 0.18), l: "#f2eee4" };
      for (let y = cy - 2; y < g.h; y++) { put(g, cx, y, bark.m); if (hash2(cx, y, seed) < 0.25) put(g, cx, y, "#3a3530"); }
      if (winterBare) twigs = winterCrown(g, cx, cy, rx, ry, seed, snowy, "#94706a");
      else { canopy(g, cx, cy, rx, ry, R, seed, 0.35); for (let y = cy + 1; y < cy + ry; y += 2) if (hash2(y, seed, 4) < 0.6) put(g, cx, y, bark.m); }
      shadowW = rx * 2 + 1; break;
    }
    case Tree.Willow: {
      const rx = W(6), ry = W(4);
      g = grid(rx * 2 + 5, ry * 2 + 9); const cx = Math.floor(g.w / 2), cy = ry + 2;
      trunk(g, cx, cy, g.h - 1, 2);
      if (winterBare) twigs = winterCrown(g, cx, cy, rx, ry, seed, snowy, "#b09a5c");
      else { canopy(g, cx, cy, rx, ry, R, seed); for (let x = cx - rx; x <= cx + rx; x += 2) { const len = 2 + Math.floor(hash2(x, seed, 5) * 4); for (let k = 1; k <= len; k++) put(g, x, cy + ry - 1 + k, k === len ? R.d : R.m); } }
      shadowW = rx * 2; break;
    }
    case Tree.Pine: {
      const rx = W(4), ry = W(3), th = W(7);
      g = grid(rx * 2 + 5, ry * 2 + th + 3); const cx = Math.floor(g.w / 2), cy = ry + 1;
      trunk(g, cx, cy, g.h - 1, 2, { m: "#8a5a3a", d: "#6a4028", l: "#a87048" });
      canopy(g, cx, cy, rx, ry, R, seed, 0.42); canopy(g, cx - rx * 0.6, cy + 1, rx * 0.45, ry * 0.55, R, seed + 3, 0.4);
      if (snowy) snowCap(g, 0.75, seed);
      shadowW = rx * 2; break;
    }
    case Tree.Spruce: case Tree.Fir: case Tree.Larch: case Tree.Cypress: {
      const h = W(sp === Tree.Cypress ? 14 : sp === Tree.Spruce ? 14 : 12), hw = sp === Tree.Cypress ? W(2.5) : sp === Tree.Fir ? W(4.5) : W(3.8);
      g = grid(hw * 2 + 3, h + 3); const cx = Math.floor(g.w / 2);
      vline(g, cx, h - 2, 4, FN.trunk);
      if (sp === Tree.Larch && season === 3) { for (let y = 1; y < h - 1; y++) { const ww = Math.round((y / h) * hw); if (y % 2 === 0) for (let k = -ww; k <= ww; k++) if (hash2(k, y, seed) < 0.55) put(g, cx + k, y, mix(FN.trunk, "#9a8a78", 0.4)); } vline(g, cx, 0, h, FN.trunk); }
      else for (let y = 0; y < h - 1; y++) {
        const tier = sp === Tree.Cypress ? 1 : (y % 3) / 3;
        const ww = sp === Tree.Cypress ? Math.round(hw * Math.sin(Math.min(1, (y + 1) / h) * Math.PI * 0.9)) : Math.round(((y + 1) / h) * hw * (0.75 + tier * 0.35));
        for (let k = -ww; k <= ww; k++) { const lightT = (k / Math.max(1, ww)) * 0.8 + (tier - 0.5) * 0.5; put(g, cx + k, y, lightT < -0.45 ? R.l : lightT > 0.45 ? R.d : (y % 3 === 2 && sp !== Tree.Cypress ? R.d : R.m)); }
      }
      if (snowy) snowCap(g, 0.85, seed);
      if (snowy && sp !== Tree.Cypress) for (let y = 3; y < h - 2; y += 3) { const ww = Math.round(((y + 1) / h) * hw); for (let k = -ww; k <= 0; k++) if (hash2(k, y, seed + 2) < 0.6) put(g, cx + k, y, FN.snow); }
      shadowW = hw * 2; break;
    }
    case Tree.Palm: {
      const h = W(11); g = grid(15, h + 6); const bx = 6;
      for (let i = 0; i < h; i++) put(g, bx + Math.round(Math.sin(i / 4) * 1.6), g.h - 1 - i, i % 2 ? "#8a6a44" : "#a8845a");
      const tx = bx + Math.round(Math.sin((h - 1) / 4) * 1.6), ty = g.h - 1 - h;
      const fr = [[-1, 0], [-2, 1], [-3, 1], [-4, 2], [-5, 3], [1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 3], [0, -1], [-1, -2], [1, -2], [2, -2], [-2, -1], [-3, 0], [3, 0], [-4, 1], [4, 0]];
      fr.forEach(([dx, dy], i) => put(g, tx + dx, ty + dy, dy > 0 ? R.d : i % 3 ? R.m : R.l));
      put(g, tx, ty + 1, "#6a4a2a"); put(g, tx + 1, ty + 1, "#6a4a2a");
      shadowW = 9; break;
    }
    case Tree.Acacia: {
      g = grid(17, 12); const cx = 8;
      vline(g, cx, 5, 7, FN.trunk); put(g, cx - 1, 6, FN.trunk); put(g, cx - 2, 5, FN.trunk); put(g, cx + 1, 6, FN.trunk); put(g, cx + 2, 5, FN.trunk);
      canopy(g, cx, 3, W(7), 1.6, R, seed, 0.2); canopy(g, cx - 2, 2, 3, 1, R, seed + 1, 0.2);
      shadowW = 12; break;
    }
    case Tree.Baobab: {
      g = grid(15, 14); const cx = 7;
      rect(g, cx - 2, 5, 4, 9, "#8a7058"); vline(g, cx + 1, 5, 9, "#6c5644"); vline(g, cx - 2, 5, 9, "#a68a70");
      for (const [dx, dy] of [[-3, 4], [-4, 3], [-5, 3], [3, 4], [4, 3], [5, 2], [0, 3], [1, 2]]) put(g, cx + dx, dy, "#7a6450");
      if (season !== 3) { canopy(g, cx - 4, 2, 2.5, 1.2, R, seed, 0.3); canopy(g, cx + 4, 1.5, 2.5, 1.2, R, seed + 1, 0.3); canopy(g, cx, 1.5, 2, 1, R, seed + 2, 0.3); }
      shadowW = 10; break;
    }
    case Tree.Jungle: {
      const rx = W(7), ry = W(5);
      g = grid(rx * 2 + 5, ry * 2 + 10); const cx = Math.floor(g.w / 2), cy = ry + 2;
      trunk(g, cx, cy, g.h - 1, 3, { m: "#9a8a72", d: "#76684f", l: "#b4a68c" }); put(g, cx - 2, g.h - 1, "#76684f"); put(g, cx + 3, g.h - 1, "#76684f");
      canopy(g, cx, cy, rx, ry, R, seed); canopy(g, cx - rx * 0.55, cy - 1, rx * 0.5, ry * 0.6, R, seed + 4); canopy(g, cx + rx * 0.5, cy - 1, rx * 0.45, ry * 0.6, R, seed + 5);
      shadowW = rx * 2; break;
    }
    case Tree.Mangrove: {
      g = grid(13, 11); const cx = 6;
      canopy(g, cx, 3, 5, 3, R, seed);
      for (const dx of [-3, -1, 1, 3]) { put(g, cx + dx * 0.6, 7, "#6a5440"); put(g, cx + dx, 8, "#6a5440"); put(g, cx + dx * 1.3, 9, "#6a5440"); }
      vline(g, cx, 5, 3, "#6a5440"); shadowW = 9; break;
    }
    case Tree.Cactus: {
      g = grid(9, 12); const cx = 4, c1 = "#6a8a46", c2 = "#56743a", c3 = "#86a65a";
      for (let y = 1; y < 12; y++) { put(g, cx, y, c1); put(g, cx + 1, y, c2); put(g, cx - 1, y, c3); }
      for (let y = 4; y < 7; y++) put(g, cx - 3, y, c3); hline2(g, cx - 3, 7, 3, c1); for (let y = 2; y < 6; y++) put(g, cx + 3, y, c2); hline2(g, cx + 1, 6, 3, c2);
      if (season === 0) put(g, cx, 0, "#e8a0b8");
      shadowW = 5; break;
    }
    case Tree.Snag: {
      g = grid(9, 13); bareBranches(g, 4, 2, 3, 10, seed, snowy); vline(g, 4, 2, 11, "#7a6a58"); vline(g, 5, 6, 7, "#5e5044"); shadowW = 5; break;
    }
    case Tree.BerryBush: case Tree.Shrub: {
      const rx = sp === Tree.Shrub ? 3 : 3.5, ry = sp === Tree.Shrub ? 2 : 2.6;
      g = grid(Math.ceil(rx * 2) + 4, Math.ceil(ry * 2) + 3); const cx = Math.floor(g.w / 2), cy = Math.ceil(ry) + 1;
      if (winterBare || (sp === Tree.Shrub && season === 3 && snowy)) { for (let k = -2; k <= 2; k++) { put(g, cx + k, cy + 1 - Math.abs(k), "#7a6a58"); put(g, cx + k, cy + 2, "#6a5a48"); } if (snowy) snowCap(g, 0.7, seed); }
      else { canopy(g, cx, cy, rx, ry, R, seed, 0.3);
        if (sp === Tree.BerryBush) { const berry = season === 0 ? "#f4f0e6" : season === 1 ? "#c8343a" : season === 2 ? "#5a2a5a" : null;
          if (berry) for (let k = 0; k < 6; k++) put(g, cx - 2 + Math.floor(hash2(k, seed, 9) * 5), cy - 1 + Math.floor(hash2(seed, k, 8) * 3), berry); }
        if (snowy) snowCap(g, 0.6, seed); }
      shadowW = Math.ceil(rx * 2); break;
    }
    case Tree.Reeds: {
      g = grid(7, 8);
      for (let k = 0; k < 5; k++) { const x = 1 + k, h = 4 + Math.floor(hash2(k, seed, 1) * 4); for (let y = 7; y > 7 - h; y--) put(g, x, y, k % 2 ? R.d : R.m); if (season !== 3 && k % 2 === 0) { put(g, x, 7 - h, "#6a4a2a"); put(g, x, 8 - h, "#6a4a2a"); } }
      shadowW = 5; break;
    }
    default: g = grid(3, 3); rect(g, 0, 0, 3, 3, R.m);
  }
  const out = outlined(g);
  if (twigs) for (let y = 0; y < twigs.h; y++) for (let x = 0; x < twigs.w; x++) { const c = twigs.px[y * twigs.w + x]; if (c && !g.px[y * g.w + x]) out.px[(y + 1) * out.w + x + 1] = c; }
  return toCanvas(out, { w: Math.max(3, shadowW) });
}
function hline2(g: Grid, x: number, y: number, w: number, c: string) { for (let i = 0; i < w; i++) put(g, x + i, y, c); }

const cache = new SpriteCache();
/** Tree sprite (with outline and shadow). Sprite pixels are 1/8 of a tile. */
export function treeSprite(sp: number, season: Season, variant: number, snowy: boolean): HTMLCanvasElement {
  return cache.get(`${sp}|${season}|${variant}|${snowy ? 1 : 0}`, () => build(sp, season, variant, snowy));
}
/** Tiny glyph for mid zooms: 3-4 pixels that still read as a tree. */
export function treeGlyph(sp: number, season: Season, snowy: boolean): HTMLCanvasElement {
  return cache.get(`g${sp}|${season}|${snowy ? 1 : 0}`, () => {
    const col = CANOPY[sp] ? CANOPY[sp][season] : FN.leaf, r = ramp(col);
    const g = grid(3, 4);
    const bare = season === 3 && DECIDUOUS.has(sp);
    if (sp === Tree.Spruce || sp === Tree.Fir || sp === Tree.Cypress || sp === Tree.Larch) { put(g, 1, 0, r.l); put(g, 0, 1, r.m); put(g, 1, 1, r.m); put(g, 2, 1, r.d); put(g, 0, 2, r.m); put(g, 1, 2, r.d); put(g, 2, 2, r.d); }
    else if (bare) { put(g, 0, 0, "#9c8a82"); put(g, 2, 0, "#8f7c74"); put(g, 1, 1, "#7e6c66"); put(g, 0, 1, "#8f7c74"); put(g, 2, 1, "#7e6c66"); }
    else { put(g, 0, 0, r.l); put(g, 1, 0, r.m); put(g, 2, 0, r.m); put(g, 0, 1, r.m); put(g, 1, 1, r.m); put(g, 2, 1, r.d); put(g, 1, 2, r.d); }
    put(g, 1, 3, FN.trunk);
    if (snowy) { put(g, 1, 0, FN.snow); put(g, 0, 1, bare ? null : FN.snow); }
    return toCanvas(g);
  });
}
