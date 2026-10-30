import { Tree, DAY_SECONDS, type WorldData } from "../shared/types.ts";
import { hash2 } from "../shared/rng.ts";
import { CELL } from "./ecology.ts";
import { generateDeposits, type Deposit } from "./world/geology.ts";
import { Mat, MATS, matByName } from "./economy/goods.ts";

/*
  What the land holds and gives up: the deposits laid down with the world, and the wood
  standing on every treed tile. Both are finite. Digging a deposit empties it; cutting a
  tree brings it down, and a felled wood comes back only slowly, from its edges, over the
  years. Each people remembers the deposits its explorers have found.
*/

const STOCK: Partial<Record<number, number>> = {
  [Tree.Oak]: 24, [Tree.Beech]: 24, [Tree.Pine]: 24, [Tree.Spruce]: 24, [Tree.Fir]: 24, [Tree.Larch]: 22, [Tree.Jungle]: 24, [Tree.Baobab]: 24, [Tree.Cypress]: 20,
  [Tree.Maple]: 18, [Tree.Birch]: 16, [Tree.Aspen]: 14, [Tree.Willow]: 16, [Tree.Palm]: 14, [Tree.Acacia]: 14, [Tree.Mangrove]: 14,
  [Tree.Shrub]: 6, [Tree.BerryBush]: 5, [Tree.Snag]: 4,
};
/** Trees nobody cuts for wood. */
const NEVER = new Set<number>([Tree.Reeds, Tree.Cactus]);
/** The daily chance a cleared tile ringed by trees grows its tree back: a felled wood returns from its edges over a few decades. */
const REGROW = 0.0012;

export class Resources {
  readonly w: WorldData;
  deposits: Deposit[];
  private byCell = new Map<number, number[]>();
  /** wood standing on each tile, in loads (0 on bare ground; 255 on what is never cut) */
  stock: Uint8Array;
  /** the species that grew on each tile when the world was made, for what grows back */
  orig: Uint8Array;
  /** tiles whose tree changed since the page last heard, as [index, tree] pairs */
  changed: number[] = [];
  /** cleared tiles, and when each was cleared */
  private cleared = new Map<number, number>();
  /** ecology patches whose trees changed since the ecology last recounted them */
  private dirty = new Set<number>();
  /** tiles that grew their trees back today */
  regrownToday: number[] = [];
  /** the deposits each people knows of */
  known = new Map<number, Set<number>>();
  /** wood cut and trees felled, deposits found and dug out, trees grown back */
  stats = { cut: 0, felled: 0, regrown: 0, dug: 0, found: 0, exhausted: 0 };
  private gw: number;

  constructor(w: WorldData, seed: number) {
    this.w = w;
    this.deposits = generateDeposits(w, seed);
    this.gw = Math.ceil(w.w / CELL);
    for (const d of this.deposits) {
      const c = this.cellOf(d.x, d.y); let l = this.byCell.get(c); if (!l) { l = []; this.byCell.set(c, l); } l.push(d.id);
    }
    this.stock = new Uint8Array(w.w * w.h); this.orig = w.tree.slice();
    for (let i = 0; i < w.tree.length; i++) { const t = w.tree[i]; if (!t) continue; this.stock[i] = NEVER.has(t) ? 255 : (STOCK[t] ?? 12); }
  }
  private cellOf(x: number, y: number): number { return ((y / CELL) | 0) * this.gw + ((x / CELL) | 0); }
  byId(id: number): Deposit | undefined { return this.deposits[id - 1]; }

  /** Deposits with anything left within r tiles of (x, y). */
  depositsNear(x: number, y: number, r: number): Deposit[] {
    const R = Math.ceil(r / CELL), cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    let out: Deposit[] | null = null;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= this.gw) continue;
      const l = this.byCell.get(yy * this.gw + xx); if (!l) continue;
      for (const id of l) { const d = this.deposits[id - 1]; if (d.left > 0 && Math.hypot(d.x - x, d.y - y) <= r) (out ??= []).push(d); }
    }
    return out ? out.sort((a, b) => a.id - b.id) : [];
  }
  /** Which peoples know each deposit, one bit per people, for the map. */
  knownBy(): Uint32Array {
    const out = new Uint32Array(this.deposits.length);
    for (const [culture, set] of this.known) { if (culture >= 32) continue; for (const id of set) out[id - 1] |= 1 << culture; }
    return out;
  }
  /** Whether a people knows a deposit of a material (by id or name) within r tiles of (x, y). */
  knownNear(culture: number, x: number, y: number, r: number, what: number | string): boolean {
    const kind = typeof what === "string" ? matByName(what) : what, k = this.known.get(culture); if (!k) return false;
    for (const d of this.depositsNear(x, y, r)) if (d.kind === kind && k.has(d.id)) return true;
    return false;
  }
  /** The nearest known deposit of a material to (x, y) within r. */
  knownDeposit(culture: number, x: number, y: number, r: number, kind: number): Deposit | null {
    const k = this.known.get(culture); if (!k) return null;
    let best: Deposit | null = null, bd = r;
    for (const d of this.depositsNear(x, y, r)) if (d.kind === kind && k.has(d.id)) { const dist = Math.hypot(d.x - x, d.y - y); if (dist < bd) { bd = dist; best = d; } }
    return best;
  }
  /** A people finds a deposit. Returns true if it was new to them. */
  find(culture: number, dep: Deposit): boolean {
    let k = this.known.get(culture); if (!k) { k = new Set(); this.known.set(culture, k); }
    if (k.has(dep.id)) return false;
    k.add(dep.id); this.stats.found++; return true;
  }
  /** Takes up to amt out of a deposit; returns what came out. Exhausted deposits give nothing. */
  take(dep: Deposit, amt: number): number {
    const got = Math.min(amt, dep.left);
    if (got <= 0) return 0;
    dep.left -= got; this.stats.dug += got;
    if (dep.left <= 0) { dep.left = 0; this.stats.exhausted++; }
    return got;
  }
  /** Cuts wood from the tree on a tile: returns the loads that came off it. A bare tile gives what the land has (sticks and brush), without a tree to fell. */
  cut(x: number, y: number, amt: number, time: number): number {
    const i = (y | 0) * this.w.w + (x | 0), t = this.w.tree[i];
    if (!t || t === Tree.Snag) return amt * 0.5;
    if (NEVER.has(t)) return amt;
    const got = Math.min(amt, this.stock[i]);
    this.stock[i] -= got; this.stats.cut += got;
    if (this.stock[i] <= 0) { this.setTree(i, Tree.Snag); this.stock[i] = STOCK[Tree.Snag]!; this.cleared.set(i, time); this.stats.felled++; }
    return got;
  }
  /** Cuts from the best-stocked tree beside where someone stands (or under them): wood is gathered standing beside the trunk. */
  cutNear(x: number, y: number, amt: number, time: number): number {
    const W = this.w.w, H = this.w.h, tx = x | 0, ty = y | 0;
    let bi = -1, bs = 0;
    for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const xx = tx + dx, yy = ty + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = yy * W + xx, t = this.w.tree[i]; if (!t || t === Tree.Snag || NEVER.has(t)) continue;
      if (this.stock[i] > bs) { bs = this.stock[i]; bi = i; }
    }
    if (bi < 0) return amt * 0.5;
    return this.cut(bi % W, (bi / W) | 0, amt, time);
  }
  /** Whether wood can be cut from the tree on a tile (a standing tree with wood left on it). */
  cuttable(i: number): boolean { const t = this.w.tree[i]; return !!t && t !== Tree.Snag && !NEVER.has(t) && this.stock[i] > 0; }
  private setTree(i: number, t: number): void {
    this.w.tree[i] = t; this.changed.push(i, t);
    this.dirty.add(((((i / this.w.w) | 0) / CELL) | 0) * this.gw + (((i % this.w.w) / CELL) | 0));
  }
  /** The ecology patches whose trees changed since last asked. */
  takeDirty(): number[] { if (!this.dirty.size) return []; const out = [...this.dirty]; this.dirty.clear(); return out; }

  /** Once a day: snags rot away, and cleared ground beside trees slowly grows its old trees back. */
  daily(time: number, moistAt?: (x: number, y: number) => number): void {
    const W = this.w.w, H = this.w.h, day = (time / DAY_SECONDS) | 0;
    this.regrownToday.length = 0;
    for (const [i, at] of this.cleared) {
      const t = this.w.tree[i], x = i % W, y = (i / W) | 0;
      /* a dead tree stands about a year, then falls */
      if (t === Tree.Snag) { if (time - at > DAY_SECONDS * 40 && hash2(x, y, day) < 0.05) { this.setTree(i, Tree.None); this.stock[i] = 0; } continue; }
      if (t !== Tree.None) { this.cleared.delete(i); continue; }
      let trees = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H || (dx === 0 && dy === 0)) continue; const n = this.w.tree[yy * W + xx]; if (n && n !== Tree.Snag) trees++; }
      if (!trees) continue;
      const moist = moistAt ? moistAt(x, y) : 0.6;
      if (hash2(x, y, day + 77) < REGROW * (trees / 8) * (0.3 + moist)) {
        const sp = this.orig[i] || Tree.Shrub;
        this.setTree(i, sp); this.stock[i] = NEVER.has(sp) ? 255 : (STOCK[sp] ?? 12); this.cleared.delete(i); this.stats.regrown++; this.regrownToday.push(i);
      }
    }
    for (const d of this.deposits) if (MATS[d.kind].regrows && d.left < d.amount) d.left = Math.min(d.amount, d.left + d.amount / 400);
  }
  /** The tiles that changed since last asked, for the page, as [index, tree] pairs. */
  takeChanges(): Int32Array | null {
    if (!this.changed.length) return null;
    const out = new Int32Array(this.changed); this.changed = []; return out;
  }
  /** What is left of each deposit, 0..255, for the map. */
  leftSnap(): Uint8Array { const out = new Uint8Array(this.deposits.length); this.deposits.forEach((d, k) => { out[k] = Math.round(255 * d.left / Math.max(1, d.amount)); }); return out; }
  /** Wood standing within r tiles of (x, y), as a share of what stood there at the start. */
  forestLeft(x: number, y: number, r: number): number {
    let now = 0, was = 0; const W = this.w.w, H = this.w.h;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = (x | 0) + dx, yy = (y | 0) + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = yy * W + xx; if (this.orig[i] && !NEVER.has(this.orig[i])) { was++; if (this.w.tree[i] && this.w.tree[i] !== Tree.Snag) now++; }
    }
    return was ? now / was : 1;
  }
}
export { Mat };
export type { Deposit };
