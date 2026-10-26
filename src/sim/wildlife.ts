import { Biome, Flag, Species, DAYS_PER_SEASON, DAYS_PER_YEAR, type WorldData } from "../shared/types.ts";
import { Rng } from "../shared/rng.ts";
import type { Ecology } from "./ecology.ts";

/*
  Herds and packs. Grazers wander from pasture to pasture and rest to graze; wolves track
  the nearest herd and run it down, and the herd bolts; bears roam the woods alone.
  Every herd carries a condition, how well fed it has been lately. Well-fed herds raise
  young in spring; hungry ones lose the weak and the old and go looking for better grass.
  Packs breed when the hunting is good and dwindle when it isn't. So numbers rise and fall
  with the land and with each other, instead of being fixed.
*/

export interface Herd { id: number; sp: number; x: number; y: number; n: number; tx: number; ty: number; state: number; timer: number; heading: number; hunger: number; prey: number; cond: number; }

const SPEED = [1.2, 0.8, 0.55, 1.35, 1.45, 0.7];
const RANGE = [16, 24, 30, 26, 40, 20];
const MAXN = [10, 16, 8, 14, 7, 1];
/* forage eaten per animal per day, as a share of what a patch of open grassland grows */
const EATS = [0.01, 0.01, 0.018, 0.009, 0, 0.006];
/* how much of that is grass rather than browse: deer and bears browse, the rest graze */
const GRASS = [0.15, 0.9, 0.7, 1, 0, 0.1];
/* per animal per year: young raised when well fed, and deaths from age and accident */
const FECUND = [0.45, 0.36, 0.16, 0.36, 0.8, 0.25], MORTAL = [0.16, 0.11, 0.05, 0.11, 0.22, 0.08];

export class Wildlife {
  herds: Herd[] = [];
  private rng: Rng;
  private nextId = 1;
  private w: WorldData;
  private eco?: Ecology;
  constructor(w: WorldData, seed: number, eco?: Ecology) {
    this.w = w; this.eco = eco;
    this.rng = new Rng(seed * 17 + 3);
    let land = 0; for (let i = 0; i < w.biome.length; i++) if (!(w.flags[i] & Flag.Water)) land++;
    const target = Math.round(land / 900);
    for (let tries = 0; this.herds.length < target && tries < target * 30; tries++) {
      const x = this.rng.int(2, w.w - 3), y = this.rng.int(2, w.h - 3), i = y * w.w + x;
      if (w.flags[i] & Flag.Water) continue;
      const sp = this.speciesFor(w.biome[i]); if (sp < 0) continue;
      const n = sp === Species.Bear ? 1 : this.rng.int(Math.ceil(MAXN[sp] * 0.4), MAXN[sp]);
      this.herds.push({ id: this.nextId++, sp, x: x + 0.5, y: y + 0.5, n, tx: x, ty: y, state: 0, timer: this.rng.range(0, 40), heading: this.rng.range(0, 6.28), hunger: this.rng.range(0, 1), prey: -1, cond: 0.8 });
    }
  }
  private speciesFor(b: number): number {
    const r = this.rng.next();
    switch (b) {
      case Biome.Grassland: case Biome.Savanna: case Biome.Shrubland: return r < 0.35 ? Species.Aurochs : r < 0.7 ? Species.Horse : r < 0.92 ? Species.Deer : Species.Wolf;
      case Biome.ColdSteppe: return r < 0.4 ? Species.Horse : r < 0.7 ? Species.Mammoth : r < 0.85 ? Species.Aurochs : Species.Wolf;
      case Biome.Tundra: return r < 0.6 ? Species.Mammoth : r < 0.8 ? Species.Horse : Species.Wolf;
      case Biome.TemperateForest: case Biome.TemperateRainforest: return r < 0.68 ? Species.Deer : r < 0.84 ? Species.Wolf : Species.Bear;
      case Biome.Taiga: return r < 0.45 ? Species.Deer : r < 0.7 ? Species.Wolf : r < 0.85 ? Species.Bear : Species.Mammoth;
      case Biome.TropicalForest: case Biome.Rainforest: return r < 0.7 ? Species.Deer : -1;
      default: return -1;
    }
  }
  private ok(x: number, y: number, sp: number): boolean {
    const w = this.w, xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 1 || yi < 1 || xi >= w.w - 1 || yi >= w.h - 1) return false;
    const i = yi * w.w + xi, b = w.biome[i];
    if (w.flags[i] & Flag.Water) return false;
    if (b === Biome.SnowPeak || b === Biome.IceSheet || b === Biome.Cliff) return false;
    if (b === Biome.Mountain && sp !== Species.Mammoth && sp !== Species.Bear && sp !== Species.Wolf) return false;
    return true;
  }
  /** dt in game seconds; season 0..3 */
  update(dt: number, season: number, dayIndex: number): void {
    const r = this.rng;
    for (const h of this.herds) {
      if (h.n <= 0) continue;
      h.timer -= dt; h.hunger = Math.min(1.5, h.hunger + dt / 400);
      if (h.state === 0 && h.timer <= 0) {
        if (h.sp === Species.Wolf && h.hunger > 0.55) { h.prey = this.nearestPrey(h); if (h.prey >= 0) { h.state = 1; h.timer = 120; } }
        if (h.state === 0) {
          /* a hungry herd ranges further and heads for the best grass it can find */
          const hungry = this.eco && EATS[h.sp] > 0 && h.cond < 0.75, reach = hungry ? 1.8 : 1;
          let best = -1;
          for (let k = 0; k < 8; k++) {
            const a = r.range(0, 6.28), d = r.range(RANGE[h.sp] * 0.3, RANGE[h.sp] * reach); const tx = h.x + Math.cos(a) * d, ty = h.y + Math.sin(a) * d;
            if (!this.ok(tx, ty, h.sp)) continue;
            const score = hungry ? this.eco!.forageAt(tx, ty, GRASS[h.sp]) : 1;
            if (score > best) { best = score; h.tx = tx; h.ty = ty; h.state = 1; h.timer = 200; if (!hungry) break; }
          }
          if (h.state === 0) h.timer = r.range(5, 20);
        }
      }
      if (h.state >= 1) {
        if (h.sp === Species.Wolf && h.prey >= 0) {
          const p = this.herds.find(q => q.id === h.prey);
          if (!p || p.n <= 0) { h.prey = -1; h.state = 0; h.timer = r.range(20, 60); }
          else {
            h.tx = p.x; h.ty = p.y;
            const d = Math.hypot(p.x - h.x, p.y - h.y);
            if (d < 7 && p.state !== 2) { p.state = 2; p.timer = r.range(10, 18); const a = Math.atan2(p.y - h.y, p.x - h.x); p.tx = p.x + Math.cos(a) * 30; p.ty = p.y + Math.sin(a) * 30; h.state = 2; }
            /* a fit, well-fed herd usually outruns the pack; in thick woods it can also hide */
            const cover = this.w.tree[Math.floor(p.y) * this.w.w + Math.floor(p.x)] ? 0.7 : 1;
            if (d < 1.6) { if (r.chance(Math.max(0.06, Math.min(0.5, 0.45 * (1.2 - p.cond))) * cover) && p.n > 0) { p.n--; h.hunger = Math.max(0, h.hunger - 0.25 - 2.4 / h.n); } h.prey = -1; h.state = 0; h.timer = r.range(30, 90); }
          }
        }
        const sp = SPEED[h.sp] * (h.state === 2 ? 2.4 : 1);
        const dx = h.tx - h.x, dy = h.ty - h.y, d = Math.hypot(dx, dy);
        if (d < 0.4 || (h.state === 2 && h.timer <= 0 && h.sp !== Species.Wolf)) { h.state = 0; h.timer = r.range(25, 90); continue; }
        if (h.timer <= -60) { h.state = 0; h.timer = 10; continue; }
        const step = Math.min(d, sp * dt), nx = h.x + dx / d * step, ny = h.y + dy / d * step;
        if (this.ok(nx, ny, h.sp)) { h.x = nx; h.y = ny; h.heading = Math.atan2(dy, dx); }
        else { h.state = 0; h.timer = r.range(2, 8); }
      }
    }
    /* once a day: eating, condition, births in spring, deaths, herds split when too big */
    if (dayIndex !== this.lastDay) {
      this.lastDay = dayIndex;
      const born: Herd[] = [];
      /* wolves hold territories: count packs per block so crowded packs stop breeding */
      /* wolves and bears hold territories: count them per block so the crowded stop breeding */
      const B = 48, bw = Math.ceil(this.w.w / B), packs = new Map<number, number>();
      for (const h of this.herds) if ((h.sp === Species.Wolf || h.sp === Species.Bear) && h.n > 0) { const k = (Math.floor(h.y / B) * bw + Math.floor(h.x / B)) * 2 + (h.sp === Species.Bear ? 1 : 0); packs.set(k, (packs.get(k) ?? 0) + 1); }
      const near = (x: number, y: number, bear: number) => { let n = 0; const bx = Math.floor(x / B), by = Math.floor(y / B); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) n += packs.get(((by + j) * bw + bx + i) * 2 + bear) ?? 0; return n; };
      for (const h of this.herds) {
        if (h.n <= 0) continue;
        const t = this.w.temp[Math.floor(h.y) * this.w.w + Math.floor(h.x)] / 255;
        let fed: number;
        if (h.sp === Species.Wolf) {
          /* between big kills, wolves get by on rabbits and hares where there are any */
          if (this.eco) h.hunger = Math.max(0, h.hunger - this.eco.hunt(h.x, h.y, 0.012 * h.n) * 0.12);
          fed = Math.max(0, Math.min(1, 1.3 - h.hunger));
        } else {
          fed = this.eco ? this.eco.graze(h.x, h.y, EATS[h.sp] * h.n, GRASS[h.sp]) : 1;
          if (h.sp === Species.Bear && this.eco) fed = Math.min(1, fed * 0.7 + this.eco.hunt(h.x, h.y, 0.01) * 0.5);
        }
        h.cond = h.cond * 0.85 + fed * 0.15;
        /* each animal may die: of age, of hunger when the herd is thin, of cold (not a mammoth) */
        const cold = season === 3 && t < 0.35 && h.sp !== Species.Mammoth ? 0.004 : 0;
        const pDie = MORTAL[h.sp] / DAYS_PER_YEAR + Math.max(0, 0.5 - h.cond) * 0.06 + cold;
        for (let m = h.n; m > 0; m--) if (r.chance(pDie)) h.n--;
        /* spring young, as many as the herd's condition allows */
        if (season === 0 && h.n > 0 && h.cond > 0.5) {
          let pBirth = FECUND[h.sp] / DAYS_PER_SEASON * Math.min(1, (h.cond - 0.5) / 0.35);
          if (h.sp === Species.Wolf) pBirth *= Math.max(0, 1 - (near(h.x, h.y, 0) - 1) / 2.5);
          if (h.sp === Species.Bear) pBirth *= Math.max(0, 1 - (near(h.x, h.y, 1) - 1) / 2);
          for (let m = h.n; m > 0; m--) if (r.chance(pBirth)) {
            if (h.sp === Species.Bear) born.push({ ...h, id: this.nextId++, n: 1, state: 0, timer: 1, prey: -1, x: h.x + r.range(-3, 3), y: h.y + r.range(-3, 3) });
            else h.n++;
          }
        }
        if (h.n > MAXN[h.sp] + 2 && this.herds.length < 4000) { const half = Math.floor(h.n / 2); h.n -= half; born.push({ ...h, id: this.nextId++, n: half, state: 0, timer: 1, prey: -1 }); }
      }
      for (const b of born) if (this.ok(b.x, b.y, b.sp)) this.herds.push(b);
      this.herds = this.herds.filter(h => h.n > 0);
    }
  }
  private lastDay = -1;
  private nearestPrey(w: Herd): number {
    let best = -1, bd = 32;
    for (const h of this.herds) { if (h.sp === Species.Wolf || h.sp === Species.Bear || h.sp === Species.Mammoth || h.n <= 0) continue; const d = Math.hypot(h.x - w.x, h.y - w.y); if (d < bd) { bd = d; best = h.id; } }
    return best;
  }
  snapshot(): Float32Array {
    const out = new Float32Array(this.herds.length * 7);
    this.herds.forEach((h, k) => { const o = k * 7; out[o] = h.id; out[o + 1] = h.sp; out[o + 2] = h.x; out[o + 3] = h.y; out[o + 4] = h.n; out[o + 5] = h.heading; out[o + 6] = h.state; });
    return out;
  }
}
