import { Biome, Flag, type WorldData } from "../../shared/types.ts";
import { FREEZE_T } from "../../shared/seasonfx.ts";

/*
  Getting around on foot. Every tile has a cost to cross: open ground is easy, woods and
  marsh slower, mountains hard, snowfields and ice sheets very hard. People wade streams
  and swim rivers (slowly), but cannot cross lakes or the sea, except over ice in a hard
  winter. Routes come from a straight line when nothing is in the way, otherwise from an
  A* search in a window around the trip, so walks curve round lakes and along coasts.
  Each season the walker also maps which ground joins up on foot, so nobody sets out for
  a shore they can see but never reach.
*/

const BIOME_COST: Partial<Record<number, number>> = {
  [Biome.TemperateForest]: 1.25, [Biome.TemperateRainforest]: 1.35, [Biome.Taiga]: 1.3, [Biome.Rainforest]: 1.5, [Biome.TropicalForest]: 1.35,
  [Biome.Swamp]: 1.9, [Biome.Mountain]: 2.3, [Biome.Cliff]: 3.2, [Biome.SnowPeak]: 7, [Biome.IceSheet]: 5, [Biome.Shingle]: 1.2, [Biome.Beach]: 1.1,
  [Biome.HotDesert]: 1.25, [Biome.ColdDesert]: 1.2, [Biome.Tundra]: 1.15, [Biome.Shrubland]: 1.1,
};
export const BLOCKED = 1e9;

export class Walker {
  readonly w: WorldData;
  /** cost per tile for the current season, recomputed when the season turns */
  cost: Float32Array;
  /** which stretch of walkable ground each tile belongs to this season (0 for water nobody can cross) */
  region: Int32Array;
  private season = -1;
  private fill = new Int32Array(0);
  constructor(w: WorldData) { this.w = w; this.cost = new Float32Array(w.w * w.h); this.region = new Int32Array(w.w * w.h); this.setSeason(1); }

  setSeason(season: number): void {
    if (season === this.season) return;
    this.season = season;
    const { w, flags, biome, depth, temp } = this.w, freeze = FREEZE_T[season] * 255;
    for (let i = 0; i < w * this.w.h; i++) {
      const f = flags[i];
      if (f & Flag.Water) {
        const frozen = temp[i] < freeze;
        if (f & Flag.River) this.cost[i] = frozen ? 1.6 : depth[i] >= 3 ? 7 : 2.4 * Math.max(1, depth[i]);
        else this.cost[i] = frozen && !(f & Flag.Ocean && depth[i] > 6) ? 2 : BLOCKED;
      } else this.cost[i] = BIOME_COST[biome[i]] ?? 1;
    }
    this.mapRegions();
  }
  /* flood-fills the walkable ground; a diagonal step needs both side tiles open, so side-by-side neighbors are enough */
  private mapRegions(): void {
    const W = this.w.w, H = this.w.h, region = this.region, cost = this.cost;
    region.fill(0);
    /* every tile is queued at most once, so the queue never needs more room than the map */
    if (this.fill.length < W * H) this.fill = new Int32Array(W * H);
    const stack = this.fill;
    let label = 0;
    for (let i = 0; i < W * H; i++) {
      if (region[i] || cost[i] >= BLOCKED) continue;
      const x = i % W, y = (i / W) | 0;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      label++; region[i] = label;
      let top = 0; stack[top++] = i;
      while (top > 0) {
        const c = stack[--top], cx = c % W, cy = (c / W) | 0;
        if (cx > 1 && !region[c - 1] && cost[c - 1] < BLOCKED) { region[c - 1] = label; stack[top++] = c - 1; }
        if (cx < W - 2 && !region[c + 1] && cost[c + 1] < BLOCKED) { region[c + 1] = label; stack[top++] = c + 1; }
        if (cy > 1 && !region[c - W] && cost[c - W] < BLOCKED) { region[c - W] = label; stack[top++] = c - W; }
        if (cy < H - 2 && !region[c + W] && cost[c + W] < BLOCKED) { region[c + W] = label; stack[top++] = c + W; }
      }
    }
  }
  regionAt(x: number, y: number): number {
    const xi = x | 0, yi = y | 0;
    if (xi < 1 || yi < 1 || xi >= this.w.w - 1 || yi >= this.w.h - 1) return 0;
    return this.region[yi * this.w.w + xi];
  }
  /** True if there is a way on foot from a to b this season. */
  reach(ax: number, ay: number, bx: number, by: number): boolean { const r = this.regionAt(ax, ay); return r > 0 && r === this.regionAt(bx, by); }
  at(x: number, y: number): number {
    const xi = x | 0, yi = y | 0;
    if (xi < 1 || yi < 1 || xi >= this.w.w - 1 || yi >= this.w.h - 1) return BLOCKED;
    return this.cost[yi * this.w.w + xi];
  }
  passable(x: number, y: number): boolean { return this.at(x, y) < BLOCKED; }
  /** Dry, walkable ground (no wading). */
  dry(x: number, y: number): boolean { const c = this.at(x, y); return c < 4 && !(this.w.flags[(y | 0) * this.w.w + (x | 0)] & Flag.Water); }

  /** True if walking straight from a to b crosses nothing harder than `maxCost` per tile. */
  lineClear(x0: number, y0: number, x1: number, y1: number, maxCost = 3.5): boolean {
    const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
    for (let k = 1; k <= n; k++) { const t = k / n; if (this.at(x0 + dx * t, y0 + dy * t) > maxCost) return false; }
    return true;
  }

  /* scratch for the windowed search, reused between calls */
  private gS = new Float64Array(0); private from = new Int32Array(0); private stamp = new Uint32Array(0); private gen = 1;
  private heap = new Int32Array(0); private hf = new Float32Array(0);

  /**
    A route from (sx, sy) to (gx, gy) as a list of waypoints [x0, y0, x1, y1, ...] ending at
    the goal, or null if there is none within reach. `budget` caps how many tiles it may look at.
  */
  route(sx: number, sy: number, gx: number, gy: number, budget = 9000, far = false): number[] | null {
    if (!this.passable(gx, gy) || !this.reach(sx, sy, gx, gy)) return null;
    if (this.lineClear(sx, sy, gx, gy)) return [gx, gy];
    /* the ground joins up, but the way round may run outside a tight window: widen it, and for the long way home, search the whole map */
    return this.search(sx, sy, gx, gy, budget, 18, 320) ?? this.search(sx, sy, gx, gy, Math.max(budget, 90000), 90, 640)
      ?? (far ? this.search(sx, sy, gx, gy, Math.max(budget, 300000), 1 << 14, 1 << 14) : null);
  }
  private search(sx: number, sy: number, gx: number, gy: number, budget: number, m: number, maxSide: number): number[] | null {
    const W = this.w.w, H = this.w.h;
    const x0 = Math.max(1, Math.floor(Math.min(sx, gx)) - m), y0 = Math.max(1, Math.floor(Math.min(sy, gy)) - m);
    const x1 = Math.min(W - 2, Math.ceil(Math.max(sx, gx)) + m), y1 = Math.min(H - 2, Math.ceil(Math.max(sy, gy)) + m);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, N = bw * bh;
    if (bw > maxSide || bh > maxSide) return null;
    if (this.gS.length < N) { this.gS = new Float64Array(N); this.from = new Int32Array(N); this.stamp = new Uint32Array(N); }
    /* tiles can be queued more than once (when a shorter way to them turns up), so the queue needs room to spare */
    const cap = Math.min(budget * 8 + 64, N * 8);
    if (this.heap.length < cap) { this.heap = new Int32Array(cap); this.hf = new Float32Array(cap); }
    const gen = ++this.gen;
    const loc = (x: number, y: number) => (y - y0) * bw + (x - x0);
    const sxi = Math.floor(sx), syi = Math.floor(sy), gxi = Math.floor(gx), gyi = Math.floor(gy), goal = loc(gxi, gyi);
    const hOf = (x: number, y: number) => { const ax = Math.abs(x - gxi), ay = Math.abs(y - gyi); return Math.max(ax, ay) + 0.414 * Math.min(ax, ay); };
    let hn = 0;
    const push = (n: number, f: number) => { if (hn >= this.heap.length) return; let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (this.hf[p] <= f) break; this.heap[i] = this.heap[p]; this.hf[i] = this.hf[p]; i = p; } this.heap[i] = n; this.hf[i] = f; };
    const pop = () => { const top = this.heap[0]; const ln = this.heap[--hn], lf = this.hf[hn]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && this.hf[c + 1] < this.hf[c]) c++; if (this.hf[c] >= lf) break; this.heap[i] = this.heap[c]; this.hf[i] = this.hf[c]; i = c; } this.heap[i] = ln; this.hf[i] = lf; return top; };
    const s0 = loc(sxi, syi); this.stamp[s0] = gen; this.gS[s0] = 0; this.from[s0] = -1; push(s0, hOf(sxi, syi));
    let found = false, seen = 0;
    while (hn > 0 && seen < budget) {
      const cur = pop(); seen++;
      if (cur === goal) { found = true; break; }
      const cx = (cur % bw) + x0, cy = ((cur / bw) | 0) + y0, g = this.gS[cur];
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const c = this.cost[ny * W + nx]; if (c >= BLOCKED) continue;
        /* no cutting corners past water */
        if (d >= 4 && (this.cost[cy * W + nx] >= BLOCKED || this.cost[ny * W + cx] >= BLOCKED)) continue;
        const n = loc(nx, ny), ng = g + c * (d >= 4 ? 1.414 : 1);
        if (this.stamp[n] === gen && ng >= this.gS[n]) continue;
        this.stamp[n] = gen; this.gS[n] = ng; this.from[n] = cur; push(n, ng + hOf(nx, ny));
      }
    }
    if (!found) return null;
    /* walk back, then pull the string tight so routes are straight where they can be */
    const chain: number[] = [];
    for (let n = goal; n >= 0; n = this.from[n]) chain.push(n);
    const tiles: number[] = [];
    for (let k = chain.length - 1; k >= 0; k--) tiles.push((chain[k] % bw) + x0 + 0.5, ((chain[k] / bw) | 0) + y0 + 0.5);
    const pts: number[] = [];
    let ax = sx, ay = sy, k = 0;
    const last = tiles.length / 2 - 1;
    while (k < last) {
      let j = Math.min(last, k + 24);
      while (j > k + 1 && !this.lineClear(ax, ay, tiles[j * 2], tiles[j * 2 + 1], 2.6)) j--;
      ax = tiles[j * 2]; ay = tiles[j * 2 + 1]; pts.push(ax, ay); k = j;
    }
    pts.push(gx, gy);
    return pts;
  }
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
