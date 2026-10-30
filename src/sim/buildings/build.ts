import { quality, qualityOf, qualityFor } from "../tech/refine.ts";
import { Bubble } from "../../shared/people.ts";
import { DEFS, Line, defById, baseDef, materialTotal, houseWords, type BuildingDef, type Owner, type WallKind, type RoofKind } from "./defs.ts";
import { addWork, workById, worksAround, type Work } from "../people/works.ts";
import { homeOf, noFood, type Band } from "../people/band.ts";
import { clearAt } from "../people/homes.ts";
import { Food, Skill, type Person, type Step } from "../people/person.ts";
import { knows, practice } from "../people/ideas.ts";
import { Idea, techIx } from "../tech/tree.ts";
import { MAT_COUNT } from "../economy/goods.ts";
import { DAY_SECONDS } from "../../shared/types.ts";
import type { Society } from "../people/society.ts";

/*
  Raising a building, spell by spell. Whoever starts one knows how; anyone can carry
  materials to it and lend a hand. What is carried comes off the list of what the site
  still needs, and the work can only go as far as what has been delivered: a house with
  no clay brought to it stops at the frame. A building is rebuilt in place, tier by tier,
  the old one in use until the new one stands. Buildings wear, each kind at its own pace,
  faster with nobody keeping them.
*/

export const OWNER = { household: 0, band: 1, settlement: 2 } as const;
const OWNERS: Owner[] = ["household", "band", "settlement"];
/** What a St.Raise step's `a` means: 0 a hut, 1 a mend, 2 a longhouse bay, 3-5 a building for a household, the band or the settlement, 6 a rebuild in place. */
export const RAISE = { Hut: 0, Mend: 1, Bay: 2, Household: 3, Band: 4, Settlement: 5, Upgrade: 6 } as const;

/** The def a work is built to: its own, else the first tier of its line (huts and pits carry none). */
export function defOf(w: Work): BuildingDef { return (w.def ? defById(w.def) : baseDef(w.kind)) ?? DEFS[0]; }
/** A finished building, sound enough to use. */
export const standing = (w: Work | null | undefined): boolean => !!w && (w.prog ?? 1) >= 1 && w.state > 0.2;
/** Whether someone knows enough to start a def, or rebuild to it. */
export function canStart(p: Person, def: BuildingDef): boolean {
  if (!def.active) return false;
  if (!def.tech.some(k => knows(p, techIx(k)))) return false;
  return !def.techAll || def.techAll.every(k => knows(p, techIx(k)));
}
/** The materials a def takes, as a list to carry down. */
export function needsOf(def: BuildingDef): Float32Array { const n = new Float32Array(MAT_COUNT); for (const k in def.materials) n[+k] = def.materials[+k] ?? 0; return n; }
export const undelivered = (n: Float32Array | undefined): number => { let t = 0; if (n) for (let i = 0; i < n.length; i++) t += n[i]; return t; };
/** The def a work is being built or rebuilt to right now. */
export const targetDef = (w: Work): BuildingDef => (w.up ? defById(w.up.def) : defOf(w));
/** How far a building's work can go with what has been delivered so far. */
export function deliveredFraction(w: Work): number {
  const total = materialTotal(targetDef(w)), left = undelivered(w.up ? w.up.needs : w.needs);
  return total ? Math.max(0, 1 - left / total) : 1;
}
/** What a building is made of, from what the def allows, the climate, and the wood around the camp. */
export function chooseMaterials(s: Society, b: Band, def: BuildingDef): { walls: WallKind; roof: RoofKind } {
  const walls = def.art.walls?.[0] ?? "poles", roofs = def.art.roof ?? ["thatch"];
  const c = s.climateAt(b.x, b.y);
  const roof: RoofKind = roofs.includes("turf") && c.winter < -6 ? "turf" : roofs.includes("plank") && walls === "timber" && s.resources.forestLeft(b.x, b.y, 16) > 0.5 ? "plank" : roofs[0];
  return { walls, roof };
}
/** The building of a line a household has at its band's camp, if any (any tier): one standing or going up before one fallen in. */
export function buildingOf(s: Society, b: Band, line: number, home: number): Work | null {
  let fallen: Work | null = null;
  for (const w of worksAround(s, b.x, b.y, 14)) if (w.kind === line && w.band === b.id && w.home === home) { if (standing(w) || (w.prog ?? 1) < 1) return w; fallen ??= w; }
  return fallen;
}
/** Buildings of a line standing near a spot, owned by anyone. */
export function buildingsNear(s: Society, x: number, y: number, r: number, line: number, finished = true): Work[] {
  return worksAround(s, x, y, r).filter(w => w.kind === line && (!finished || standing(w)));
}
/** A band's or settlement's building of a line going up or standing near a camp. */
export function communalNear(s: Society, b: Band, line: number, r = 14): Work | null {
  for (const w of worksAround(s, b.x, b.y, r)) if (w.kind === line && (w.owner ?? 0) >= 1 && (w.prog ?? 1) < 1 ? true : w.kind === line && (w.owner ?? 0) >= 1 && standing(w)) return w;
  return null;
}

/** A building begun: the frame marked out, the list of what it needs, a tier and a def. */
export function startBuilding(s: Society, p: Person, def: BuildingDef, x: number, y: number, owner: Owner, home: number): Work {
  const b = s.band(p), m = chooseMaterials(s, b, def);
  const w = addWork(s, {
    kind: def.line, x, y, wx: x, wy: y, band: b.id, home: owner === "household" ? home : 0, by: p.id, t: s.time, state: 1, food: 0, crop: "", ripe: 0,
    prog: 0, kept: s.time, tier: def.tier, def: def.id, walls: m.walls, roof: m.roof, owner: OWNER[owner], needs: needsOf(def), labor: def.labor, style: s.cultures[b.culture].hut, look: "plain",
    ...(def.line === Line.Store ? { foods: noFood(), opened: s.time, size: def.effects.room } : {}),
  });
  s.stats.buildings.started++;
  return w;
}
/** A rebuild in place begun: the building stays in use at its tier while the materials come in and the work goes on. */
export function startUpgrade(s: Society, w: Work, def: BuildingDef): void {
  w.up = { def: def.id, needs: needsOf(def), prog: 0, labor: def.labor };
  s.worksVersion++;
}
/** What someone carries, if the site needs it, comes off the list. Returns what was taken. */
export function deliver(s: Society, p: Person, w: Work): number {
  const needs = w.up ? w.up.needs : w.needs;
  if (!needs || p.carryAmt <= 0 || !needs[p.carryKind]) return 0;
  const t = Math.min(needs[p.carryKind], p.carryAmt);
  needs[p.carryKind] -= t; p.carryAmt -= t;
  if (p.carryAmt <= 1e-6) { p.carryAmt = 0; p.carryKind = Food.None; }
  s.stats.buildings.delivered += t;
  return t;
}

/**
  A spell of work at a building site (a St.Raise step whose `a` is 3 or more): starting it if the
  plan said to, delivering what was carried, then a spell of building as far as the materials allow.
*/
export function buildSpell(s: Society, p: Person, st: Step): void {
  const b = s.band(p), home = homeOf(p, s.byId, s.time);
  let w = st.id ? workById(s, st.id) ?? null : null;
  if (st.a === RAISE.Mend) { if (w) mendSpell(s, p, w); return; }
  if (st.a === RAISE.Upgrade) {
    if (!w || (w.prog ?? 1) < 1) return;
    if (!w.up) { const def = DEFS[st.o ?? -1]; if (!def || !canStart(p, def) || !canUpgradeTo(w, def)) return; startUpgrade(s, w, def); }
  } else if (!w) {
    const def = DEFS[st.o ?? -1]; if (!def || !canStart(p, def)) return;
    const owner = OWNERS[Math.max(0, Math.min(2, (st.a ?? 3) - 3))];
    /* someone else may have begun it since this plan was made (the spot is the same for everyone who wanted it): lend a hand to that one rather than start a second on top of it; one already standing there needs nothing */
    const there = worksAround(s, st.x, st.y, 2).filter(o => o.kind === def.line && Math.hypot(o.x - st.x, o.y - st.y) < 1.5);
    const begun = there.find(o => (o.prog ?? 1) < 1) ?? (owner === "household" ? [buildingOf(s, b, def.line, home)].find(o => o && (o.prog ?? 1) < 1) ?? null : null);
    if (begun) { w = begun; st.id = w.id; }
    else {
      if (there.some(o => standing(o)) || !clearAt(s, b, st.x, st.y, def.reach, owner === "household" ? home : 0)) return;
      w = startBuilding(s, p, def, st.x, st.y, owner, home);
      st.id = w.id;
    }
  }
  deliver(s, p, w);
  w.kept = s.time;
  const def = targetDef(w);
  const labor = Math.max(1, w.up ? w.up.labor : (w.labor ?? def.labor));
  /* a people that has raised many of a kind raises the next faster */
  const way = def.tech.map(k => techIx(k)).find(ix => knows(p, ix));
  const amt = (1 / labor) * (0.7 + p.skills[Skill.Craft] * 0.6) * (knows(p, Idea.Axe) ? 1.15 : 1) * (way !== undefined ? qualityOf(s, p, way) : 1);
  p.skills[Skill.Craft] = Math.min(1, p.skills[Skill.Craft] + 0.004);
  for (const k of def.tech) { const ix = techIx(k); if (knows(p, ix)) practice(s, p, ix, 0.015); }
  const cap = deliveredFraction(w);
  if (w.up) {
    const before = w.up.prog;
    w.up.prog = Math.min(cap, before + amt);
    if (Math.floor(before * 4) !== Math.floor(w.up.prog * 4)) s.worksVersion++;
    if (w.up.prog >= 1) finishUpgrade(s, p, b, w);
    return;
  }
  const before = w.prog ?? 0;
  w.prog = Math.min(cap, before + amt);
  if ((before < 0.4) !== (w.prog < 0.4) || w.prog >= 1) s.worksVersion++;
  if (w.prog >= 1 && before < 1) finishBuilding(s, p, b, w);
}
/** A spell of mending on a worn building that stands: no new materials, the know-how and a day's work put it right by its def's measure. */
function mendSpell(s: Society, p: Person, w: Work): void {
  if (!standing(w) || w.up || w.state >= 1) return;
  const def = defOf(w), before = w.state;
  w.state = Math.min(1, w.state + def.decay.mend * (0.7 + p.skills[Skill.Craft] * 0.6));
  p.skills[Skill.Craft] = Math.min(1, p.skills[Skill.Craft] + 0.003);
  for (const k of def.tech) { const ix = techIx(k); if (knows(p, ix)) practice(s, p, ix, 0.01); }
  if ((before >= 0.55) !== (w.state >= 0.55)) s.worksVersion++;
  s.stats.buildings.mended++;
}
/** Whether a def can be reached by rebuilding this work. */
export function canUpgradeTo(w: Work, def: BuildingDef): boolean {
  if (!def.from || def.line !== w.kind || def.tier !== (w.tier ?? 0) + 1) return false;
  const cur = defOf(w);
  return def.from === cur.id || def.from === `${cur.id.replace(/\d.*$/, "")}${cur.tier}`;
}

const EVENT_KIND: Partial<Record<number, string>> = { [Line.Well]: "well", [Line.Store]: "granary", [Line.Kiln]: "kiln", [Line.Pen]: "pen" };
function builtText(p: Person, b: Band, w: Work, firstEver: boolean): string {
  const def = defOf(w), her = p.sex === "f" ? "her" : "his";
  switch (def.line) {
    case Line.Well: return `${p.name} of the ${b.name} and the others have dug a well at ${b.siteName}: days of digging, and the water comes up clear. Nobody need walk to the river for it now.${firstEver ? " It is the first well anywhere." : ""}`;
    case Line.Store: return (w.owner ?? 0) >= 1
      ? `${p.name} and the others have raised a granary for everyone at ${b.siteName}: a box on posts under thatch, with room for a whole winter's food out of reach of the mice, that any family of the place may put by in.${firstEver ? " Nobody has built one before." : ""}`
      : `${p.name}'s family raised a granary on posts by their house at ${b.siteName}, roofed with thatch, with room for a whole winter's food out of reach of the mice.${firstEver ? " Nobody has built one before." : ""}`;
    case Line.Kiln: return `${p.name} built a kiln of daub beside ${her} family's hut: a beehive with a mouth for the fire, in which pots bake harder than on any hearth.${firstEver ? " It is the first kiln anywhere." : ""}`;
    case Line.Pen: return `${p.name} wove a fold of brush beside ${her} family's hut, to keep the animals in at night where the wolves cannot get at them.`;
    default: return `${p.name} of the ${b.name} finished a ${def.name} at ${b.siteName}${firstEver ? ", the first anywhere" : ""}.`;
  }
}
function finishBuilding(s: Society, p: Person, b: Band, w: Work): void {
  const def = defOf(w);
  w.state = 1; w.built = s.time; w.site = b.siteName; w.needs = undefined;
  /* a granary built by people who have built many holds more */
  if (def.line === Line.Store && def.effects.room) w.size = Math.round(def.effects.room * quality(s, b.culture, techIx(def.tech[0])));
  p.prestige += 0.08 + def.labor * 0.004;
  s.stats.buildings.built++;
  const firstEver = !s.stats.buildings.firstOf[def.line]; if (firstEver) s.stats.buildings.firstOf[def.line] = s.time;
  const first = !worksAround(s, b.x, b.y, 16).some(o => o !== w && o.kind === w.kind && o.band === b.id && standing(o));
  if (first) s.event(EVENT_KIND[def.line] ?? "built", Bubble.Home, builtText(p, b, w, firstEver), w.x, w.y, [p.id], b.id, firstEver ? 1 : 0);
  /* a work the village was called to, finished: the one who called for it is thought the more of */
  if ((w.owner ?? 0) === OWNER.settlement) for (const v of s.villages) if (v.call?.work === w.id) { v.call = null; const chief = s.byId.get(v.chief); if (chief) chief.prestige += 0.3; }
}
function finishUpgrade(s: Society, p: Person, b: Band, w: Work): void {
  if (!w.up) return;
  const def = defById(w.up.def), was = defOf(w), m = chooseMaterials(s, b, def);
  w.tier = def.tier; w.def = def.id; w.walls = m.walls; w.roof = m.roof; w.up = undefined; w.prog = 1; w.state = 1; w.built = s.time;
  /* a granary built by people who have built many holds more */
  if (def.line === Line.Store && def.effects.room) w.size = Math.round(def.effects.room * quality(s, b.culture, techIx(def.tech[0])));
  s.worksVersion++;
  p.prestige += 0.1;
  s.stats.buildings.upgrades++;
  const firstEver = !s.stats.buildings.firstOf[def.line * 8 + def.tier]; if (firstEver) s.stats.buildings.firstOf[def.line * 8 + def.tier] = s.time;
  const first = !worksAround(s, b.x, b.y, 16).some(o => o !== w && o.kind === w.kind && (o.tier ?? 0) >= def.tier && o.band === b.id);
  if (!first) return;
  const her = p.sex === "f" ? "her" : "his";
  const text = def.line === Line.House ? `${p.name}'s family have rebuilt their ${was.name} as a ${houseWords(w.style, w.walls, w.roof)}, the first at ${b.siteName}${firstEver ? " and the first anywhere" : ""}: warmer, drier, and built to last.`
    : def.line === Line.Store ? `${p.name}'s family built a granary over their old pit at ${b.siteName}: a box raised on posts under thatch, with room for a whole winter's food out of reach of the mice.${firstEver ? " Nobody has built one before." : ""}`
    : `${p.name} of the ${b.name} rebuilt ${her} family's ${was.name} as a ${def.name} at ${b.siteName}${firstEver ? ", the first anywhere" : ""}.`;
  s.event(def.line === Line.Store ? "granary" : "upgrade", Bubble.Home, text, w.x, w.y, [p.id], b.id, firstEver ? 1 : 0);
}

/** Each day for a building of a line beyond houses and stores: one left half built rots; a finished one wears, faster with nobody keeping it. Returns false when it is gone. */
export function buildingDay(s: Society, w: Work): boolean {
  const def = defOf(w), b = s.bandById.get(w.band);
  const kept = !!b && !b.moving && Math.hypot(b.x - w.x, b.y - w.y) < 14;
  if ((w.prog ?? 1) < 1) {
    /* a frame rots once nobody works on it: fast with the band gone, slowly at a camp where it has stood untouched for a season; a frame just marked out waits for its first load */
    const idle = s.time - (w.kept ?? w.t) > DAY_SECONDS * 20;
    if (!kept) w.prog = (w.prog ?? 0) - 0.01; else if (idle) w.prog = (w.prog ?? 0) - 0.003;
    return (w.prog ?? 0) > -0.3;
  }
  if (w.up && !kept) { w.up.prog -= 0.01; if (w.up.prog <= 0) { w.up = undefined; s.worksVersion++; } }
  const before = w.state;
  /* a people that has built many of a kind builds them to last */
  w.state -= (kept ? def.decay.lived : def.decay.empty) / qualityFor(s, w.band, techIx(def.tech[0]));
  if ((before >= 0.55) !== (w.state >= 0.55) || (before >= 0.2) !== (w.state >= 0.2)) s.worksVersion++;
  return w.state > -1.4;
}
/** How a work of any kind wears each day, by its def. */
export const decayOf = (w: Work, lived: boolean): number => { const d = defOf(w).decay; return lived ? d.lived : d.empty; };
