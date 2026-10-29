import { FN, shade, mix } from "../../shared/palette.ts";
import { hash2 } from "../../shared/rng.ts";
import type { HutLook, HutStyle } from "../../shared/people.ts";
import { grid, put, rect, hline, outlined, toCanvas, SpriteCache, type Grid } from "./grid.ts";

/*
  Huts: what people raise once they mean to stay. Each people builds in its own way: round
  huts (a beehive of thatch over bent poles, or daub walls under a thatch cap), longhouses
  (gabled roofs of bark or thatch, a bay for each household under one roof) or tall cones
  of poles sheathed in bark or hide. Where it is cold the hut is sunk into the ground and
  covered with turf; where the ground is wet it stands on stilts; where it is hot the walls
  are left open under a deep roof of thatch. A hut goes up in stages, a frame of poles and
  then the covering, wears with the years, and once nobody mends it falls in until only
  the ribs are left standing. Lit from the top left, 8 pixels to a tile.
*/

export interface HutLooks { style: HutStyle; look: HutLook; stage: number; wear: number; snow: boolean; size: number; v: number; hide: string; trim: string; }

const cache = new SpriteCache();
type Ramp = [string, string, string];
const M: Record<string, Ramp> = {
  thatch: ["#dcc07e", "#c6a25c", "#a3823f"],
  bark: ["#958169", "#7a6450", "#5e4b3b"],
  turf: ["#8a9a58", "#6f7f45", "#55643a"],
  daub: ["#d4b58a", "#b8946a", "#94704c"],
  earth: ["#9a7650", "#7a5c3e", "#5e4630"],
};
const POLE = "#6b4a2c", POLE_L = "#8a6040", DARK = "#2e2620", INSIDE = "#3a2e24", SNOW = "#eef1ec", SNOW_D = "#cfd6d2", WEED = ["#6f8f44", "#86a454"];

/** A hut as `HutLooks` describes it: style, the local look, how far built, how worn, under snow or not. */
export function hutSprite(h: HutLooks): HTMLCanvasElement {
  const key = `hut${h.style}|${h.look}|${h.stage}|${h.wear}|${h.snow ? 1 : 0}|${h.size}|${h.v & 3}|${h.hide}|${h.trim}`;
  return cache.get(key, () => {
    const b = build(h);
    return toCanvas(outlined(b.g), { w: Math.round(b.g.w * 0.9), dy: 0 });
  });
}

/** The parts of a hut before they are put together: covering, frame, and what always shows (stilts, posts, a ladder). */
interface Parts { cov: Grid; rib: Grid; fixed: Grid; top: number; bottom: number; door: [number, number, number, number][]; smoke?: [number, number]; }

function build(h: HutLooks): { g: Grid } {
  const stilts = h.look === "wet", S = stilts ? 6 : 0;
  const p = h.style === "round" ? round(h) : h.style === "long" ? long(h) : cone(h);
  const W = p.cov.w, H = p.cov.h + S;
  const g = grid(W, H);
  const v = h.v & 3, seed = 31 + v * 7 + (h.style === "long" ? 3 : h.style === "cone" ? 5 : 0);
  /* stilts: posts down to the ground, a deck of planks, a ladder up to the door */
  if (stilts) {
    const deck = p.cov.h;
    for (let x = 0; x < W; x++) { put(g, x, deck, x % 3 === 0 ? POLE : POLE_L); }
    for (const x of [2, Math.floor(W / 2), W - 3]) for (let y = deck + 1; y < H; y++) put(g, x, y, y === deck + 1 ? POLE_L : POLE);
    const d = p.door[0];
    if (d && h.stage >= 1 && h.wear < 2) { const lx = d[0] + Math.floor(d[2] / 2) - 1; for (let y = deck + 1; y < H; y++) { put(g, lx, y, POLE); put(g, lx + 2, y, POLE); if ((y - deck) % 2 === 0) put(g, lx + 1, y, POLE_L); } }
  }
  const mid = p.top + Math.floor((p.bottom - p.top) * 0.5);
  for (let y = 0; y < p.cov.h; y++) for (let x = 0; x < W; x++) {
    const c = p.cov.px[y * W + x], r = p.rib.px[y * W + x], fx = p.fixed.px[y * W + x];
    /* the shade under an open roof only shows once there is a roof to cast it */
    const f = h.stage === 0 && (fx === INSIDE || fx === DARK) ? null : fx;
    let out: string | null = f;
    if (c) {
      const covered = h.stage >= 2 || (h.stage === 1 && y >= mid);
      if (covered) {
        out = c;
        const hh = hash2(x, y, seed);
        if (h.wear === 1 && hh < 0.08) out = r ?? INSIDE;
        else if (h.wear === 1 && hh < 0.2) out = mix(c, "#8a8478", 0.3);
        if (h.wear >= 2) {
          /* fallen in: the roof is gone from the top, the walls are holed, the ribs stand bare */
          const fallen = y < p.top + (p.bottom - p.top) * 0.55 || hh < 0.45;
          out = fallen ? (r && hash2(x, y, seed + 1) > 0.35 ? r : null) : mix(c, "#7a7466", 0.35);
        }
      } else out = r ?? f;
    } else if (r && (h.wear < 2 || hash2(x, y, seed + 1) > 0.35)) out = r;
    if (out) put(g, x, y, out);
  }
  /* the door: dark inside, the people's dye on the hanging */
  if (h.stage >= 2 && h.wear < 2) for (const [dx, dy, dw, dh] of p.door) {
    rect(g, dx, dy, dw, dh, DARK);
    hline(g, dx, dy, dw, POLE); put(g, dx - 1, dy + dh - 1, POLE); put(g, dx + dw, dy + dh - 1, POLE);
    for (let y = dy + 1; y < dy + dh - 1; y++) put(g, dx + dw - 1, y, (y + v) % 2 ? h.trim : shade(h.trim, 0.12));
  }
  if (p.smoke && h.stage >= 2 && h.wear < 2) { put(g, p.smoke[0], p.smoke[1], DARK); put(g, p.smoke[0] + 1, p.smoke[1], DARK); }
  /* snow on the covering, thickest along the top */
  if (h.snow && h.stage >= 1) for (let x = 0; x < W; x++) {
    let first = -1; for (let y = 0; y < p.cov.h; y++) if (g.px[y * W + x] && p.cov.px[y * W + x]) { first = y; break; }
    if (first < 0) continue;
    const depth = h.look === "cold" ? 4 : 3;
    for (let y = first; y < first + depth && y < p.cov.h; y++) if (p.cov.px[y * W + x] && g.px[y * W + x] !== DARK && (y - first < 2 || (x + y) % 2 === 0)) put(g, x, y, y - first < 1 ? SNOW : SNOW_D);
  }
  /* a bundle of poles and thatch waiting, beside a hut still going up; rubble and weeds at a ruin */
  if (h.stage === 0) { const y = p.cov.h - 1; for (let x = W - 7; x < W - 1; x++) put(g, x, y, x % 2 ? POLE_L : POLE); for (let x = W - 6; x < W - 2; x++) put(g, x, y - 1, M.thatch[1]); }
  if (h.wear >= 2) for (let x = 0; x < W; x++) {
    const y = p.cov.h - 1, hh = hash2(x, 7, seed + 2);
    if (hh < 0.3) put(g, x, y, hh < 0.12 ? POLE : M.earth[2]); else if (hh > 0.82) { put(g, x, y, WEED[0]); if (hh > 0.92) put(g, x, y - 1, WEED[1]); }
  }
  return { g };
}

const parts = (w: number, h: number): Parts => ({ cov: grid(w, h), rib: grid(w, h), fixed: grid(w, h), top: 0, bottom: h - 1, door: [] });

/** Round huts: a beehive of thatch, daub walls under a cap, an open shade roof, or a turf mound. */
function round(h: HutLooks): Parts {
  const v = h.v & 3;
  if (h.look === "hot") {
    /* a wide cone of thatch on posts; the sides open to the breeze */
    const W = 28, Hh = 17, p = parts(W, Hh), cx = 13, roofH = 9;
    for (let y = 0; y < roofH; y++) {
      const half = Math.min(13, 1 + Math.round(y * 1.5));
      for (let x = -half; x <= half; x++) {
        const c = M.thatch, col = x <= -half + 1 ? c[0] : x >= half - 1 ? c[2] : y % 3 === 2 ? shade(c[1], 0.08) : (x + y * 2 + v) % 7 === 0 ? c[0] : c[1];
        put(p.cov, cx + x, y, col);
        if (x === 0 || Math.abs(x) === half || Math.abs(x) === Math.round(half * 0.5)) put(p.rib, cx + x, y, x < 0 ? POLE_L : POLE);
      }
    }
    for (const dx of [-10, -4, 4, 10]) for (let y = roofH; y < Hh; y++) put(p.fixed, cx + dx, y, dx < 0 ? POLE_L : POLE);
    for (let y = roofH; y < Hh - 1; y++) for (let x = -9; x <= 9; x++) if (![-4, 4].includes(x)) put(p.fixed, cx + x, y, y === roofH ? DARK : INSIDE);
    hline(p.fixed, cx - 9, Hh - 1, 19, "#8a6a48");
    p.top = 0; p.bottom = roofH - 1;
    return p;
  }
  if (h.look === "cold") {
    /* a low mound of turf over a sunken floor, with a smoke hole and a short entrance passage */
    const W = 26, Hh = 12, p = parts(W, Hh), cx = 12, R = 12, Hd = 10;
    for (let y = 0; y < Hd; y++) {
      const half = Math.round(Math.sqrt(Math.max(0, 1 - ((Hd - 1 - y) / (Hd - 0.5)) ** 2)) * R);
      for (let x = -half; x <= half; x++) {
        const c = y < 4 ? M.turf : M.earth, col = x <= -half + 1 ? c[0] : x >= half - 1 ? c[2] : (x * 3 + y + v) % 5 === 0 ? c[0] : c[1];
        put(p.cov, cx + x, y + 1, col);
        if (bent(x, y, half, Hd)) put(p.rib, cx + x, y + 1, x < 0 ? POLE_L : POLE);
      }
    }
    rect(p.cov, cx - 3, Hd - 1, 7, 3, M.earth[1]); hline(p.cov, cx - 3, Hd - 1, 7, M.turf[1]);
    p.door.push([cx - 1, Hd, 3, 2]); p.smoke = [cx, 1]; p.top = 1; p.bottom = Hd + 1;
    return p;
  }
  /* a beehive: thatch in overlapping rows over bent poles; most peoples daub the lowest course with clay */
  const W = 26, Hh = 18, p = parts(W, Hh), cx = 12, R = 12, Hd = 17;
  const daubed = v % 2 === 0;
  for (let y = 0; y < Hd; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - ((Hd - 1 - y) / (Hd - 0.5)) ** 2)) * R);
    for (let x = -half; x <= half; x++) {
      const c = daubed && y >= Hd - 5 ? M.daub : M.thatch;
      let col = x <= -half + 1 ? c[0] : x >= half - 1 ? c[2] : c[1];
      if (c === M.thatch) { if (y % 3 === 2) col = shade(col, 0.1); else if ((x * 2 + y + v) % 7 === 0) col = c[0]; }
      else if ((x + y) % 5 === 0) col = c[2];
      put(p.cov, cx + x, y + 1, col);
      if (bent(x, y, half, Hd)) put(p.rib, cx + x, y + 1, x < 0 ? POLE_L : POLE);
    }
  }
  put(p.cov, cx, 0, M.thatch[2]); put(p.cov, cx - 1, 0, M.thatch[1]);
  p.door.push([cx - 2, Hd - 5, 4, 6]); p.top = 1; p.bottom = Hd;
  return p;
}

/** The bent poles of a dome: the outer arch, two arches inside it and the crown, tied by hoops a third and two thirds of the way up. */
function bent(x: number, y: number, half: number, Hd: number): boolean {
  if (Math.abs(x) === half || x === 0) return true;
  if (Math.abs(x) === Math.round(half * 0.55)) return true;
  return (y === Math.floor(Hd / 3) || y === Math.floor(Hd * 2 / 3)) && Math.abs(x) < half;
}

/** Longhouses: a gabled roof over walls, a door to each bay. Bark where it is mild, thatch and open sides where hot, turf over a sunken floor where cold. */
function long(h: HutLooks): Parts {
  const v = h.v & 3, n = Math.max(1, Math.min(3, h.size)), W = 10 + 16 * n;
  const cold = h.look === "cold", hot = h.look === "hot";
  const roofH = cold ? 10 : 9, wallH = cold ? 3 : 7, Hh = roofH + wallH, p = parts(W, Hh);
  const roof = cold ? M.turf : hot ? M.thatch : M.bark, wall = cold ? M.earth : M.bark;
  for (let y = 0; y < roofH; y++) {
    const inset = Math.max(0, Math.round((roofH - 1 - y) * 0.4));
    for (let x = inset; x < W - inset; x++) {
      let col = y === 0 ? roof[0] : x <= inset + 1 ? roof[0] : x >= W - inset - 2 ? roof[2] : roof[1];
      if (!cold && !hot && x % 5 === (v % 5)) col = roof[2];
      if (hot && y % 3 === 2) col = shade(col, 0.08);
      if (cold && (x * 3 + y + v) % 6 === 0) col = roof[0];
      if (y === roofH - 1) col = roof[2];
      put(p.cov, x, y, col);
      if (y === 0 || (x - inset) % 4 === 0) put(p.rib, x, y, POLE);
    }
  }
  for (let y = roofH; y < Hh; y++) for (let x = 1; x < W - 1; x++) {
    if (hot) continue;
    put(p.cov, x, y, x <= 2 ? wall[0] : x >= W - 3 ? wall[2] : (x % 3 === 0 ? wall[2] : wall[1]));
  }
  if (hot) for (let y = roofH; y < Hh; y++) for (let x = 1; x < W - 1; x++) put(p.fixed, x, y, y === Hh - 1 ? "#8a6a48" : y === roofH ? DARK : INSIDE);
  for (let k = 0; k <= n; k++) { const x = 1 + k * 16 + (k === n ? -1 : 0); for (let y = roofH; y < Hh; y++) { put(p.rib, Math.min(W - 2, x), y, POLE); if (hot) put(p.fixed, Math.min(W - 2, x), y, POLE); } }
  for (let k = 0; k < n; k++) p.door.push([5 + k * 16 + 4, Hh - (cold ? 3 : 5), 3, cold ? 3 : 5]);
  if (hot) p.door = [];
  if (cold) p.smoke = [Math.floor(W / 2), 1];
  p.top = 0; p.bottom = Hh - 1;
  return p;
}

/** Cones: tall poles sheathed in bark slabs or the people's own hides, thatch where hot, or an earth lodge where cold. */
function cone(h: HutLooks): Parts {
  const v = h.v & 3;
  if (h.look === "cold") {
    /* an earth lodge: a low cone of poles heaped with earth and turf, smoke hole at the top, a covered way in */
    const W = 28, Hh = 14, p = parts(W, Hh), cx = 13;
    for (let y = 0; y < 12; y++) {
      const half = Math.min(13, 2 + Math.round(y * 1.15));
      for (let x = -half; x <= half; x++) {
        const c = y < 5 ? M.turf : M.earth, col = x <= -half + 1 ? c[0] : x >= half - 1 ? c[2] : (x + y * 2 + v) % 6 === 0 ? c[0] : c[1];
        put(p.cov, cx + x, y + 1, col);
        if (x % 3 === 0 && Math.abs(x) <= half - 1) put(p.rib, cx + x, y + 1, POLE);
      }
    }
    rect(p.cov, cx - 3, 11, 7, 3, M.earth[1]); hline(p.cov, cx - 3, 11, 7, M.turf[2]);
    p.door.push([cx - 1, 12, 3, 2]); p.smoke = [cx, 1]; p.top = 1; p.bottom = 13;
    return p;
  }
  const hide: Ramp = [shade(h.hide, -0.1), h.hide, shade(h.hide, 0.14)];
  const skin = h.look === "hot" ? M.thatch : v % 2 ? hide : M.bark;
  const W = 23, Hh = 26, p = parts(W, Hh), cx = 11, base = 25, Hc = 21;
  for (let y = 0; y <= Hc; y++) {
    const half = Math.floor(y * 0.52);
    for (let x = -half; x <= half; x++) {
      let col = x >= half - 1 ? skin[2] : x <= -half + 1 ? skin[0] : skin[1];
      if (skin === M.bark && (y % 4 === 3)) col = skin[2];
      else if (skin === M.thatch && y % 3 === 2) col = shade(col, 0.08);
      else if (skin === hide && (x + 40 + Math.floor(y / 2)) % 5 === 0 && y > 2) col = shade(col, 0.07);
      put(p.cov, cx + x, base - Hc + y, col);
      if (x === -half || x === half || x === 0) put(p.rib, cx + x, base - Hc + y, POLE);
    }
  }
  /* the pole tips crossing above the smoke hole */
  for (const [dx, dy] of [[-2, -1], [-1, -2], [1, -2], [2, -1], [-3, -3], [3, -3]]) put(p.fixed, cx + dx, base - Hc + dy + 1, dx < 0 ? POLE_L : POLE);
  if (skin === hide) for (let y = 5; y < Hc; y += 5) { put(p.cov, cx + Math.floor(y * 0.26), base - Hc + y, h.trim); put(p.cov, cx - Math.floor(y * 0.26), base - Hc + y, h.trim); }
  p.door.push([cx - 1, base - 5, 3, 6]); p.top = base - Hc; p.bottom = base;
  return p;
}

/** A storage pit: a lid of bark slabs weighed down with stones, or open with the baskets showing. */
export function pitSprite(open: boolean, full: boolean): HTMLCanvasElement {
  return cache.get(`pit${open ? 1 : 0}|${full ? 1 : 0}`, () => {
    const g = grid(12, 7);
    /* a low ring of dug-out earth */
    for (let x = 0; x < 12; x++) for (let y = 1; y < 7; y++) {
      const d = Math.hypot((x - 5.5) / 6, (y - 3.8) / 3.2); if (d > 1) continue;
      put(g, x, y, d > 0.75 ? (x < 6 ? M.earth[0] : M.earth[2]) : M.earth[1]);
    }
    if (open) {
      for (let x = 3; x <= 8; x++) for (let y = 3; y <= 5; y++) put(g, x, y, y === 3 ? DARK : INSIDE);
      if (full) { hline(g, 3, 4, 6, "#e0b84a"); put(g, 4, 4, "#c79a32"); put(g, 7, 4, "#a8433a"); hline(g, 3, 5, 6, M.thatch[2]); }
      /* the lid set aside */
      hline(g, 9, 1, 3, M.bark[0]); hline(g, 9, 2, 3, M.bark[2]);
    } else {
      for (let x = 2; x <= 9; x++) for (let y = 2; y <= 5; y++) put(g, x, y, (x + y) % 3 === 0 ? M.bark[2] : y === 2 ? M.bark[0] : M.bark[1]);
      for (const [x, y] of [[3, 2], [7, 3], [5, 5]]) { put(g, x, y, FN.stone); put(g, x + 1, y, FN.rockD); put(g, x, y - 1, FN.rockL); }
    }
    return toCanvas(outlined(g));
  });
}

/** Which look a hut sprite should take for its condition: the build stage (frame, half, done) and wear (sound, worn, a ruin). */
export function hutStage(prog: number, state: number): { stage: number; wear: number } {
  return { stage: prog < 0.4 ? 0 : prog < 1 ? 1 : 2, wear: prog < 1 ? 0 : state < 0.2 ? 2 : state < 0.55 ? 1 : 0 };
}
