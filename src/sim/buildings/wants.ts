import { DAY_SECONDS } from "../../shared/types.ts";
import { DEFS, Line, defById, type BuildingDef, type Owner } from "./defs.ts";
import { canStart, canUpgradeTo, standing, buildingOf, defOf, targetDef, undelivered, needsOf } from "./build.ts";
import { worksAround, type Work } from "../people/works.ts";
import { homeOf, type Band } from "../people/band.ts";
import { Place, type Person } from "../people/person.ts";
import { Problem } from "../tech/problems.ts";
import { hutOf, hutStands, stayHope, clearAt } from "../people/homes.ts";
import { Mat, MATS } from "../economy/goods.ts";
import type { Society } from "../people/society.ts";
import { techIx } from "../tech/tree.ts";
import { flocksOf, capacityOf, flockWords } from "../people/herding.ts";
import { Species } from "../../shared/types.ts";
export const WELLS = () => techIx("wells");

/*
  What a household, a band or a village is short of, and could build about it: a granary
  when more food is put by than the pit can hold, a warmer house when the winters bite in
  a hut of poles, a well when the water is a long walk, a kiln when pots keep breaking, a
  fold when the animals keep wandering. Nothing is built for its own sake: every want is
  a need the people feel, that someone knows how to answer, with the materials in reach.
*/

export interface Want {
  def: BuildingDef;
  /** where it goes, or the building it rebuilds or helps with (or mends, when `mend` is set) */
  x: number; y: number; up?: Work; help?: Work; mend?: boolean;
  v: number; why: string; owner: Owner; home: number;
}

/** Whether every material a def takes can be had around a camp: wood from the trees, the rest from deposits the people knows. */
export function materialsInReach(s: Society, b: Band, def: BuildingDef, needs?: Float32Array): boolean {
  const list = needs ?? needsOf(def);
  for (let m = 0; m < list.length; m++) {
    if (list[m] <= 0) continue;
    if (m === Mat.Wood) { if (s.resources.forestLeft(b.x, b.y, 20) < 0.03) return false; continue; }
    if (!MATS[m].dug) return false;
    if (!s.resources.knownDeposit(b.culture, b.x, b.y, 18, m)) return false;
  }
  return true;
}
/** The one material a site still wants most, if any. */
export function nextMaterial(needs: Float32Array | undefined): number { let best = -1, bv = 0; if (needs) for (let m = 0; m < needs.length; m++) if (needs[m] > bv) { bv = needs[m]; best = m; } return best; }

/** Somewhere near the camp's fire for a building the band or village shares: a few tiles out, on clear dry ground; a big camp, ringed with huts, looks a little further out. */
export function communalSite(s: Society, b: Band, def: BuildingDef, seed: number): [number, number] | null {
  for (let k = 0; k < 28; k++) {
    const a = (seed * 0.73 + k * 0.9) % (Math.PI * 2), r = 3.5 + (k % 6) * 0.9, x = Math.floor(b.x + Math.cos(a) * r) + 0.5, y = Math.floor(b.y + Math.sin(a) * r * 0.85) + 0.5;
    if (clearAt(s, b, x, y, def.reach, 0) && s.walker.reach(b.x, b.y, x, y)) return [x, y];
  }
  return null;
}
/** Somewhere beside a household's hut for its own building. */
export function householdSite(s: Society, b: Band, def: BuildingDef, home: number): [number, number] | null {
  const h = b.homes.get(home); if (!h) return null;
  /* three rings out from the hut, seven spots each: a kiln, a fold and the fallen fold before it all find room */
  for (let k = 0; k < 21; k++) {
    const a = (k * 0.9 + home * 0.53) % (Math.PI * 2), r = 2.4 + Math.floor(k / 7) * 0.8, x = h[0] + Math.cos(a) * r, y = h[1] + 0.3 + Math.sin(a) * r * 0.8;
    if (clearAt(s, b, x, y, def.reach, home) && s.walker.reach(b.x, b.y, x, y)) return [x, y];
  }
  return null;
}

/** The defs someone could rebuild a work into, knowing what they know, with materials in reach. */
export function upgradesFor(s: Society, p: Person, b: Band, w: Work): BuildingDef[] {
  return DEFS.filter(d => d.active && canUpgradeTo(w, d) && canStart(p, d) && materialsInReach(s, b, d));
}

export function wants(s: Society, p: Person, b: Band): Want[] {
  const out: Want[] = [], home = homeOf(p, s.byId, s.time), pr = b.problems;
  const her = p.sex === "f" ? "her" : "his";
  const near = worksAround(s, b.x, b.y, 14);
  /* a building already going up that is the household's own, or the band's or the village's: everyone lends a hand */
  for (const w of near) {
    /* huts and the old pits go their own way (hutJob and the pit options); a granary begun on posts, like a well or a kiln, is raised here */
    if ((w.kind === Line.House || (w.kind === Line.Store && !w.def)) && !w.up) continue;
    const mine = (w.owner ?? 0) === 0 ? w.home === home : w.band === b.id || s.bandById.get(w.band)?.culture === b.culture;
    if (!mine) continue;
    /* a worn well, kiln or fold that stands: a day's mending before it falls in */
    if (w.kind >= 4 && !w.up && standing(w) && w.state < 0.6) {
      const def = defOf(w);
      out.push({ def, x: w.x, y: w.y, help: w, mend: true, v: 0.22 + (0.6 - w.state) * 0.6, owner: (["household", "band", "settlement"] as Owner[])[w.owner ?? 0], home, why: `${p.name} is mending the ${def.name} ${w.owner ? `the ${b.name} share` : `${her} family keeps`} at ${b.siteName}, before it falls in.` });
      continue;
    }
    if (!w.up && (w.prog ?? 1) >= 1) continue;
    const def = targetDef(w), left = undelivered(w.up ? w.up.needs : w.needs);
    /* a work the village's chief called for: those who go along with the chief come readily, those who cannot stand the chief mostly stay away */
    let v = 0.4 + ((w.owner ?? 0) >= 1 ? 0.05 : 0.1);
    if ((w.owner ?? 0) === 2) { const vil = s.villages.find(o => o.call?.work === w.id || o.communal.includes(w.id)); const chief = vil ? s.byId.get(vil.chief) : undefined; if (chief && chief !== p) v = 0.35 * (p.follows === chief.id ? 1.4 : 0.8 + Math.max(0, s.op(p, chief.id)) * 0.4); }
    out.push({ def, x: w.x, y: w.y, help: w, v, owner: (["household", "band", "settlement"] as Owner[])[w.owner ?? 0], home, why: left > 0 ? `${p.name} is bringing ${materialWords(nextMaterial(w.up ? w.up.needs : w.needs))} for the ${def.name} ${ownerWords(w, her)} ${w.up ? "rebuilding" : "raising"} at ${b.siteName}.` : `${p.name} is working on the ${def.name} ${ownerWords(w, her)} ${w.up ? "rebuilding" : "raising"} at ${b.siteName}.` });
  }
  /* storage: more food put by than the pit can hold, and a granary known */
  const pit = buildingOf(s, b, Line.Store, home);
  if (pit && standing(pit) && (pit.tier ?? 0) === 0 && pr[Problem.Storage] > 0.35) {
    for (const def of upgradesFor(s, p, b, pit)) out.push({ def, x: pit.x, y: pit.y, up: pit, v: 0.3 + pr[Problem.Storage] * 0.4, owner: "household", home, why: `${p.name} is rebuilding the family's pit as a granary on posts, because there is more food put by than the pit can hold and the mice get at the rest.` });
  }
  /* shelter: a hut of poles in a hard winter or a wet season, and a better house known */
  const hut = hutOf(s, b, home);
  if (hut && hutStands(hut) && (hut.tier ?? 0) === 0 && !hut.up && Math.max(pr[Problem.Cold], pr[Problem.Wet]) > 0.35 && stayHope(s, b, home) > 0.5) {
    const cold = pr[Problem.Cold] >= pr[Problem.Wet];
    for (const def of upgradesFor(s, p, b, hut)) out.push({ def, x: hut.x, y: hut.y, up: hut, v: 0.25 + Math.max(pr[Problem.Cold], pr[Problem.Wet]) * 0.45, owner: "household", home, why: `${p.name} is rebuilding the family's hut as a ${def.name}, because ${cold ? "the cold comes through the poles at night" : "the rain gets in through the thatch"} and the ${b.name} mean to stay at ${b.siteName}.` });
  }
  /* water: the river a long walk from camp, and wells known */
  if (pr[Problem.Water] > 0.45 && !near.some(w => w.kind === Line.Well && (standing(w) || (w.prog ?? 1) < 1))) {
    const def = defById("well0");
    if (canStart(p, def) && materialsInReach(s, b, def)) {
      const at = communalSite(s, b, def, b.id);
      if (at) out.push({ def, x: at[0], y: at[1], v: 0.3 + pr[Problem.Water] * 0.45, owner: "band", home, why: `${p.name} is starting to dig a well at ${b.siteName}, because the water is a long walk from camp and the children go thirsty.` });
    }
  }
  /* craft: pots that keep breaking at the open fire, and the kiln known */
  if (!near.some(w => w.kind === Line.Kiln && (standing(w) || (w.prog ?? 1) < 1)) && (b.broke ?? 0) > 0 && s.time - (b.broke ?? 0) < DAY_SECONDS * 30) {
    const def = defById("kiln0");
    if (canStart(p, def) && materialsInReach(s, b, def)) {
      const at = householdSite(s, b, def, home);
      if (at) out.push({ def, x: at[0], y: at[1], v: 0.4, owner: "household", home, why: `${p.name} is building a kiln beside the hut, because too many pots crack on the open fire.` });
    }
  }
  /* herds: animals kept and no fold for them, or a fold grown too small */
  const flocks = flocksOf(s, b, home).filter(f => f.sp !== Species.Dog && f.n + f.young >= 4);
  if (flocks.length) {
    const pen = buildingOf(s, b, Line.Pen, home), lost = flocks.some(f => f.lostAt > 0 && s.time - f.lostAt < DAY_SECONDS * 20), biggest = flocks.slice().sort((a, c) => c.n + c.young - a.n - a.young)[0];
    if (!pen || !(standing(pen) || (pen.prog ?? 1) < 1)) {
      const def = defById("pen0");
      if (canStart(p, def) && materialsInReach(s, b, def)) {
        const at = householdSite(s, b, def, home);
        if (at) out.push({ def, x: at[0], y: at[1], v: 0.3 + pr[Problem.HerdLoss] * 0.4 + (lost ? 0.2 : 0), owner: "household", home, why: `${p.name} is weaving a fold of brush beside the hut for the family's ${flockWords(biggest)}, ${lost ? "after the ones that were lost in the night" : "so they stay in at night where the wolves cannot get at them"}.` });
      }
    } else if (standing(pen) && (pen.tier ?? 0) === 0 && !pen.up && flocks.reduce((n, f) => n + f.n + f.young, 0) > capacityOf(s, biggest) * 0.8) {
      for (const def of upgradesFor(s, p, b, pen)) out.push({ def, x: pen.x, y: pen.y, up: pen, v: 0.3 + pr[Problem.HerdLoss] * 0.3, owner: "household", home, why: `${p.name} is rebuilding the family's fold as a ${def.name}, because the animals have grown too many for the brush fold.` });
    }
  }
  void Place;
  return out.sort((a, c) => c.v - a.v);
}
/** The words for a want's def where it would stand, for cards. */
export const wantWords = (w: Want) => defOf({ kind: w.def.line, def: w.def.id } as Work).name;

/** Wood for a building is poles and timber, not firewood. */
function materialWords(m: number): string { return m === Mat.Wood ? "poles and timber" : MATS[m]?.name ?? "materials"; }
/** Whose work it is: a family's, the band's, or the village's. */
function ownerWords(w: Work, her: string): string { return w.owner === 2 ? "the village is" : w.owner === 1 ? "the band is" : `${her} family is`; }
