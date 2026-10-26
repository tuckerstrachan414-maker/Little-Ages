import { Biome, Flag, type WorldData } from "../shared/types.ts";
import { Rng } from "../shared/rng.ts";

/*
  Bird flocks. Geese rest on lakes, rivers and marshes and fly in V's; when autumn turns
  their home cold they fly toward the equator, and in spring they fly home again. Crows and
  finches flit between woods and meadows close to home. Gulls work the coasts. Each flock
  rests, picks somewhere fitting to go, and flies there.
*/

export const Bird = { Goose: 0, Songbird: 1, Gull: 2 } as const;
export const BIRD_STRIDE = 7;   /* id, kind, x, y, count, heading, state (0 resting, 1 flying) */
const SPEED = [7, 5, 6], HOP = [[60, 220], [12, 50], [25, 90]], SIZE = [[7, 16], [10, 26], [3, 8]], REST = [[30, 120], [6, 26], [8, 36]];

interface Flock { id: number; kind: number; x: number; y: number; tx: number; ty: number; n: number; state: number; timer: number; heading: number; homeY: number; away: boolean; }

export class Birds {
  flocks: Flock[] = [];
  private rng: Rng;
  private w: WorldData;
  constructor(w: WorldData, seed: number) {
    this.w = w;
    this.rng = new Rng(seed * 29 + 11);
    let land = 0; for (let i = 0; i < w.flags.length; i++) if (!(w.flags[i] & Flag.Water)) land++;
    const target = Math.round(land / 4500);
    let id = 1;
    for (let f = 0; f < target; f++) {
      const kind = this.rng.chance(0.3) ? Bird.Goose : this.rng.chance(0.65) ? Bird.Songbird : Bird.Gull;
      let x = 0, y = 0, ok = false;
      for (let tries = 0; tries < 400 && !ok; tries++) { x = this.rng.int(4, w.w - 5); y = this.rng.int(4, w.h - 5); ok = this.fits(kind, x, y); }
      if (!ok) continue;
      const n = this.rng.int(SIZE[kind][0], SIZE[kind][1]);
      this.flocks.push({ id: id++, kind, x: x + 0.5, y: y + 0.5, tx: x, ty: y, n, state: 0, timer: this.rng.range(0, 60), heading: 0, homeY: y, away: false });
    }
  }
  /** Is this a place this kind of bird would settle? */
  private fits(kind: number, x: number, y: number): boolean {
    const w = this.w; if (x < 2 || y < 2 || x >= w.w - 2 || y >= w.h - 2) return false;
    const i = y * w.w + x, f = w.flags[i], b = w.biome[i];
    if (b === Biome.IceSheet || b === Biome.SnowPeak) return false;
    if (kind === Bird.Goose) return (f & (Flag.Lake | Flag.River)) !== 0 || b === Biome.Swamp;
    if (kind === Bird.Gull) return (f & Flag.Coast) !== 0 && !(f & Flag.Water);
    return !(f & Flag.Water) && w.tree[i] !== 0;
  }
  update(dt: number, season: number): void {
    const r = this.rng, w = this.w;
    for (const f of this.flocks) {
      f.timer -= dt;
      if (f.state === 0) {
        if (f.timer > 0) continue;
        /* geese: autumn sends cold flocks toward the equator, spring brings them home */
        const t = w.temp[Math.floor(f.y) * w.w + Math.floor(f.x)] / 255, mid = w.h / 2;
        let biasY = 0, reach = 1;
        if (f.kind === Bird.Goose) {
          if ((season === 2 || season === 3) && t < 0.62 && !f.away) { biasY = Math.sign(mid - f.y) * r.range(120, 260) * (w.h / 1024); reach = 2; }
          else if (season === 0 && f.away) { biasY = (f.homeY - f.y) * 0.8; reach = 2; }
        }
        for (let k = 0; k < 14; k++) {
          const a = r.range(0, Math.PI * 2), d = r.range(HOP[f.kind][0], HOP[f.kind][1]) * (w.h / 1024) * (reach > 1 ? 0.4 : 1);
          const tx = Math.round(f.x + Math.cos(a) * d), ty = Math.round(f.y + Math.sin(a) * d * 0.7 + biasY);
          if (this.fits(f.kind, tx, ty)) {
            f.tx = tx + 0.5; f.ty = ty + 0.5; f.state = 1;
            if (biasY) f.away = season !== 0;
            break;
          }
        }
        if (f.state === 0) f.timer = r.range(10, 40);
        continue;
      }
      const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
      if (d < 0.6) { f.state = 0; f.timer = r.range(REST[f.kind][0], REST[f.kind][1]); continue; }
      const step = Math.min(d, SPEED[f.kind] * dt);
      f.x += dx / d * step; f.y += dy / d * step; f.heading = Math.atan2(dy, dx);
    }
  }
  snapshot(): Float32Array {
    const out = new Float32Array(this.flocks.length * BIRD_STRIDE);
    this.flocks.forEach((f, k) => { const o = k * BIRD_STRIDE; out[o] = f.id; out[o + 1] = f.kind; out[o + 2] = f.x; out[o + 3] = f.y; out[o + 4] = f.n; out[o + 5] = f.heading; out[o + 6] = f.state; });
    return out;
  }
  count(): number { let n = 0; for (const f of this.flocks) n += f.n; return n; }
}
