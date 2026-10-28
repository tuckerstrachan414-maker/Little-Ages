import { Biome, Flag, DAY_SECONDS } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { FISH_UNITS } from "../ecology.ts";
import { Mem, type Person } from "./person.ts";
import { homeOf, type Band } from "./band.ts";
import { IDEAS, Idea, practice, learn } from "./ideas.ts";
import type { Society } from "./society.ts";

/*
  Things people make that stay where they are made: fish weirs and planted plots. A weir is
  a fence of stakes in a river or across a shallow channel that traps fish whether anyone is
  there or not; someone has to come and take them out before they spoil, and floods and
  time knock it down unless someone mends it. A plot is a patch of ground by camp sown with
  seed from the household's own store; it grows through spring and summer and is there to
  harvest only if the band is still there when it ripens. Both outlast the band that made
  them: an old weir still traps a few fish after its makers have moved on, and anyone who
  comes upon one can work out how it was done.
*/

export const Work = { Weir: 0, Plot: 1 } as const;
export interface Work {
  id: number; kind: number;
  /** where someone stands to work it */
  x: number; y: number;
  /** the water a weir stands in */
  wx: number; wy: number;
  /** the band that made it, the household that sowed a plot, and who did the work */
  band: number; home: number; by: number;
  t: number;
  /** a weir's repair, 1 new and 0 washed away; a plot's growth, 1 when ripe */
  state: number;
  /** fish in the trap, or the ripe crop still standing */
  food: number;
  crop: string;
  /** when a plot ripened (0 until it does) */
  ripe: number;
}

/** A weir or plot near (x, y) of one kind, within r tiles. */
export function worksNear(s: Society, kind: number, x: number, y: number, r: number): Work[] {
  return s.works.filter(w => w.kind === kind && Math.hypot(w.x - x, w.y - y) <= r);
}
/** Whether a band can use a weir: its own, or one left by a band now gone or camped far away. */
export function weirFor(s: Society, b: Band, w: Work): boolean {
  if (w.band === b.id) return true;
  const o = s.bandById.get(w.band);
  return !o || Math.hypot(o.x - w.x, o.y - w.y) > 30;
}

/* ---------------- weirs ---------------- */

/** Where a band could build a weir: river water by a dry bank near camp, where fish are, with no weir already close. */
export function weirSite(s: Society, b: Band): { x: number; y: number; wx: number; wy: number } | null {
  const W = s.w.w, H = s.w.h, R = 14;
  let best: { x: number; y: number; wx: number; wy: number } | null = null, bs = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const tx = (b.x | 0) + dx, ty = (b.y | 0) + dy;
    if (tx < 2 || ty < 2 || tx >= W - 2 || ty >= H - 2) continue;
    const i = ty * W + tx, f = s.w.flags[i];
    if (!(f & Flag.Water)) continue;
    const river = (f & Flag.River) !== 0, shore = !river && (s.w.biome[i] === Biome.Shelf || s.w.biome[i] === Biome.Lake);
    if (!river && !shore) continue;
    const d = Math.hypot(dx, dy); if (d > R) continue;
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const bx = tx + ax, by = ty + ay; if (!s.walker.dry(bx + 0.5, by + 0.5) || !s.walker.reach(b.x, b.y, bx + 0.5, by + 0.5)) continue;
      const fish = s.eco.fishAt(tx, ty);
      const v = fish * (river ? 1.3 : 1) / (1 + d / 10);
      if (v > bs && !s.works.some(w => w.kind === Work.Weir && Math.hypot(w.wx - tx, w.wy - ty) < 5)) { bs = v; best = { x: bx + 0.5, y: by + 0.5, wx: tx + 0.5, wy: ty + 0.5 }; }
      break;
    }
  }
  return bs > 8 ? best : null;
}
/** A weir built, or one mended. */
export function buildWeir(s: Society, p: Person, at: { x: number; y: number; wx: number; wy: number }, mend: Work | null): void {
  practice(p, Idea.Weirs, 0.03);
  if (mend) { mend.state = 1; mend.band = p.band; p.prestige += 0.03; return; }
  const b = s.band(p), first = !s.works.some(w => w.kind === Work.Weir && w.band === b.id);
  s.works.push({ id: s.nextId++, kind: Work.Weir, x: at.x, y: at.y, wx: at.wx, wy: at.wy, band: b.id, home: homeOf(p, s.byId, s.time), by: p.id, t: s.time, state: 1, food: 0, crop: "", ripe: 0 });
  p.prestige += 0.08;
  s.worksVersion++;
  if (first) s.event("weir", Bubble.Fish, `${p.name} of the ${b.name} drove a fence of stakes into the ${riverWord(s, at.wx, at.wy)} near camp: a fish weir, the band's first.`, at.wx, at.wy, [p.id], b.id);
}
function riverWord(s: Society, x: number, y: number): string { const f = s.w.flags[(y | 0) * s.w.w + (x | 0)]; return f & Flag.River ? "river" : f & Flag.Lake ? "lake shallows" : "shallows"; }

/** Takes the fish out of a weir's trap: returns what was taken. */
export function emptyWeir(w: Work, room: number): number { const t = Math.min(room, w.food); w.food -= t; return t; }

/* ---------------- plots ---------------- */

/** What grows from seed where: grain on grassland, tubers in the tropics, gourds and beans in the woods. */
export function cropAt(s: Society, x: number, y: number): string | null {
  const b = s.w.biome[(y | 0) * s.w.w + (x | 0)];
  switch (b) {
    case Biome.Grassland: case Biome.ColdSteppe: case Biome.Savanna: return "wild grain";
    case Biome.TropicalForest: case Biome.Rainforest: case Biome.Swamp: return "tubers";
    case Biome.TemperateForest: case Biome.TemperateRainforest: case Biome.Shrubland: return "gourds and beans";
  }
  return null;
}
/** Somewhere to sow near camp: fertile dry ground a few steps out, clear of the shelters and of other plots. */
export function plotSite(s: Society, b: Band): { x: number; y: number; crop: string } | null {
  let best: { x: number; y: number; crop: string } | null = null, bs = 0;
  for (let k = 0; k < 30; k++) {
    const a = s.rng.next() * Math.PI * 2, r = s.rng.range(4.5, 9), x = Math.floor(b.x + Math.cos(a) * r) + 0.5, y = Math.floor(b.y + Math.sin(a) * r * 0.85) + 0.5;
    if (!s.walker.dry(x, y) || !s.walker.reach(b.x, b.y, x, y)) continue;
    const crop = cropAt(s, x, y); if (!crop) continue;
    if (s.w.tree[(y | 0) * s.w.w + (x | 0)] && s.w.tree[(y | 0) * s.w.w + (x | 0)] !== 18) continue;
    if (s.works.some(w => w.kind === Work.Plot && Math.hypot(w.x - x, w.y - y) < 1.6)) continue;
    let clear = true; for (const [, [hx, hy]] of b.homes) if (Math.hypot(hx - x, hy - y) < 1.8) { clear = false; break; }
    if (!clear) continue;
    const v = s.eco.plantK[s.eco.cell(x, y)] + s.rng.next() * 0.2;
    if (v > bs) { bs = v; best = { x, y, crop }; }
  }
  return bs > 0.3 ? best : null;
}
export function sow(s: Society, p: Person, at: { x: number; y: number; crop: string }): void {
  const b = s.band(p), home = homeOf(p, s.byId, s.time);
  practice(p, Idea.Planting, 0.03);
  const first = !s.works.some(w => w.kind === Work.Plot && w.band === b.id);
  s.works.push({ id: s.nextId++, kind: Work.Plot, x: at.x, y: at.y, wx: at.x, wy: at.y, band: b.id, home, by: p.id, t: s.time, state: 0, food: 0, crop: at.crop, ripe: 0 });
  s.worksVersion++;
  if (first) s.event("sow", Bubble.Berries, `${p.name} of the ${b.name} sowed a patch of ${at.crop} by camp, the band's first. It will ripen in late summer, if the ${b.name} are still there.`, at.x, at.y, [p.id], b.id);
}
/** The household that sowed a plot this year, at this camp, does not sow another. */
export function sownThisYear(s: Society, b: Band, home: number): boolean {
  return s.works.some(w => w.kind === Work.Plot && w.home === home && w.band === b.id && s.time - w.t < DAY_SECONDS * 30 && Math.hypot(w.x - b.x, w.y - b.y) < 14);
}
/** A household's ripe plot near camp, if it has one. */
export function ripePlot(s: Society, p: Person): Work | null {
  const b = s.band(p), home = homeOf(p, s.byId, s.time);
  let best: Work | null = null;
  for (const w of s.works) {
    if (w.kind !== Work.Plot || w.state < 1 || w.food < 1 || Math.hypot(w.x - b.x, w.y - b.y) > 16) continue;
    /* the household that sowed it harvests it; a plot whose household is gone is anyone's */
    const ownerHere = b.members.some(id => { const q = s.byId.get(id); return !!q && homeOf(q, s.byId, s.time) === w.home; });
    if (w.home !== home && (w.band === b.id && ownerHere)) continue;
    if (!best || w.food > best.food) best = w;
  }
  return best;
}
/** What a household expects from its plots near camp, ripe or ripening soon: a reason to stay. */
export function plotHope(s: Society, b: Band, home: number): number {
  let v = 0;
  for (const w of s.works) {
    if (w.kind !== Work.Plot || w.home !== home || Math.hypot(w.x - b.x, w.y - b.y) > 16) continue;
    if (w.state >= 1) v += w.food;
    else if (w.state > 0.55) v += expectedYield(s, w) * 0.6;
  }
  return v;
}
function expectedYield(s: Society, w: Work): number { return 24 * (0.6 + s.eco.plantK[s.eco.cell(w.x, w.y)] * 0.5); }

/* ---------------- each day ---------------- */

/** Weirs catch fish and wear; plots grow, ripen, and rot or are frozen if nobody harvests them. */
export function worksDay(s: Society): void {
  const keep: Work[] = [];
  for (const w of s.works) {
    const T = s.tempC(w.x, w.y);
    if (w.kind === Work.Weir) {
      /* the trap fills from the fish in that water; what is not taken out spoils */
      if (w.state > 0.05) {
        const c = s.eco.cell(w.wx, w.wy), got = Math.min(Math.max(0, 30 - w.food), s.eco.fish[c] * FISH_UNITS * 0.025 * w.state);
        s.eco.fish[c] -= got / FISH_UNITS; w.food += got; s.stats.food.weir += got;
      }
      w.food *= T > 15 ? 0.7 : T > 5 ? 0.82 : 0.92;
      /* spring floods knock weirs about, rivers more than still water */
      w.state -= 0.008 + (s.season === 0 && s.w.flags[(w.wy | 0) * s.w.w + (w.wx | 0)] & Flag.River ? 0.025 : 0);
      if (w.state > -0.5) keep.push(w); else s.worksVersion++;
    } else {
      if (w.state < 1) {
        /* frost kills a crop that has not ripened; heat and cold slow it */
        if (T < 0 && s.season === 3) { w.state = 0; w.food = 0; w.ripe = -1; }
        else {
          w.state = Math.min(1, w.state + 0.038 * (T > 8 && T < 32 ? 1 : 0.4) * (0.7 + s.eco.plantK[s.eco.cell(w.x, w.y)] * 0.4));
          if (w.state >= 1) {
            w.ripe = s.time;
            const sower = s.byId.get(w.by);
            w.food = expectedYield(s, w) * (0.75 + (sower ? sower.know[Idea.Planting] : 0.3) * 0.5);
            s.worksVersion++;
          }
        }
      } else {
        /* a ripe crop standing in the field: birds, mice and rot take it bit by bit */
        w.food *= 0.96;
      }
      /* a plot is kept a season past ripening or failing, then goes back to weeds */
      const done = (w.ripe > 0 && s.time - w.ripe > DAY_SECONDS * 25) || (w.ripe < 0 && s.time - w.t > DAY_SECONDS * 50) || s.time - w.t > DAY_SECONDS * 70;
      if (!done) keep.push(w); else s.worksVersion++;
    }
  }
  s.works = keep;
}

/** Someone passing a weir or a plot made by others may work out how it was done. */
export function lookAtWorks(s: Society, p: Person): void {
  const age = s.age(p); if (age < 12) return;
  for (const w of s.works) {
    if (Math.abs(w.x - p.x) > 6 || Math.abs(w.y - p.y) > 6) continue;
    const id = w.kind === Work.Weir ? Idea.Weirs : Idea.Planting;
    if (p.know[id] > 0) continue;
    if (IDEAS[id].needs.some(n => p.know[n] <= 0)) continue;
    if (w.kind === Work.Weir ? w.state < 0.2 : w.state < 0.3) continue;
    if (s.rng.chance(0.004 * (0.3 + p.traits[4]))) {
      learn(s, p, id, null, "seen");
      s.remember(p, Mem.Found, 0, 0.2, id);
    }
    return;
  }
}
