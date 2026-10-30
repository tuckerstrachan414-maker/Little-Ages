import { Biome, DAY_SECONDS, Flag, SPECIES_NAMES, Species } from "../../shared/types.ts";
import { Bubble, type VillageSnap } from "../../shared/people.ts";
import type { Band } from "./band.ts";
import { compound, lexeme } from "./language.ts";
import { TECHS as IDEAS } from "../tech/tree.ts";
import { unpackHint } from "../tech/tree.ts";
import { Work, worksAround } from "./works.ts";
import { hutStands, pitFood } from "./homes.ts";
import { Mat, MATS } from "../economy/goods.ts";
import type { Society } from "./society.ts";

/*
  Gatherings and villages. Nobody founds either: they are what the game calls what people
  did. When the camps of several bands stand within a short walk of each other, that is a
  gathering: in a season of plenty, bands of one people camp side by side, visit, court,
  trade know-how and gifts, and break up again as the food thins. When a band (or a
  gathering of bands) has lived at one place through all four seasons, in huts, it is a
  village. A village gets a name in its people's own tongue, after whoever raised the
  first hut there or after the weightiest thing that happened there, and the name stays on
  the place: a village whose people leave becomes the ruins of that name, and a band that
  comes back to it comes back to that village.
*/

export interface Village {
  id: number; name: string;
  /** what the name means ("Ama's Ford") and why it is called that */
  gloss: string; why: string;
  x: number; y: number; culture: number;
  founded: number; founder: number; founderName: string;
  /** how it began, in words */
  story: string;
  /** the bands living there now, and every band that ever has */
  bands: number[]; ever: number[];
  pop: number; peak: number; huts: number;
  /** since when no band has lived there (0 while lived in), and when it was given up for good (0 if not) */
  empty: number; abandoned: number;
  /** a hamlet (0), village (1), town (2) or city (3) */
  tier: number;
  /** the one most of its grown-ups listen to (0 for nobody), since when, the buildings the whole place shares, and the work the chief has called everyone to */
  chief: number; chiefSince: number; communal: number[]; call: { work: number; since: number } | null;
}
export interface Gathering {
  id: number; bands: number[]; x: number; y: number; since: number; peak: number; name: string;
  /** told of yet (a gathering is told of once it has lasted a couple of days) */
  told: boolean;
}

/** How near camps must be to count as one gathering, and how near a village a band must camp to live in it. */
export const GATHER_R = 18, VILLAGE_R = 16;

/* ---------------- who may camp beside whom ---------------- */

/**
  Whether a band would camp beside another: bands of one people that are on good terms (no
  feud between them, and their people like each other well enough) camp side by side;
  strangers and bands with bad blood keep their distance.
*/
const friends = new WeakMap<Society, { day: number; m: Map<number, boolean> }>();
export function friendly(s: Society, b: Band, o: Band): boolean {
  if (o.culture !== b.culture) return false;
  /* what people think of each other changes slowly: worked out once a day for each pair of bands */
  let c = friends.get(s); if (!c || c.day !== s.day) { c = { day: s.day, m: new Map() }; friends.set(s, c); }
  const k = b.id * 100003 + o.id; let v = c.m.get(k);
  if (v === undefined) { v = friendlyNow(s, b, o); c.m.set(k, v); }
  return v;
}
function friendlyNow(s: Society, b: Band, o: Band): boolean {
  for (const f of s.feuds) { if (f.heat < 0.3) continue; const pa = s.byId.get(f.a), pb = s.byId.get(f.b); if (pa && pb && ((pa.band === b.id && pb.band === o.id) || (pa.band === o.id && pb.band === b.id))) return false; }
  let op = 0, n = 0;
  for (const id of b.members) { const q = s.byId.get(id); if (!q || s.age(q) < 16) continue; for (const jd of o.members) { const r = q.rel.get(jd); if (r) { op += r.op; n++; } } }
  return n === 0 || op / n > -0.05;
}
/** How far out a band's camp reaches from its fire: its shelters and huts. */
export function campReach(b: Band): number {
  let r = 3; for (const [, [x, y]] of b.homes) r = Math.max(r, Math.hypot(x - b.x, y - b.y) + 1.2);
  return r;
}
/** Whether a band may make camp at (x, y): far from strangers and foes, and not on top of a friendly camp. */
export function roomFor(s: Society, b: Band, x: number, y: number): boolean {
  for (const o of s.bands) {
    if (o === b || o.moving) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d >= 16) continue;
    if (!friendly(s, b, o) || d < campReach(o) + campReach(b) + 2) return false;
  }
  return true;
}
/** Kin and friends of someone in another band: why they would like to camp near it. */
export function tiesTo(s: Society, q: { id: number; mother: number; father: number; rel: Map<number, { op: number }> }, o: Band): number {
  let n = 0;
  for (const id of o.members) { const p = s.byId.get(id); if (!p) continue; if (s.kin(p, q, 1) || (q.rel.get(id)?.op ?? 0) > 0.4) n++; if (n >= 4) break; }
  return n;
}

/* ---------------- what a place is remembered for ---------------- */

/** The weightiest thing that has happened around a place, kept per square of the map so a village can be named for it. */
export interface Notable { kind: string; sig: number; hint: number; who: string; t: number; }
const NOTE_CELL = 12;
const NAMEABLE = new Set(["kill", "weir", "harvest", "fight", "fireout", "discover", "ember", "peace", "hut", "found", "tamed"]);
export const noteKey = (x: number, y: number) => `${Math.floor(x / NOTE_CELL)},${Math.floor(y / NOTE_CELL)}`;
/** Called with every event: keeps the weightiest nameable thing that has happened in each square. */
export function noteSite(s: Society, kind: string, sig: number, hint: number, who: number[], x: number, y: number): void {
  /* a third hut going up at a camp is no first: only the first hut anywhere names a place */
  if (!NAMEABLE.has(kind) || sig < 0.45 || (kind === "hut" && hint === 1)) return;
  const k = noteKey(x, y), old = s.notable.get(k);
  if (old && old.sig >= sig) return;
  const p = s.byId.get(who[0]) ?? s.archive.get(who[0]);
  s.notable.set(k, { kind, sig, hint, who: p?.name ?? "", t: s.time });
}
/** What a village would be named for, from the squares around it: the meaning, in English words, and the story behind it. */
export function eventName(s: Society, x: number, y: number): { words: string[]; gloss: string; why: string } | null {
  let best: Notable | null = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = s.notable.get(noteKey(x + dx * NOTE_CELL, y + dy * NOTE_CELL)); if (n && (!best || n.sig > best.sig)) best = n; }
  if (!best || best.sig < 0.55) return null;
  const who = best.who;
  switch (best.kind) {
    case "kill": { const sp = cap((SPECIES_NAMES[best.hint] ?? "Mammoth").split(" ").pop()!.replace(/s$/, "")); return { words: [sp.toLowerCase(), "fell"], gloss: `${sp} Fell`, why: `for the ${sp.toLowerCase()} ${who || "a hunter"} brought down there` }; }
    case "weir": return { words: ["weir", "water"], gloss: "Weir Water", why: `for the fish weir ${who || "someone"} built in the water there` };
    case "harvest": return { words: ["first", "harvest"], gloss: "First Harvest", why: `for the first harvest anyone brought in there` };
    case "fight": return { words: ["quarrel", "hill"], gloss: "Quarrel Hill", why: `for the fight that broke out there` };
    case "peace": return { words: ["peace", "fire"], gloss: "Peace Fire", why: `for the feud that was settled by the fire there` };
    case "fireout": case "ember": return { words: ["cold", "hearth"], gloss: "Cold Hearth", why: `for the night the fire went out there` };
    case "hut": return { words: ["first", "roof"], gloss: "First Roof", why: `for the first hut anyone ever raised, ${who ? `${who}'s, ` : ""}which stood there` };
    case "found": {
      const m = MATS[best.hint]; if (!m || !m.dug) return null;
      const land = m.id === Mat.Clay ? "bank" : m.id === Mat.Reeds ? "bed" : m.id === Mat.Salt ? "flat" : m.id === Mat.Stone ? "hill" : "rock";
      return { words: [m.name, land], gloss: `${cap(m.name)} ${cap(land)}`, why: `for the ${m.name} ${who || "someone"} found there` };
    }
    case "tamed": {
      const sp = best.hint & 15, w = (SPECIES_NAMES[sp] ?? "goats").split(" ").pop()!.replace(/s$/, ""), dogs = sp === Species.Dog;
      return { words: [w, dogs ? "hearth" : "fold"], gloss: `${cap(w)} ${dogs ? "Hearth" : "Fold"}`, why: `for the first ${w}s anyone tamed, which ${who ? `${who}'s family` : "a family"} kept there` };
    }
    case "discover": {
      const d = IDEAS[unpackHint(best.hint).id]; if (!d) return null;
      const g = d.place; if (!g) return null;
      return { words: g[0], gloss: g[1], why: `for ${who || "someone"}, who worked out ${d.how} there` };
    }
  }
  return null;
}
/** The lie of the land at a place, for naming it: a ford, a shore, a bay, a hill, a wood, a meadow. */
function landform(s: Society, x: number, y: number): string {
  const W = s.w.w; let river = false, lake = false, sea = false, hill = false;
  for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) {
    const i = ((y | 0) + dy) * W + (x | 0) + dx; if (i < 0 || i >= s.w.flags.length) continue;
    const f = s.w.flags[i], bi = s.w.biome[i];
    if (f & Flag.River) river = true; else if (f & Flag.Lake) lake = true; else if (f & Flag.Water) sea = true;
    if (bi === Biome.Mountain) hill = true;
  }
  if (river) return "Ford";
  if (lake) return "Shore";
  if (sea) return "Bay";
  if (hill) return "Hill";
  const bi = s.w.biome[(y | 0) * W + (x | 0)];
  return bi === Biome.TemperateForest || bi === Biome.TropicalForest || bi === Biome.Rainforest || bi === Biome.TemperateRainforest || bi === Biome.Taiga ? "Wood" : bi === Biome.Grassland || bi === Biome.Savanna || bi === Biome.ColdSteppe ? "Meadow" : "Hollow";
}
/** The first two syllables of a name, to make a place name of it. */
function shortName(n: string): string {
  const m = n.toLowerCase().match(/^[^aeiouy]*[aeiouy]+[^aeiouy]*[aeiouy]+/);
  return m && m[0].length >= 3 && m[0].length < n.length ? m[0] : n.toLowerCase();
}
/** A name for a new village in its people's tongue, with what it means and why. */
function nameVillage(s: Society, b: Band, x: number, y: number, founder: string): { name: string; gloss: string; why: string } {
  const lang = s.cultures[b.culture].lang;
  const ev = eventName(s, x, y);
  let name: string, gloss: string, why: string;
  if (ev) { name = compound(...ev.words.map(w => lexeme(lang, w))); gloss = ev.gloss; why = ev.why; }
  else {
    const land = landform(s, x, y);
    name = compound(founder, lexeme(lang, land.toLowerCase()));
    if (name.length > 10) name = compound(shortName(founder), lexeme(lang, land.toLowerCase()));
    gloss = `${founder}'s ${land}`; why = `after ${founder}, who raised the first hut there`;
  }
  /* two villages do not share a name: the newer is the "new" one */
  if (s.villages.some(v => v.name === name)) { name = compound(lexeme(lang, "new"), name.toLowerCase()); gloss = `New ${gloss}`; }
  return { name, gloss, why };
}

/* ---------------- each day ---------------- */

/** Who is camped together, which villages are lived in, and what that means: called once a day. */
export function villagesDay(s: Society): void {
  gatherings(s);
  villages(s);
}

function gatherings(s: Society): void {
  const still = s.bands.filter(b => !b.moving);
  /* camps within a short walk of each other, chained together */
  const group = new Map<number, number>(), find = (i: number): number => { let r = i; while (group.get(r)! !== r) r = group.get(r)!; return r; };
  for (const b of still) group.set(b.id, b.id);
  for (let i = 0; i < still.length; i++) for (let j = i + 1; j < still.length; j++) {
    const a = still[i], c = still[j];
    if (Math.hypot(a.x - c.x, a.y - c.y) < GATHER_R && friendly(s, a, c)) group.set(find(a.id), find(c.id));
  }
  const sets = new Map<number, Band[]>();
  for (const b of still) { const r = find(b.id); let l = sets.get(r); if (!l) { l = []; sets.set(r, l); } l.push(b); }
  const now: Gathering[] = [];
  for (const bs of sets.values()) {
    if (bs.length < 2) continue;
    bs.sort((a, c) => a.id - c.id);
    const ids = bs.map(b => b.id), pop = bs.reduce((n, b) => n + b.members.length, 0);
    const x = bs.reduce((n, b) => n + b.x, 0) / bs.length, y = bs.reduce((n, b) => n + b.y, 0) / bs.length;
    /* the gathering these camps carry on (when one breaks in two, the second part is a new one) */
    const old = s.gatherings.find(g => !now.includes(g) && g.bands.some(id => ids.includes(id)));
    const g: Gathering = old ?? { id: s.nextId++, bands: ids, x, y, since: s.time, peak: 0, name: bs.find(b => b.siteName)?.siteName ?? bs[0].siteName, told: false };
    if (old) s.villagesVersion += old.bands.length !== ids.length ? 1 : 0;
    g.bands = ids; g.x = x; g.y = y; g.peak = Math.max(g.peak, pop);
    if (!g.told && s.time - g.since >= DAY_SECONDS * 2) {
      g.told = true; s.stats.places.gatherings++;
      const names = bs.map(b => `the ${b.name}`), list = names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      s.event("gather", Bubble.Home, `${cap(list)} have camped together at ${g.name}: ${pop} people around ${bs.length === 2 ? "two" : bs.length === 3 ? "three" : bs.length} fires.`, x, y, bs.map(b => b.respected).filter(id => s.byId.has(id)), bs[0].id, pop);
    }
    now.push(g);
  }
  /* gatherings that have broken up */
  for (const g of s.gatherings) {
    if (now.includes(g)) continue;
    if (g.told && !s.villages.some(v => !v.abandoned && Math.hypot(v.x - g.x, v.y - g.y) < VILLAGE_R)) {
      const days = (s.time - g.since) / DAY_SECONDS, how = days < 10 ? `${Math.max(2, Math.round(days))} days` : days < 40 ? `${Math.round(days / 10)} ${Math.round(days / 10) === 1 ? "season" : "seasons"}` : "more than a year";
      const left = g.bands.map(id => s.bandById.get(id)).filter((b): b is Band => !!b && !!b.moving).map(b => `the ${b.name} set off`);
      s.event("disperse", Bubble.Move, `The gathering at ${g.name} broke up after ${how}${left.length ? `: ${left.join(", ")}` : ""}.`, g.x, g.y, [], g.bands[0]);
    }
    s.villagesVersion++;
  }
  if (now.length !== s.gatherings.length || now.some((g, i) => g !== s.gatherings[i])) s.villagesVersion++;
  s.gatherings = now;
}

function villages(s: Society): void {
  /* who lives in each village now: a band camped between two lives in the nearer */
  const nearest = new Map<number, Village>();
  for (const b of s.bands) {
    if (b.moving) continue;
    let best: Village | null = null, bd = VILLAGE_R;
    for (const v of s.villages) { const d = Math.hypot(b.x - v.x, b.y - v.y); if (d < bd) { bd = d; best = v; } }
    if (best) nearest.set(b.id, best);
  }
  for (const v of s.villages) {
    const here = s.bands.filter(b => nearest.get(b.id) === v);
    const ids = here.map(b => b.id);
    let huts = 0; for (const w of worksAround(s, v.x, v.y, VILLAGE_R + 2)) if (w.kind === Work.Hut && hutStands(w)) huts++;
    const before = v.bands;
    v.bands = ids; v.pop = here.reduce((n, b) => n + b.members.length, 0); v.peak = Math.max(v.peak, v.pop);
    if (huts !== v.huts) { v.huts = huts; s.villagesVersion++; }
    for (const b of here) {
      if (before.includes(b.id)) continue;
      s.villagesVersion++;
      if (v.abandoned) {
        v.abandoned = 0; s.stats.places.returns++;
        s.event("return", Bubble.Home, `The ${b.name} have come back to ${v.name}, ${v.huts ? `where ${v.huts} of the old huts still stand` : "where only the ribs of the old huts still stand"}. ${v.name} is lived in again.`, v.x, v.y, [b.respected].filter(id => s.byId.has(id)), b.id);
      } else if (!v.ever.includes(b.id) && before.length) {
        s.event("villagegrow", Bubble.Home, `The ${b.name} have settled at ${v.name} beside the ${before.map(id => s.bandById.get(id)?.name).filter(Boolean).join(" and the ")}: ${v.pop} people live there now.`, v.x, v.y, [b.respected].filter(id => s.byId.has(id)), b.id);
      }
      if (!v.ever.includes(b.id)) v.ever.push(b.id);
    }
    if (ids.length) v.empty = 0;
    else if (!v.empty) { v.empty = s.time; s.villagesVersion++; }
    /* a year with nobody living there, or not a hut left standing: given up */
    if (!v.abandoned && v.empty && (s.time - v.empty > DAY_SECONDS * 40 || (huts === 0 && s.time - v.empty > DAY_SECONDS * 5))) {
      v.abandoned = s.time; s.villagesVersion++; s.stats.places.abandoned++;
      const last = before.length ? s.bandById.get(before[0]) : s.bandById.get(v.ever[v.ever.length - 1]);
      s.event("abandon", Bubble.Sad, `Nobody lives at ${v.name} any more. ${huts ? `Its ${huts} ${huts === 1 ? "hut stands" : "huts stand"} empty, and will fall in.` : "Its huts have fallen in."}${last ? ` The ${last.name} were the last to live there.` : ""}`, v.x, v.y, [], last?.id ?? 0);
    }
  }
  /* new villages: a band that has lived at one camp through all four seasons, among at least three huts of living households */
  for (const b of s.bands) {
    if (b.moving || s.time - b.movedAt < DAY_SECONDS * 40) continue;
    if (s.villages.some(v => Math.hypot(v.x - b.x, v.y - b.y) < VILLAGE_R)) continue;
    const huts = worksAround(s, b.x, b.y, 14).filter(w => w.kind === Work.Hut && hutStands(w) && w.home > 0 && s.bandById.has(w.band));
    if (huts.length < 3) continue;
    found(s, b, huts);
  }
}

function found(s: Society, b: Band, huts: Work[]): void {
  const first = huts.slice().sort((a, c) => (a.built ?? a.t) - (c.built ?? c.t))[0];
  const founder = s.byId.get(first.by) ?? s.archive.get(first.by), founderName = founder?.name ?? s.byId.get(b.respected)?.name ?? b.name;
  const together = s.gatherings.find(g => g.bands.includes(b.id) && s.time - g.since >= DAY_SECONDS * 30);
  const with_ = together ? together.bands.filter(id => id !== b.id).map(id => s.bandById.get(id)).filter((o): o is Band => !!o && !o.moving && Math.hypot(o.x - b.x, o.y - b.y) < VILLAGE_R) : [];
  const { name, gloss, why } = nameVillage(s, b, b.x, b.y, founderName), site = b.siteName;
  let pits = 0; for (const w of worksAround(s, b.x, b.y, 14)) if (w.kind === Work.Pit && w.band === b.id && pitFood(w) > 1) pits++;
  const fields = worksAround(s, b.x, b.y, 16).filter(w => w.kind === Work.Plot && w.band === b.id).length;
  const story = with_.length ? `a gathering of the ${b.name} and the ${with_.map(o => o.name).join(" and the ")} that never broke up` : `the ${b.name} stopped moving`;
  const v: Village = {
    id: s.nextId++, name, gloss, why, x: b.x, y: b.y, culture: b.culture, founded: s.time, founder: first.by, founderName, story,
    bands: [b.id, ...with_.map(o => o.id)], ever: [b.id, ...with_.map(o => o.id)], pop: b.members.length + with_.reduce((n, o) => n + o.members.length, 0), peak: 0, huts: huts.length, empty: 0, abandoned: 0,
    tier: 0, chief: 0, chiefSince: 0, communal: [], call: null,
  };
  v.peak = v.pop;
  s.villages.push(v); s.villagesVersion++;
  s.stats.places.villages++; if (!s.stats.places.firstVillage) s.stats.places.firstVillage = s.time;
  b.siteName = name; for (const o of with_) o.siteName = name;
  const kept = [pits ? `${pits} storage ${pits === 1 ? "pit" : "pits"} of food put by` : "", fields ? `${fields} ${fields === 1 ? "field" : "fields"}` : ""].filter(Boolean).join(" and ");
  const who = with_.length ? `The ${b.name} and the ${with_.map(o => o.name).join(" and the ")}` : `The ${b.name}`;
  s.event("village", Bubble.Home, `${who} have lived at ${site} through a whole year, in ${huts.length} huts${kept ? ` with ${kept}` : ""}: it is a village now. They call it ${name}, "${gloss}", ${why}.`, b.x, b.y, [first.by, b.respected].filter((id, i, a) => s.byId.has(id) && a.indexOf(id) === i), b.id, v.pop);
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Villages, gatherings and ruins for the map's labels. */
export function villageSnaps(s: Society): VillageSnap[] {
  const out: VillageSnap[] = [];
  const bandsOf = (ids: number[]) => ids.map(id => s.bandById.get(id)).filter((b): b is Band => !!b);
  for (const v of s.villages) {
    const bs = bandsOf(v.bands);
    if (v.abandoned && !v.huts && !worksAround(s, v.x, v.y, VILLAGE_R).some(w => w.kind === Work.Hut)) continue;
    out.push({ id: v.id, kind: v.abandoned ? "ruins" : "village", name: v.name, gloss: v.gloss, x: v.x, y: v.y, pop: v.pop, bands: bs.map(b => b.name), color: bs[0]?.color ?? "#9a8a6a", band: bs[0]?.id ?? 0, tier: v.tier });
  }
  for (const g of s.gatherings) {
    if (!g.told || s.villages.some(v => !v.abandoned && Math.hypot(v.x - g.x, v.y - g.y) < VILLAGE_R)) continue;
    const bs = bandsOf(g.bands);
    out.push({ id: g.id, kind: "gathering", name: g.name, gloss: "", x: g.x, y: g.y, pop: bs.reduce((n, b) => n + b.members.length, 0), bands: bs.map(b => b.name), color: bs[0]?.color ?? "#9a8a6a", band: bs.slice().sort((a, b) => b.members.length - a.members.length)[0]?.id ?? 0, tier: 0 });
  }
  return out;
}

/** The village a band lives in, if any. */
export function villageOf(s: Society, b: Band): Village | null {
  if (b.moving) return null;
  return s.villages.find(v => !v.abandoned && v.bands.includes(b.id)) ?? null;
}
