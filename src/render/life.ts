import type { Camera } from "./camera.ts";
import { birdSprite, rabbitSprite } from "./sprites/animals.ts";
import { Flag, type WorldData } from "../shared/types.ts";
import { hash2 } from "../shared/rng.ts";

/*
  Small life drawn from the simulation's numbers. The worker keeps how many rabbits and
  fish each patch holds; up close, that many individuals show up, each living its own
  little loop (sit, nibble, hop) so a well-stocked meadow visibly teems and a hunted-out
  one goes quiet. Bird flocks are simulated one by one and only drawn here.
*/

export interface Fields { gw: number; gh: number; cell: number; rabbits: Uint8Array; fish: Uint8Array; }
export interface FlockSnap { n: number; data: Float32Array; }
export const BIRD_STRIDE = 7;

const fieldAt = (f: Fields, arr: Uint8Array, x: number, y: number) => arr[Math.min(f.gh - 1, (y / f.cell) | 0) * f.gw + Math.min(f.gw - 1, (x / f.cell) | 0)] / 255;

/* Only a few tiles in a hundred can ever hold a rabbit or a leaping fish, so each 32x32 block
   lists its candidates once and every frame just walks those lists. */
const RABBIT_MAX = 0.03, FISH_MAX = 0.01;
const blocks = new WeakMap<WorldData, Map<number, Int32Array>>();
function candidates(wd: WorldData, bx: number, by: number): Int32Array {
  let m = blocks.get(wd); if (!m) { m = new Map(); blocks.set(wd, m); }
  const key = by * 4096 + bx; let c = m.get(key); if (c) return c;
  const out: number[] = [];
  for (let y = by * 32; y < Math.min(wd.h, by * 32 + 32); y++) for (let x = bx * 32; x < Math.min(wd.w, bx * 32 + 32); x++) {
    const water = (wd.flags[y * wd.w + x] & Flag.Water) !== 0;
    if (water ? hash2(x, y, wd.seed + 601) < FISH_MAX : hash2(x, y, wd.seed + 501) < RABBIT_MAX) out.push(x, y);
  }
  c = new Int32Array(out); m.set(key, c); return c;
}
function* visibleCandidates(cam: Camera, wd: WorldData): Generator<[number, number]> {
  const v = cam.visible();
  for (let by = v.y0 >> 5; by <= (v.y1 - 1) >> 5; by++) for (let bx = v.x0 >> 5; bx <= (v.x1 - 1) >> 5; bx++) {
    const list = candidates(wd, bx, by);
    for (let n = 0; n < list.length; n += 2) { const x = list[n], y = list[n + 1]; if (x >= v.x0 - 1 && x <= v.x1 && y >= v.y0 - 1 && y <= v.y1) yield [x, y]; }
  }
}

/** Rabbits on the visible land, from z >= 10. Uses game time, so they freeze when paused. */
export function drawRabbits(ctx: CanvasRenderingContext2D, cam: Camera, wd: WorldData, f: Fields, t: number, season: number): void {
  const z = cam.z; if (z < 10) return;
  const k = z / 8, seed = wd.seed + 501;
  for (const [x, y] of visibleCandidates(cam, wd)) {
    const i = y * wd.w + x; if (wd.flags[i] & Flag.Water) continue;
    if (hash2(x, y, seed) > fieldAt(f, f.rabbits, x, y) * RABBIT_MAX) continue;
    /* each rabbit hops between spots near its burrow, then sits a while */
    const phase = hash2(x, y, seed + 1) * 10, cyc = (t / 2.4 + phase), n = Math.floor(cyc), u = cyc - n;
    const at = (m: number): [number, number] => { const ox = (hash2(x * 7 + m, y, seed + 2) - 0.5) * 1.6, oy = (hash2(x, y * 7 + m, seed + 3) - 0.5) * 1.2; const tx = Math.floor(x + 0.5 + ox), ty = Math.floor(y + 0.5 + oy); return tx >= 0 && ty >= 0 && tx < wd.w && ty < wd.h && !(wd.flags[ty * wd.w + tx] & Flag.Water) ? [x + 0.5 + ox, y + 0.5 + oy] : [x + 0.5, y + 0.5]; };
    const [bx, by] = at(n), hopping = u < 0.16;
    let px = bx, py = by, lift = 0;
    if (hopping) { const [ax, ay] = at(n - 1), q = u / 0.16; px = ax + (bx - ax) * q; py = ay + (by - ay) * q; lift = Math.sin(q * Math.PI) * 0.35; }
    const facing = bx >= at(n - 1)[0] ? 1 : -1;
    const white = season === 3 && wd.temp[i] < 100;
    const spr = rabbitSprite(hopping ? 1 : 0, white);
    const [sx, sy] = cam.toScreen(px, py - lift);
    const w = spr.width * k, hh = spr.height * k;
    ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); if (facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(spr, Math.round(-w / 2), Math.round(-hh), Math.round(w), Math.round(hh)); ctx.restore();
  }
}

/** Fish leaping and schools darkening the shallows, from z >= 8. Real time, so the sea keeps moving. */
export function drawFish(ctx: CanvasRenderingContext2D, cam: Camera, wd: WorldData, f: Fields, now: number, season: number): void {
  const z = cam.z; if (z < 8) return;
  const k = z / 8, seed = wd.seed + 601, px = Math.max(1, Math.round(k));
  for (const [x, y] of visibleCandidates(cam, wd)) {
    const i = y * wd.w + x; if (!(wd.flags[i] & Flag.Water)) continue;
    if (season === 3 && wd.temp[i] < 115) continue;   /* under the ice */
    const h = hash2(x, y, seed), dens = fieldAt(f, f.fish, x, y);
    /* a school: a shadow of small dark fish wheeling slowly in the shallows */
    if (h < dens * 0.0035 && wd.depth[i] <= 12) {
      const a0 = now / 2600 + hash2(x, y, seed + 1) * 6.28;
      ctx.fillStyle = "rgba(20,40,52,0.35)";
      for (let m = 0; m < 7; m++) { const a = a0 + m * 0.28, r = 0.9 + (m % 3) * 0.18; const [sx, sy] = cam.toScreen(x + 0.5 + Math.cos(a) * r, y + 0.5 + Math.sin(a) * r * 0.6); ctx.fillRect(Math.round(sx), Math.round(sy), 2 * px, px); }
      continue;
    }
    /* now and then one leaps, and leaves a ring */
    if (h > 0.004 + dens * 0.006 || h < 0.004) continue;
    const P = 6500 + hash2(x, y, seed + 2) * 5000, u = ((now + hash2(x, y, seed + 3) * P) % P) / P * (P / 1000);   /* seconds into its cycle */
    const ox = x + 0.3 + hash2(x, y, seed + 4) * 0.4, oy = y + 0.3 + hash2(x, y, seed + 5) * 0.4;
    if (u < 0.55) {
      const q = u / 0.55, [sx, sy] = cam.toScreen(ox - 0.25 + q * 0.5, oy - Math.sin(q * Math.PI) * 0.45);
      ctx.fillStyle = "#c8d4d8"; ctx.fillRect(Math.round(sx), Math.round(sy), 2 * px, px); ctx.fillStyle = "#8a9aa2"; ctx.fillRect(Math.round(sx) - px, Math.round(sy) + (q < 0.5 ? px : -px), px, px);
    } else if (u < 1.9) {
      const q = (u - 0.55) / 1.35, r = (0.15 + q * 0.5) * z, [sx, sy] = cam.toScreen(ox + 0.25, oy);
      ctx.strokeStyle = `rgba(226,238,232,${(0.7 * (1 - q)).toFixed(2)})`; ctx.lineWidth = px;
      ctx.strokeRect(Math.round(sx - r), Math.round(sy - r * 0.5), Math.round(r * 2), Math.max(px, Math.round(r)));
    }
  }
}

/** Bird flocks: resting ones on the ground up close, flying ones with their shadows below. */
export function drawBirds(ctx: CanvasRenderingContext2D, cam: Camera, cur: FlockSnap | null, prev: FlockSnap | null, a: number, now: number, flying: boolean): void {
  const z = cam.z; if (!cur || z < 1.5) return;
  const v = cam.visible(), k = z >= 8 ? z / 8 : 1;   /* below true scale, birds stay a few pixels big so they read */
  const prevAt = new Map<number, number>(); if (prev) for (let j = 0; j < prev.n; j++) prevAt.set(prev.data[j * BIRD_STRIDE], j);
  for (let j = 0; j < cur.n; j++) {
    const o = j * BIRD_STRIDE, id = cur.data[o], kind = cur.data[o + 1], n = cur.data[o + 4], heading = cur.data[o + 5], state = cur.data[o + 6];
    if ((state > 0.5) !== flying) continue;
    let x = cur.data[o + 2], y = cur.data[o + 3];
    const pj = prevAt.get(id); if (pj !== undefined && prev) { const po = pj * BIRD_STRIDE; x = prev.data[po + 2] + (x - prev.data[po + 2]) * a; y = prev.data[po + 3] + (y - prev.data[po + 3]) * a; }
    if (x < v.x0 - 12 || x > v.x1 + 12 || y < v.y0 - 12 || y > v.y1 + 12) continue;
    if (!flying && z < 8) continue;
    const hx = Math.cos(heading), hy = Math.sin(heading), alt = kind === 1 ? 1.2 : 2.6;
    for (let m = 0; m < n; m++) {
      let mx: number, my: number;
      if (!flying) { const r = Math.sqrt(m + 0.5) * (kind === 0 ? 0.55 : 0.4), an = m * 2.399 + id; mx = x + Math.cos(an) * r; my = y + Math.sin(an) * r * 0.6; }
      else if (kind === 0) { const rank = Math.ceil(m / 2), side = m % 2 ? 1 : -1; mx = x - hx * rank * 0.9 - hy * side * rank * 0.75; my = y - hy * rank * 0.9 + hx * side * rank * 0.75; }
      else { const an = now / (kind === 1 ? 420 : 1300) * (m % 2 ? 1 : -1) + m * 1.7 + id, r = (kind === 1 ? 0.5 : 1.4) + (m % 4) * 0.35; mx = x + Math.cos(an) * r; my = y + Math.sin(an) * r * 0.7; }
      const frame = flying ? Math.floor(now / (kind === 1 ? 90 : kind === 0 ? 220 : 300) + m * 0.7) % 2 : Math.floor(now / 1400 + m * 0.37) % 5 === 0 ? 1 : 0;
      if (z < 4 && flying) { const [sx, sy] = cam.toScreen(mx, my - alt); ctx.fillStyle = kind === 2 ? "#f4f2ec" : "#2c2824"; ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1); continue; }
      const spr = birdSprite(kind, frame, !flying), w = spr.width * k, hh = spr.height * k;
      if (flying) {
        /* shadow on the ground, offset away from the northwest sun */
        const [gx, gy] = cam.toScreen(mx + 0.6, my + 0.4);
        ctx.fillStyle = "rgba(12,14,24,0.22)"; ctx.fillRect(Math.round(gx - w * 0.3), Math.round(gy), Math.round(w * 0.6), Math.max(1, Math.round(k)));
      }
      const [sx, sy] = cam.toScreen(mx, my - (flying ? alt : 0));
      const facing = hx >= 0 ? 1 : -1;
      ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); if (facing < 0 || (!flying && (m & 1))) ctx.scale(-1, 1);
      ctx.drawImage(spr, Math.round(-w / 2), Math.round(-hh), Math.round(w), Math.round(hh)); ctx.restore();
    }
  }
}
