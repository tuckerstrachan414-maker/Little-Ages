import { Biome, Flag, type Season, type WorldData } from "../shared/types.ts";
import { seaColor, seaOut } from "../sim/world/bake.ts";
import { FREEZE_T } from "../shared/seasonfx.ts";
import { hash2 } from "../shared/rng.ts";
import { vnoise } from "../shared/noise.ts";

/*
  Close-up ground at eight sprite pixels per tile. The map is one color per tile, so seen up
  close every coast and river would be a staircase of big squares. Here each sprite pixel
  instead asks "how wet is this point?" by blending the four nearest tiles, roughened with a
  little noise, so shorelines and rivers curve. Land and water take their color from a
  neighboring tile chosen by an ordered dither, which turns tile seams into soft pixel-art
  blends; open sea is recolored from its blended depth so the bands follow real contours.
  The same pass finds the shoreline and builds four frames of surf that lap against it.
*/

export const SUB = 8;
const M = 4;   /* margin, in sprite pixels, so surf can see land just past the chunk edge */
const BAYER = (() => {
  const b = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  return new Float32Array(b.map(v => (v + 0.5) / 64));
})();

export interface Fine {
  ground: HTMLCanvasElement; surf: HTMLCanvasElement[] | null;
  /** Is this point (in tiles, relative to the chunk's corner) drawn as water? */
  wet(tx: number, ty: number): boolean;
}

const WATER = 1, SEA = 2, FROZEN = 4;
/*
  The sprite pixels between four tile centers form an 8x8 cell, and inside a cell the blend
  weights of the four tiles only depend on the position in the cell. So the weights, and the
  dithered pick when all four tiles are the same kind of ground, are worked out once here.
*/
const CW = new Float32Array(64 * 4), CPICK = new Uint8Array(64), CAX = new Float32Array(64), CAY = new Float32Array(64), CB = new Float32Array(64);
for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
  const p = i * 8 + j, ax = (j + 0.5) / 8, ay = (i + 0.5) / 8;
  CAX[p] = ax; CAY[p] = ay; CB[p] = BAYER[(((i + 4) & 7) << 3) | ((j + 4) & 7)];
  CW[p * 4] = (1 - ax) * (1 - ay); CW[p * 4 + 1] = ax * (1 - ay); CW[p * 4 + 2] = (1 - ax) * ay; CW[p * 4 + 3] = ax * ay;
  let r = CB[p], k = 0; for (; k < 3; k++) { r -= CW[p * 4 + k]; if (r <= 0) break; } CPICK[p] = k;
}

export function fineGround(wd: WorldData, px: Uint8ClampedArray, season: Season, x0: number, y0: number, cw: number, chh: number): Fine {
  const { w, h, flags, depth, biome, temp, seed } = wd;
  const GW = cw * SUB, GH = chh * SUB, FW = GW + 2 * M, FH = GH + 2 * M;
  /* the tiles this chunk touches, plus a ring of neighbors */
  const TW = cw + 2, TH = chh + 2, nT = TW * TH;
  const tIdx = new Int32Array(nT), tCol = new Uint32Array(nT), tKind = new Uint8Array(nT);
  const freeze = FREEZE_T[season] * 255;
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const gx = Math.max(0, Math.min(w - 1, x0 + tx - 1)), gy = Math.max(0, Math.min(h - 1, y0 + ty - 1)), i = gy * w + gx, t = ty * TW + tx, f = flags[i];
    tIdx[t] = i; tCol[t] = 0xff000000 | (px[i * 4 + 2] << 16) | (px[i * 4 + 1] << 8) | px[i * 4];
    let k = 0;
    if (f & Flag.Water) {
      k = WATER;
      if (f & Flag.Ocean) { k |= SEA; if (temp[i] < 70) { seaColor(gx, gy, depth[i], false, temp[i], season, seed); if (seaOut.ice) k |= FROZEN; } }
      else { if (f & Flag.Lake) k |= SEA; if (temp[i] < freeze) k |= FROZEN; }
    }
    tKind[t] = k;
  }
  const img = new ImageData(GW, GH), out = new Uint32Array(img.data.buffer);
  const kind = new Uint8Array(FW * FH);
  const ci = [0, 0, 0, 0], cwt = [0, 0, 0, 0];
  let hasShore = false;
  const pack = (c: number[]) => 0xff000000 | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0]);
  /* cell (cx, cy) spans tile centers (x0+cx, y0+cy) to (x0+cx+1, y0+cy+1) */
  for (let cy = -1; cy < chh; cy++) for (let cx = -1; cx < cw; cx++) {
    const t0 = (cy + 1) * TW + cx + 1;
    ci[0] = t0; ci[1] = t0 + 1; ci[2] = t0 + TW; ci[3] = t0 + TW + 1;
    const k0 = tKind[ci[0]], k1 = tKind[ci[1]], k2 = tKind[ci[2]], k3 = tKind[ci[3]];
    const nWet = (k0 & 1) + (k1 & 1) + (k2 & 1) + (k3 & 1);
    const sx0 = cx * SUB + 4, sy0 = cy * SUB + 4;
    if (nWet === 0 || nWet === 4) {
      const c0 = tCol[ci[0]], same = c0 === tCol[ci[1]] && c0 === tCol[ci[2]] && c0 === tCol[ci[3]];
      const allSea = (k0 & k1 & k2 & k3 & SEA) && (flags[tIdx[ci[0]]] & flags[tIdx[ci[1]]] & flags[tIdx[ci[2]]] & flags[tIdx[ci[3]]] & Flag.Ocean);
      for (let p = 0; p < 64; p++) {
        const sx = sx0 + (p & 7), sy = sy0 + (p >> 3), k = CPICK[p], t = ci[k];
        kind[(sy + M) * FW + sx + M] = tKind[t];
        if (sx < 0 || sy < 0 || sx >= GW || sy >= GH) continue;
        if (same) { out[sy * GW + sx] = c0; continue; }
        if (allSea) {
          /* open water: recolor from the blended depth so the bands follow smooth contours */
          let dv = 0; for (let q = 0; q < 4; q++) dv += CW[p * 4 + q] * depth[tIdx[ci[q]]];
          out[sy * GW + sx] = pack(seaColor(x0 + cx + CAX[p], y0 + cy + CAY[p], dv, biome[tIdx[t]] === Biome.Shelf, temp[tIdx[t]], season, seed));
        } else out[sy * GW + sx] = tCol[t];
      }
      continue;
    }
    /* a shore or riverbank runs through this cell */
    const saddle = nWet === 2 && (k0 & 1) === (k3 & 1);
    for (let p = 0; p < 64; p++) {
      const sx = sx0 + (p & 7), sy = sy0 + (p >> 3), ax = CAX[p], ay = CAY[p];
      let wet = 0; for (let q = 0; q < 4; q++) { cwt[q] = CW[p * 4 + q]; wet += (tKind[ci[q]] & 1) * cwt[q]; }
      /* a river stepping diagonally keeps its channel open through the corner */
      if (saddle) wet += 0.3 * Math.max(0, 1 - 2 * Math.abs(k0 & 1 ? ax - ay : ax + ay - 1));
      wet += (vnoise((x0 * SUB + sx) / 5, (y0 * SUB + sy) / 5, seed + 301) - 0.5) * 0.3;
      const water = wet > 0.5 ? 1 : 0;
      let total = 0; for (let q = 0; q < 4; q++) { if ((tKind[ci[q]] & 1) !== water) cwt[q] = 0; total += cwt[q]; }
      let r = CB[p] * total, t = ci[0];
      for (let q = 0; q < 4; q++) { if (cwt[q] > 0) { t = ci[q]; r -= cwt[q]; if (r <= 0) break; } }
      const kd = tKind[t];
      kind[(sy + M) * FW + sx + M] = kd;
      if (sx < 0 || sy < 0 || sx >= GW || sy >= GH) continue;
      if ((kd & SEA) && !(kd & FROZEN)) hasShore = true;
      if (water && (flags[tIdx[t]] & Flag.Ocean)) {
        let dv = 0; for (let q = 0; q < 4; q++) dv += CW[p * 4 + q] * (flags[tIdx[ci[q]]] & Flag.Ocean ? depth[tIdx[ci[q]]] : 0);
        out[sy * GW + sx] = pack(seaColor(x0 + cx + ax, y0 + cy + ay, dv, biome[tIdx[t]] === Biome.Shelf, temp[tIdx[t]], season, seed));
      } else out[sy * GW + sx] = tCol[t];
    }
  }
  const ground = document.createElement("canvas"); ground.width = GW; ground.height = GH;
  ground.getContext("2d")!.putImageData(img, 0, 0);
  const wet = (tx: number, ty: number) => { const sx = Math.floor(tx * SUB) + M, sy = Math.floor(ty * SUB) + M; return sx >= 0 && sy >= 0 && sx < FW && sy < FH && (kind[sy * FW + sx] & WATER) !== 0; };
  return { ground, surf: hasShore ? surf(kind, FW, FH, GW, GH, x0, y0, seed) : null, wet };
}

/* Distance (in sprite pixels) from open water to the nearest land, then four frames of surf:
   a bright line where water meets the shore and a broken wave that rolls in and out. */
function surf(kind: Uint8Array, FW: number, FH: number, GW: number, GH: number, x0: number, y0: number, seed: number): HTMLCanvasElement[] {
  const D = new Float32Array(FW * FH).fill(99);
  for (let i = 0; i < kind.length; i++) if (!(kind[i] & WATER) || (kind[i] & FROZEN)) D[i] = 0;
  const R2 = Math.SQRT2;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const i = y * FW + x; if (!D[i]) continue; let d = D[i];
    if (x > 0) d = Math.min(d, D[i - 1] + 1); if (y > 0) { d = Math.min(d, D[i - FW] + 1); if (x > 0) d = Math.min(d, D[i - FW - 1] + R2); if (x < FW - 1) d = Math.min(d, D[i - FW + 1] + R2); } D[i] = d; }
  for (let y = FH - 1; y >= 0; y--) for (let x = FW - 1; x >= 0; x--) { const i = y * FW + x; if (!D[i]) continue; let d = D[i];
    if (x < FW - 1) d = Math.min(d, D[i + 1] + 1); if (y < FH - 1) { d = Math.min(d, D[i + FW] + 1); if (x < FW - 1) d = Math.min(d, D[i + FW + 1] + R2); if (x > 0) d = Math.min(d, D[i + FW - 1] + R2); } D[i] = d; }
  const RING = [1.6, 2.6, 3.6, 2.6];
  /* only pixels near the shore can carry surf: list them once with their wave phase */
  const near: number[] = [];
  for (let sy = 0; sy < GH; sy++) for (let sx = 0; sx < GW; sx++) {
    const i = (sy + M) * FW + sx + M; if (!(kind[i] & SEA) || (kind[i] & FROZEN) || D[i] > 4.2) continue;
    const wx = x0 * SUB + sx, wy = y0 * SUB + sy;
    near.push(sy * GW + sx, D[i], Math.floor(vnoise(wx / 37, wy / 37, seed + 311) * 8) & 3, hash2(wx >> 1, wy >> 1, seed + 313) > 0.28 ? 1 : 0, wx, wy);
  }
  const frames: HTMLCanvasElement[] = [];
  const FOAM = 0x00e8f0e8;   /* r 232, g 240, b 232 */
  for (let f = 0; f < 4; f++) {
    const img = new ImageData(GW, GH), o32 = new Uint32Array(img.data.buffer);
    for (let n = 0; n < near.length; n += 6) {
      const d = near[n + 1];
      let a = 0;
      if (d <= 1.01) a = 0.82;
      else if (near[n + 3] && Math.abs(d - RING[(f + near[n + 2]) & 3]) < 0.55) a = 0.42;
      else if (d <= 1.5 && hash2(near[n + 4], near[n + 5], seed + 317 + f) < 0.3) a = 0.35;
      if (a) o32[near[n]] = ((a * 255) << 24 | FOAM) >>> 0;
    }
    const c = document.createElement("canvas"); c.width = GW; c.height = GH; c.getContext("2d")!.putImageData(img, 0, 0); frames.push(c);
  }
  return frames;
}
