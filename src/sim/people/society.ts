import { Biome, Flag, Species, DAY_SECONDS, DAYS_PER_YEAR, SPECIES_NAMES, type WorldData } from "../../shared/types.ts";
import { Rng } from "../../shared/rng.ts";
import { Anim, Bubble, PERSON_STRIDE, PFlag, type CampSnap, type ChronicleEvent, type Look, type Stage, type Wear } from "../../shared/people.ts";
import type { Ecology } from "../ecology.ts";
import type { Wildlife, Herd } from "../wildlife.ts";
import { ancestryFor, founderGenome, inherit, looksOf, temperament, hairAt, idealMel, skinWord, hairWord, curlWord, heightCm, heightWord, buildWord, type Ancestry, type Genome } from "./genetics.ts";
import { makeCulture, pickStyle, type Culture } from "./culture.ts";
import { personName, placeName } from "./language.ts";
import { Walker } from "./walk.ts";
import { type Band, homeOf, storeDays, storeFood, siteValue, estimate } from "./band.ts";
import { Goal, Know, Mem, Place, YEAR, ageOf, stageOf, type Archived, type KnownPlace, type Person, type Rel } from "./person.ts";
import { decide, isInterruptible } from "./mind.ts";
import { doStep, abandon } from "./doing.ts";

/*
  Everyone alive, and the bands they live in. Each step every person's body changes (they
  get hungry, thirsty, tired, cold or lonely), they notice what is around them, and they
  either carry on with what they are doing or decide what to do next. Once a day the life
  cycle turns: children are conceived and born, people age, fall ill, recover or die, and
  each band weighs whether to stay where it is, move on, or split.
*/

export interface StartOptions { start: "bands" | "cradle"; bands: number; }
export interface Carcass { id: number; x: number; y: number; sp: number; meat: number; hides: number; t: number; by: number; }

export const FOOD_DAY: Record<Stage, number> = { baby: 0, toddler: 0.45, child: 0.65, teen: 0.95, adult: 1, elder: 0.8 };
/** Meat on one animal, in days of food for one person. */
export const MEAT = [25, 100, 400, 60, 0, 60];
const BAND_COLORS = ["#c0563f", "#4f74a8", "#c99a32", "#7d5a96", "#4e8a5c", "#b5683a", "#3f8a8c", "#a8456a", "#6e7d3a", "#8a5a3a", "#5a6ab0", "#b0804a", "#507a8c", "#9a4a8a", "#6a9a4a", "#c07a5a"];

export class Society {
  readonly w: WorldData; readonly eco: Ecology; readonly wild: Wildlife; readonly walker: Walker; readonly rng: Rng;
  people: Person[] = [];
  byId = new Map<number, Person>();
  archive = new Map<number, Archived>();
  bands: Band[] = [];
  bandById = new Map<number, Band>();
  cultures: Culture[] = [];
  carcasses: Carcass[] = [];
  time = 0; season = 1; day = 0; sun = 1;
  nextId = 1; nextEvent = 1; private lastDay = -1;
  events: ChronicleEvent[] = [];
  fresh: ChronicleEvent[] = [];
  /** looks that changed since the renderer last asked */
  dirty = new Set<number>();
  stats = { births: 0, deaths: 0, causes: new Map<string, number>(), couples: 0, partings: 0, moves: 0, splits: 0, merges: 0, kills: new Array(6).fill(0) as number[], food: { plant: 0, meat: 0, fish: 0, small: 0 }, contacts: 0, attacks: 0, learned: 0, maxPop: 0 };
  readonly start: StartOptions;
  private grid = new Map<number, Person[]>();
  private herdGrid = new Map<number, Herd[]>();
  private herdGridAt = -1;
  /** people near the camera get step-by-step attention; others are still simulated in full */
  selected = 0;

  constructor(w: WorldData, eco: Ecology, wild: Wildlife, seed: number, start: StartOptions, time: number) {
    this.w = w; this.eco = eco; this.wild = wild; this.walker = new Walker(w);
    this.rng = new Rng(seed * 31 + 101);
    this.start = start;
    this.time = time; this.day = Math.floor(time / DAY_SECONDS); this.lastDay = this.day;
    this.season = Math.floor(this.day / 10) % 4; this.walker.setSeason(this.season);
    this.found(seed);
  }

  /* ---------------- the world as people feel it ---------------- */

  /** Air temperature in °C at a tile right now: the yearly mean, the season, and the time of day. */
  tempC(x: number, y: number, t = this.time): number {
    const i = (y | 0) * this.w.w + (x | 0), annual = this.w.temp[i] / 255 * 62 - 26;
    const lat = Math.abs(y / this.w.h - 0.5) * 2, amp = 3 + 15 * lat;
    const yearFrac = (t / DAY_SECONDS / DAYS_PER_YEAR) % 1, dayFrac = (t / DAY_SECONDS) % 1;
    return annual + amp * Math.cos(2 * Math.PI * (yearFrac - 0.375)) + 4 * Math.cos(2 * Math.PI * (dayFrac - 0.58));
  }
  /** Daylight 0..1, the same curve the renderer darkens the map with. */
  static sunAt(t: number): number { const d = (t / DAY_SECONDS) % 1; return d < 0.22 || d > 0.85 ? 0 : d < 0.32 ? (d - 0.22) / 0.1 : d > 0.72 ? 1 - (d - 0.72) / 0.13 : 1; }
  dayFrac(): number { return (this.time / DAY_SECONDS) % 1; }
  isFresh(x: number, y: number): boolean { const f = this.w.flags[(y | 0) * this.w.w + (x | 0)]; return (f & (Flag.River | Flag.Lake)) !== 0; }
  /** The nearest dry tile next to fresh water within r tiles, or null. */
  waterNear(x: number, y: number, r: number): [number, number] | null {
    let best: [number, number] | null = null, bd = 1e9;
    const W = this.w.w, H = this.w.h, x0 = x | 0, y0 = y | 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x0 + dx, yy = y0 + dy; if (xx < 2 || yy < 2 || xx >= W - 2 || yy >= H - 2) continue;
      if (!this.isFresh(xx, yy)) continue;
      /* stand on the bank next to it */
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const bx = xx + ax, by = yy + ay; if (!this.walker.dry(bx, by)) continue;
        const d = Math.hypot(bx - x, by - y); if (d < bd) { bd = d; best = [bx + 0.5, by + 0.5]; }
      }
    }
    return best;
  }
  stage(p: Person): Stage { return stageOf(ageOf(p, this.time)); }
  age(p: Person): number { return ageOf(p, this.time); }
  band(p: Person): Band { return this.bandById.get(p.band)!; }
  culture(p: Person): Culture { return this.cultures[this.band(p).culture]; }
  rel(p: Person, id: number): Rel { let r = p.rel.get(id); if (!r) { r = { op: 0, fam: 0, court: 0, seen: this.time }; p.rel.set(id, r); } return r; }
  op(p: Person, id: number): number { return p.rel.get(id)?.op ?? 0; }

  /* ---------------- founding ---------------- */

  private habitability(i: number): number {
    switch (this.w.biome[i]) {
      case Biome.Grassland: case Biome.Savanna: case Biome.TemperateForest: return 1;
      case Biome.Shrubland: case Biome.TropicalForest: return 0.9;
      case Biome.Beach: return 0.8;
      case Biome.TemperateRainforest: case Biome.ColdSteppe: return 0.7;
      case Biome.Rainforest: case Biome.Taiga: return 0.6;
      case Biome.Swamp: return 0.45;
      case Biome.Tundra: return 0.3;
      default: return 0;
    }
  }
  /** A good camp near (x, y): dry ground with room for shelters, close to fresh water. */
  campSpot(x: number, y: number, r: number): [number, number] | null {
    let best: [number, number] | null = null, bs = -1;
    for (let k = 0; k < 60; k++) {
      const tx = Math.round(x + (this.rng.next() - 0.5) * 2 * r), ty = Math.round(y + (this.rng.next() - 0.5) * 2 * r);
      if (!this.roomy(tx, ty)) continue;
      const wat = this.waterNear(tx, ty, 5); if (!wat) continue;
      const s = this.habitability(ty * this.w.w + tx) * 2 - Math.hypot(wat[0] - tx, wat[1] - ty) * 0.15 - Math.hypot(tx - x, ty - y) * 0.03;
      if (s > bs) { bs = s; best = [tx + 0.5, ty + 0.5]; }
    }
    return best;
  }
  private roomy(x: number, y: number): boolean {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!this.walker.dry(x + dx, y + dy) || this.w.biome[(y + dy) * this.w.w + x + dx] === Biome.Mountain) return false;
    return true;
  }
  private foodAround(x: number, y: number): number {
    const e = this.eco; let v = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = e.cell(x + dx * 16, y + dy * 16); v += e.plantK[c] + e.fishK[c] * 0.8 + e.rabbitK[c] * 0.3; }
    return v / 9;
  }
  private climateAt(x: number, y: number) {
    const lat = Math.abs(y / this.w.h - 0.5) * 2, i = (y | 0) * this.w.w + (x | 0);
    const annual = this.w.temp[i] / 255 * 62 - 26, amp = 3 + 15 * lat;
    return { uv: Math.max(0.02, Math.min(1, 1.04 - lat * 1.06 - Math.max(0, this.w.elev[i]) * 0.2 + 0.04)), winter: annual - amp, summer: annual + amp, annual };
  }

  private found(seed: number): void {
    const { w } = this, rng = this.rng, n = Math.max(1, this.start.bands);
    const cands: { x: number; y: number; s: number }[] = [];
    for (let k = 0; k < 9000 && cands.length < 2400; k++) {
      const x = rng.int(8, w.w - 9), y = rng.int(8, w.h - 9), i = y * w.w + x;
      const hab = this.habitability(i); if (hab <= 0 || w.flags[i] & Flag.Water) continue;
      if (!this.waterNear(x, y, 4)) continue;
      const c = this.climateAt(x, y);
      const mild = c.winter > -22 && c.summer < 40 ? 1 : 0.3;
      cands.push({ x, y, s: hab * (0.4 + this.foodAround(x, y)) * mild });
    }
    cands.sort((a, b) => b.s - a.s);
    const chosen: { x: number; y: number }[] = [];
    if (this.start.start === "cradle") {
      /* one homeland: the best warm, well-watered spot, with every band settled around it */
      const home = cands.find(c => this.climateAt(c.x, c.y).annual > 12) ?? cands[0];
      chosen.push(home);
      for (const c of cands) {
        if (chosen.length >= n) break;
        const d = Math.hypot(c.x - home.x, c.y - home.y);
        if (d > 110 || chosen.some(o => Math.hypot(o.x - c.x, o.y - c.y) < 18)) continue;
        if (this.walker.route(home.x, home.y, c.x, c.y, 20000) === null) continue;
        chosen.push(c);
      }
    } else {
      /* scattered: as far apart as good land allows, so bands start on different shores and continents */
      const top = cands.slice(0, Math.max(60, Math.floor(cands.length * 0.6)));
      chosen.push(top[0]);
      while (chosen.length < n && chosen.length < top.length) {
        let best = top[0], bv = -1;
        for (const c of top) { let md = 1e9; for (const o of chosen) md = Math.min(md, Math.hypot(c.x - o.x, (c.y - o.y) * 1.3)); const v = Math.pow(c.s, 0.6) * Math.min(md, w.w / 3); if (v > bv) { bv = v; best = c; } }
        if (bv <= 0) break; chosen.push(best);
      }
    }
    const cradleAnc = this.start.start === "cradle" && chosen.length ? this.ancestryAt(chosen[0].x, chosen[0].y) : null;
    for (let b = 0; b < chosen.length; b++) {
      const spot = this.campSpot(chosen[b].x, chosen[b].y, 6) ?? [chosen[b].x + 0.5, chosen[b].y + 0.5];
      const cult = this.start.start === "cradle" ? 0 : b;
      if (!this.cultures[cult]) this.cultures[cult] = makeCulture(cult, seed);
      this.foundBand(spot[0], spot[1], cult, cradleAnc ?? this.ancestryAt(spot[0], spot[1]), rng.int(18, 28));
    }
  }
  private ancestryAt(x: number, y: number): Ancestry {
    const c = this.climateAt(x, y);
    return ancestryFor(c.uv, Math.max(0, Math.min(1, (6 - c.winter) / 30)), Math.max(0, Math.min(1, (c.summer - 14) / 20)), this.rng);
  }

  newBand(x: number, y: number, culture: number, parent: number): Band {
    const id = this.bands.length ? Math.max(...this.bands.map(b => b.id)) + 1 : 1;
    const name = placeName(this.cultures[culture].lang, this.rng);
    const b: Band = { id, name, culture, color: BAND_COLORS[(id - 1) % BAND_COLORS.length], x, y, fire: 0.8, store: { plant: 0, meat: 0, fish: 0, wood: 2, hides: 0 },
      members: [], founded: this.time, movedAt: this.time, moves: 0, homes: new Map(), busy: new Map(), respected: 0, parent, met: new Set(), appetite: 1, moving: null, siteName: placeName(this.cultures[culture].lang, this.rng) };
    this.bands.push(b); this.bandById.set(id, b);
    return b;
  }

  private foundBand(x: number, y: number, culture: number, anc: Ancestry, size: number): void {
    const rng = this.rng, b = this.newBand(x, y, culture, 0), now = this.time;
    const clim = this.climateAt(x, y);
    const add = (sex: "f" | "m", age: number, g: Genome, mother = 0, father = 0) => this.makePerson(b, sex, now - age * YEAR - rng.next() * YEAR * 0.5, g, mother, father, clim.winter);
    /* elders, their grown children with partners from other families, and their grandchildren */
    const couple = (ageF: number) => {
      const f = add("f", ageF, founderGenome(anc, rng)), m = add("m", ageF + rng.int(-3, 6), founderGenome(anc, rng));
      this.pair(f, m, false); return [f, m] as const;
    };
    const kidsOf = (f: Person, m: Person, ageF: number) => {
      const out: Person[] = [];
      for (let a = ageF - 19 - rng.int(0, 3); a >= Math.max(0, ageF - 44) && out.length < 6; a -= rng.range(2.6, 4.4)) {
        if (rng.chance(0.3)) continue;   /* not every child lived */
        out.push(add(rng.chance(0.51) ? "m" : "f", a, inherit(f.genome, m.genome, rng), f.id, m.id));
      }
      return out;
    };
    const [gma, gpa] = couple(rng.int(54, 64));
    const grown = kidsOf(gma, gpa, this.age(gma)).filter(k => this.age(k) >= 18);
    for (const k of grown) {
      const spouse = add(k.sex === "f" ? "m" : "f", Math.max(17, this.age(k) + rng.int(-4, 4)), founderGenome(anc, rng));
      const [f, m] = k.sex === "f" ? [k, spouse] : [spouse, k];
      this.pair(f, m, false); kidsOf(f, m, this.age(f));
    }
    while (b.members.length < size) {
      const ageF = rng.int(19, 44), [f, m] = couple(ageF); kidsOf(f, m, ageF);
      if (rng.chance(0.25)) add(rng.chance(0.5) ? "f" : "m", rng.int(16, 24), founderGenome(anc, rng));
    }
    /* everyone in a band knows everyone, families best */
    const ms = b.members.map(id => this.byId.get(id)!);
    for (const p of ms) for (const q of ms) if (p !== q) { const r = this.rel(p, q.id); r.fam = 0.8; r.op = 0.12 + rng.next() * 0.25 + (this.kin(p, q, 1) ? 0.45 : 0); }
    this.settleCamp(b, x, y, true);
    b.store.plant = b.members.length * 1.5;
    for (const p of ms) this.learnSurroundings(p, 40);
    b.appetite = ms.reduce((a, q) => a + FOOD_DAY[this.stage(q)], 0);
  }

  /** Makes a person of a band. Founders get skills and knowledge for their age; newborns start with nothing. */
  makePerson(b: Band, sex: "f" | "m", born: number, genome: Genome, mother: number, father: number, winterC: number): Person {
    const rng = this.rng, cult = this.cultures[b.culture];
    const noise = [rng.gauss(), rng.gauss(), rng.gauss(), rng.gauss(), rng.gauss()];
    const looks = looksOf(genome, noise);
    const age = (this.time - born) / YEAR, adult = Math.min(1, Math.max(0, (age - 8) / 14));
    const lang = cult.lang;
    let name = personName(lang, rng, sex);
    const mom = this.byId.get(mother), dad = this.byId.get(father);
    if ((mom || dad) && rng.chance(cult.namesake)) {
      const gps = [mom?.mother, mom?.father, dad?.mother, dad?.father].map(id => id ? this.byId.get(id) ?? this.archive.get(id) : undefined).filter(g => g && g.sex === sex);
      if (gps.length) name = rng.pick(gps)!.name;
    }
    const p: Person = {
      id: this.nextId++, name, sex, born, genome, noise, looks, traits: temperament(genome, rng),
      skills: [0, 0, 0, 0].map(() => adult * rng.range(0.15, 0.75)), knows: age >= 12 ? Know.Fire | Know.Spear | Know.Fishing | Know.Hides | Know.Snares : age >= 8 ? Know.Fire | Know.Snares : 0,
      mother, father, partner: 0, children: [], guardian: 0, band: b.id,
      x: b.x, y: b.y, dir: 0,
      food: 1.3 + rng.next() * 0.4, water: 0.7 + rng.next() * 0.3, rest: 0.7 + rng.next() * 0.3, warmth: 0.9, company: 0.7, fear: 0, health: 1, mood: 0.3,
      childHunger: 0, injury: 0, sick: 0, pregnantBy: 0, due: 0, fatherGenome: null, baby: 0, carrier: 0,
      carryKind: 0, carryAmt: 0, hides: 0,
      spear: age >= 15 ? rng.range(0.5, 1) : 0,
      clothes: winterC < -2 ? 2 : winterC < 12 ? 1 : 0, clothesWear: rng.range(0.6, 1),
      prestige: adult * rng.range(0, 0.6), gave: 0.5, took: 0.5, longing: 0,
      goal: Goal.None, plan: [], si: 0, why: "", whyAt: 0, path: null, pi: 0, anim: Anim.Idle, bubble: Bubble.None, bubbleUntil: 0,
      rel: new Map(), mem: [], places: [], moveWish: 0, leaveWish: 0, tripYield: 2.5, nextLook: 0, nextDanger: 0, party: 0,
      style: "short", lookKey: "", learning: -1,
    };
    p.style = pickStyle(cult, sex, looks.curl, rng);
    p.nextLook = this.time + rng.next() * 3; p.nextDanger = this.time + rng.next();
    if (mom) mom.children.push(p.id); if (dad) dad.children.push(p.id);
    this.people.push(p); this.byId.set(p.id, p); b.members.push(p.id);
    if (age < 2 && mom) { p.carrier = mom.id; mom.baby = p.id; }
    this.dirty.add(p.id);
    return p;
  }

  pair(f: Person, m: Person, announce = true): void {
    f.partner = m.id; m.partner = f.id; f.longing = 0; m.longing = 0;
    const rf = this.rel(f, m.id), rm = this.rel(m, f.id); rf.op = Math.max(rf.op, 0.55); rm.op = Math.max(rm.op, 0.55); rf.court = rm.court = 1; rf.fam = rm.fam = 1;
    if (!announce) return;
    this.stats.couples++;
    this.remember(f, Mem.Paired, m.id, 0.7); this.remember(m, Mem.Paired, f.id, 0.7);
    /* a couple from two bands settles with one of them, as their people's custom leans */
    if (f.band !== m.band) {
      const cult = this.cultures[this.band(m).culture], toMan = this.rng.chance(cult.locality);
      const mover = toMan ? f : m, stay = toMan ? m : f;
      this.event("couple", Bubble.Heart, `${f.name} and ${m.name} became a couple. ${mover.name} left the ${this.band(mover).name} to live with the ${this.band(stay).name}.`, stay.x, stay.y, [f.id, m.id], stay.band);
      this.moveTo(mover, this.band(stay));
    } else this.event("couple", Bubble.Heart, `${f.name} and ${m.name} of the ${this.band(f).name} became a couple.`, f.x, f.y, [f.id, m.id], f.band);
  }
  /** Moves a person (and any baby or young children they look after) to another band. */
  moveTo(p: Person, to: Band): void {
    const move = (q: Person) => {
      const from = this.bandById.get(q.band); if (from) from.members = from.members.filter(id => id !== q.id);
      q.band = to.id; to.members.push(q.id); abandon(this, q); this.dirty.add(q.id);
      for (const id of to.members) { const o = this.byId.get(id); if (o && o !== q) { const r = this.rel(q, id); r.fam = Math.max(r.fam, 0.3); this.rel(o, q.id).fam = Math.max(this.rel(o, q.id).fam, 0.3); } }
      this.learnPlace(q, Place.Camp, to.x, to.y, 1, to.id, 0);
    };
    move(p);
    if (p.baby) { const b = this.byId.get(p.baby); if (b) move(b); }
    for (const cid of p.children) { const c = this.byId.get(cid); if (c && this.age(c) < 12 && c.band !== to.id && (c.mother === p.id || !this.byId.has(c.mother))) move(c); }
  }

  /** Are two people close kin (parent, child, sibling, grandparent, aunt or uncle, first cousin)? */
  kin(a: Person, b: { id: number; mother: number; father: number }, depth = 2): boolean {
    const up = (id: number, d: number, out: Set<number>) => { if (!id || d < 0) return; out.add(id); const r = this.byId.get(id) ?? this.archive.get(id); if (r) { up(r.mother, d - 1, out); up(r.father, d - 1, out); } };
    const A = new Set<number>(), B = new Set<number>();
    up(a.id, depth, A); up(b.id, depth, B);
    for (const x of A) if (B.has(x)) return true;
    return false;
  }

  /* ---------------- camps ---------------- */

  /** Sets a band's camp and lays out a shelter for each household around the fire. */
  settleCamp(b: Band, x: number, y: number, first = false): void {
    b.x = x; b.y = y;
    if (!first) { b.fire = Math.min(b.fire, 0.3); b.movedAt = this.time; b.moves++; }
    this.layoutHomes(b);
    for (const id of b.members) { const p = this.byId.get(id); if (p) this.learnPlace(p, Place.Camp, x, y, 1, b.id, 0); }
  }
  layoutHomes(b: Band): void {
    const heads: number[] = [];
    for (const id of b.members) { const p = this.byId.get(id); if (!p || this.stage(p) === "baby") continue; const h = homeOf(p, this.byId, this.time); if (!heads.includes(h)) heads.push(h); }
    heads.sort((a, c) => a - c);
    const old = b.homes; b.homes = new Map();
    const n = heads.length, r = 2.4 + n * 0.16;
    heads.forEach((h, k) => {
      const keep = old.get(h); if (keep && Math.hypot(keep[0] - b.x, keep[1] - b.y) < r + 2 && this.walker.dry(keep[0], keep[1])) { b.homes.set(h, keep); return; }
      for (let tries = 0; tries < 12; tries++) {
        const a = (k + tries * 0.37) / Math.max(1, n) * Math.PI * 2 + b.id, rr = r + (tries % 3) * 0.6;
        const hx = b.x + Math.cos(a) * rr, hy = b.y + Math.sin(a) * rr * 0.8;
        if (this.walker.dry(hx, hy)) { b.homes.set(h, [hx, hy]); return; }
      }
      b.homes.set(h, [b.x + 0.5, b.y + 1.5]);
    });
  }
  homeSpot(p: Person): [number, number] {
    const b = this.band(p), h = b.homes.get(homeOf(p, this.byId, this.time));
    const j = (p.id * 0.618) % 1;
    if (h) return [h[0] + (j - 0.5) * 1.2, h[1] + 0.6 + ((p.id * 0.37) % 1) * 0.5];
    return [b.x + Math.cos(p.id) * 2.2, b.y + Math.sin(p.id) * 1.8];
  }
  fireSpot(p: Person): [number, number] {
    const b = this.band(p), a = (p.id * 2.399) % (Math.PI * 2), r = 1.1 + ((p.id * 0.13) % 1) * 0.6;
    const x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r * 0.75;
    return this.walker.dry(x, y) ? [x, y] : [b.x, b.y + 1];
  }
  siteValueFor(p: Person, x: number, y: number): number { return siteValue(p, x, y, this.time); }
  atCamp(p: Person, r = 6): boolean { const b = this.band(p); return Math.hypot(p.x - b.x, p.y - b.y) < r; }

  /* ---------------- knowledge of places ---------------- */

  learnPlace(p: Person, k: number, x: number, y: number, q: number, ref: number, src: number, t = this.time, sp?: number): void {
    const same = (pl: KnownPlace) => pl.k === k && (ref ? pl.ref === ref : Math.hypot(pl.x - x, pl.y - y) < (k === Place.Water ? 3 : 8));
    const old = p.places.find(same);
    if (old) { if (t >= old.t) { old.x = x; old.y = y; old.q = q; old.t = t; old.src = src; if (sp !== undefined) old.sp = sp; } return; }
    p.places.push({ k, x, y, q, t, src, ref, sp });
    if (p.places.length > 30) {
      /* forget the least useful: stale game first, then whatever is poorest and oldest */
      let worst = -1, wv = 1e9;
      p.places.forEach((pl, i) => { if (pl.k === Place.Camp && pl.ref === p.band) return; const v = (pl.k === Place.Water ? 6 : estimate(pl, this.time) + 1) - (this.time - pl.t) / 600; if (v < wv) { wv = v; worst = i; } });
      if (worst >= 0) p.places.splice(worst, 1);
    }
  }
  /** What a person can see standing where they are, and a look around the patches nearby. */
  learnSurroundings(p: Person, radius: number): void {
    const e = this.eco, cx = p.x, cy = p.y;
    const wat = this.waterNear(cx, cy, 6); if (wat) this.learnPlace(p, Place.Water, wat[0], wat[1], 1, 0, 0);
    const R = Math.ceil(radius / 16);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx * 16, y = cy + dy * 16; if (x < 2 || y < 2 || x >= this.w.w - 2 || y >= this.w.h - 2) continue;
      if (Math.hypot(dx, dy) * 16 > radius + 8) continue;
      const c = e.cell(x, y), gx = (Math.floor(x / 16) + 0.5) * 16, gy = (Math.floor(y / 16) + 0.5) * 16;
      if (e.plants[c] * 36 > 6) { const spot = this.foodSpot(gx, gy, "plant"); if (spot) this.learnPlace(p, Place.Plants, spot[0], spot[1], e.plants[c] * 36 * 0.5, 0, 0); }
      if (e.fish[c] * 150 > 8) { const spot = this.foodSpot(gx, gy, "fish"); if (spot) this.learnPlace(p, Place.Fish, spot[0], spot[1], Math.min(20, e.fish[c] * 150 * 0.1), 0, 0); }
      if (e.rabbits[c] * 20 > 4) { const spot = this.foodSpot(gx, gy, "rabbit"); if (spot) this.learnPlace(p, Place.Rabbits, spot[0], spot[1], e.rabbits[c] * 20 * 0.3, 0, 0); }
    }
  }
  /** A tile in the patch around (x, y) to stand on for that kind of food: by a food tree or meadow, on a bank, in open grass. */
  foodSpot(x: number, y: number, kind: "plant" | "fish" | "rabbit"): [number, number] | null {
    const W = this.w.w;
    let best: [number, number] | null = null, bs = -1;
    for (let k = 0; k < 26; k++) {
      const tx = Math.floor(x + (this.rng.next() - 0.5) * 16), ty = Math.floor(y + (this.rng.next() - 0.5) * 16);
      if (!this.walker.dry(tx, ty)) continue;
      const i = ty * W + tx, tr = this.w.tree[i];
      let s = 0;
      if (kind === "plant") s = (tr === 18 ? 3 : tr === 1 || tr === 4 || tr === 11 || tr === 13 ? 1.5 : tr === 19 ? 1.2 : tr ? 0.5 : 0.8) + ((this.w.flags[i] & Flag.Coast) ? 0.8 : 0);
      else if (kind === "fish") { let wet = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.w.flags[(ty + dy) * W + tx + dx] & Flag.Water) wet++; s = wet ? 1 + wet * 0.2 : 0; }
      else s = tr ? 0.4 : 1;
      if (s > bs) { bs = s; best = [tx + 0.5, ty + 0.5]; }
    }
    return bs > 0 ? best : null;
  }

  /* ---------------- memories and events ---------------- */

  remember(p: Person, k: number, who: number, v: number, n = 0): void {
    p.mem.push({ t: this.time, k, who, v, x: p.x, y: p.y, n });
    if (p.mem.length > 24) { let wi = 0, wv = 1e9; p.mem.forEach((m, i) => { const s = Math.abs(m.v) * Math.exp(-(this.time - m.t) / (YEAR * 0.6)); if (s < wv) { wv = s; wi = i; } }); p.mem.splice(wi, 1); }
  }
  event(kind: string, icon: number, text: string, x: number, y: number, who: number[], band: number): void {
    const e: ChronicleEvent = { id: this.nextEvent++, t: this.time, kind, icon: icon as ChronicleEvent["icon"], text, x, y, who, band };
    this.events.push(e); this.fresh.push(e);
    if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
  }
  bubble(p: Person, b: number, secs = 3): void { p.bubble = b as Person["bubble"]; p.bubbleUntil = this.time + secs; }

  /* ---------------- each step ---------------- */

  update(dt: number, time: number, season: number): void {
    this.time = time; this.season = season; this.sun = Society.sunAt(time);
    this.walker.setSeason(season);
    const day = Math.floor(time / DAY_SECONDS);
    this.rebuildGrid();
    if (time - this.herdGridAt > 1) this.rebuildHerdGrid();
    for (const b of this.bands) b.busy.clear();
    for (const p of this.people) { const b = this.bandById.get(p.band); if (b) b.busy.set(p.goal, (b.busy.get(p.goal) ?? 0) + 1); }
    const list = this.people.slice();
    for (const p of list) {
      if (!this.byId.has(p.id)) continue;
      this.body(p, dt);
      if (!this.byId.has(p.id)) continue;
      if (p.carrier) { this.carried(p); continue; }
      if (time >= p.nextDanger) { p.nextDanger = time + 0.8 + (p.id % 7) * 0.05; this.danger(p); }
      if (time >= p.nextLook) { p.nextLook = time + 2.5 + (p.id % 11) * 0.1; this.look(p); }
      if (p.si >= p.plan.length || (isInterruptible(p.goal) && time - p.whyAt > 7) || this.urgent(p)) decide(this, p);
      doStep(this, p, dt);
    }
    this.camps(dt);
    for (const b of this.bands) if (b.moving) {
      /* the band has arrived when most of it is there, or after three days whatever the stragglers do */
      const m = b.moving; let there = 0;
      for (const id of b.members) { const q = this.byId.get(id); if (q && Math.hypot(q.x - m.x, q.y - m.y) < 5) there++; }
      if (there >= b.members.length * 0.6 || time - m.since > DAY_SECONDS * 3) this.arrive(b);
    }
    if (day !== this.lastDay) { this.lastDay = day; this.day = day; this.daily(); }
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const p of this.people) { const k = ((p.y / 8) | 0) * 4096 + ((p.x / 8) | 0); let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); } a.push(p); }
  }
  private rebuildHerdGrid(): void {
    this.herdGrid.clear(); this.herdGridAt = this.time;
    for (const h of this.wild.herds) { if (h.n <= 0) continue; const k = ((h.y / 16) | 0) * 4096 + ((h.x / 16) | 0); let a = this.herdGrid.get(k); if (!a) { a = []; this.herdGrid.set(k, a); } a.push(h); }
  }
  /** People within r tiles of (x, y). */
  near(x: number, y: number, r: number, out: Person[] = []): Person[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / 8), x1 = Math.floor((x + r) / 8), y0 = Math.floor((y - r) / 8), y1 = Math.floor((y + r) / 8);
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const a = this.grid.get(gy * 4096 + gx); if (a) for (const p of a) if (Math.hypot(p.x - x, p.y - y) <= r) out.push(p); }
    return out;
  }
  herdsNear(x: number, y: number, r: number): Herd[] {
    const out: Herd[] = [];
    const x0 = Math.floor((x - r) / 16), x1 = Math.floor((x + r) / 16), y0 = Math.floor((y - r) / 16), y1 = Math.floor((y + r) / 16);
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const a = this.herdGrid.get(gy * 4096 + gx); if (a) for (const h of a) if (h.n > 0 && Math.hypot(h.x - x, h.y - y) <= r) out.push(h); }
    return out;
  }

  /** Needs that cannot wait for the current task to finish. */
  private urgent(p: Person): boolean {
    if (p.goal === Goal.Flee || p.goal === Goal.Migrate || p.goal === Goal.Sick) return false;
    if (p.water < 0.12 && p.goal !== Goal.Drink) return true;
    if (p.warmth < 0.22 && p.goal !== Goal.Warm && p.goal !== Goal.Sleep && this.band(p).fire > 0.05) return true;
    if (p.food < 0.12 && p.carryAmt > 0 && p.carryKind !== 4 && p.goal !== Goal.Eat) return true;
    if (p.sick > 0.5) return true;
    return false;
  }

  /** The body: hunger, thirst, tiredness, cold, loneliness and health, every step. */
  private body(p: Person, dt: number): void {
    const st = this.stage(p), days = dt / DAY_SECONDS, b = this.band(p);
    const working = p.goal >= Goal.Gather && p.goal <= Goal.Wood, asleep = p.goal === Goal.Sleep && p.anim === Anim.Sleep;
    const moving = p.anim === Anim.Walk || p.anim === Anim.Carry || p.anim === Anim.CaneWalk, running = p.anim === Anim.Run || p.anim === Anim.Play;
    const T = this.tempC(p.x, p.y);
    if (st === "baby") {
      /* infants nurse while whoever carries them is nursing and fed; a weaned-enough baby can be fed soft food at camp */
      const c = this.byId.get(p.carrier), nursing = !!c && c.sex === "f" && c.baby === p.id && c.food > 0.25;
      p.food = Math.max(0, Math.min(2, p.food + ((nursing ? 1.1 : 0) - 0.5) * days));
      if (!nursing && this.age(p) > 0.9 && this.atCamp(p) && p.food < 1.2) this.eatFromStore(p, b, 0.8 * days);
    } else {
      let burn = FOOD_DAY[st] * (asleep ? 0.7 : running ? 1.5 : working ? 1.25 : moving ? 1.15 : 1);
      if (p.pregnantBy) burn += 0.15;
      if (p.baby) burn += 0.35;
      if (p.warmth < 0.5) burn += 0.25;
      p.food = Math.max(0, p.food - burn * days);
    }
    p.water = Math.max(0, p.water - (asleep ? 1.1 : 2.2) * (T > 28 ? 1.6 : T < 0 ? 0.75 : 1) * (working || running ? 1.3 : 1) * (st === "baby" ? 0 : 1) * days);
    p.rest = Math.max(0, Math.min(1, p.rest + (asleep ? 0.045 : p.anim === Anim.Sit || p.anim === Anim.HoldBaby || p.anim === Anim.Sick ? 0.006 : -0.026 * (running ? 1.6 : 1)) * dt));
    /* warmth: clothes set how cold it can be before you feel it; a fire and a shelter help */
    const fireNear = b.fire > 0.04 && Math.hypot(p.x - b.x, p.y - b.y) < 3, home = asleep && this.atCamp(p, 7);
    const comfort = 16 - 8 * this.clothesNow(p) - (moving || working || running ? 5 : 0) - (st === "baby" ? 8 : 0);
    const felt = T + (fireNear ? 16 : 0) + (home ? 7 : 0);
    const target = Math.max(0, Math.min(1, 0.96 - Math.max(0, comfort - felt) / 16));
    p.warmth += (target - p.warmth) * Math.min(1, dt * (target > p.warmth ? 0.12 : 0.05));
    /* company: being around people you like fills it, being alone drains it */
    if (!asleep && st !== "baby") p.company = Math.max(0, p.company - 0.7 * days);
    p.fear = Math.max(0, p.fear - 0.12 * dt);
    /* health: hunger, thirst and cold wear it down; food and rest restore it */
    let dh = 0;
    if (p.food < 0.1) dh -= 0.14 * days;
    if (p.water < 0.04) dh -= 0.5 * days;
    if (p.warmth < 0.25) dh -= (0.25 - p.warmth) * (st === "baby" || st === "toddler" || st === "elder" ? 2.4 : 1.6) * days;
    if (p.sick > 0) dh -= (p.sick > 1 ? 0.22 : 0.02) * days;
    if (dh === 0 && p.food > 0.5 && p.water > 0.3) dh = (0.06 + (asleep ? 0.06 : 0)) * days;
    p.health = Math.max(0, Math.min(1 - p.injury * 0.5, p.health + dh));
    p.injury = Math.max(0, p.injury - 0.03 * days * (p.food > 0.4 ? 1 : 0.3));
    if (p.health <= 0) this.die(p, p.water < 0.04 ? "thirst" : p.food < 0.1 ? "hunger" : p.warmth < 0.25 ? "the cold" : p.sick > 1 ? "illness" : p.injury > 0.2 ? "injuries" : "illness");
  }
  /** How warmly someone is dressed right now (people only put on furs when it is cold). */
  clothesNow(p: Person): number {
    const T = this.tempC(p.x, p.y);
    return T < 6 ? p.clothes : T < 16 ? Math.min(1, p.clothes) : 0;
  }
  private carried(p: Person): void {
    const c = this.byId.get(p.carrier);
    if (!c || c.band !== p.band) { p.carrier = 0; return; }
    p.x = c.x; p.y = c.y; p.dir = c.dir; p.goal = Goal.Carried; p.anim = Anim.Idle;
    p.rest = Math.max(p.rest, 0.8);
    if (c.water > 0.3) p.water = Math.max(p.water, 0.9);
  }

  eatFromStore(p: Person, b: Band, want: number): number {
    const s = b.store, total = storeFood(s); if (total <= 0) return 0;
    const got = Math.min(want, total);
    /* eat what spoils first: meat and fish before roots and nuts */
    let left = got;
    for (const k of ["meat", "fish", "plant"] as const) { const t = Math.min(left, s[k]); s[k] -= t; left -= t; if (left <= 0) break; }
    p.food = Math.min(2.5, p.food + got);
    p.took = p.took * 0.98 + got * 0.02 * 40;
    return got;
  }

  /* ---------------- danger ---------------- */

  private danger(p: Person): void {
    const st = this.stage(p); if (st === "baby") return;
    const hs = this.herdsNear(p.x, p.y, 7);
    for (const h of hs) {
      if (h.sp !== Species.Wolf && h.sp !== Species.Bear) continue;
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      const scared = (1 - d / 7) * (h.sp === Species.Bear ? 1 : 0.5 + h.n * 0.1) * (st === "child" || st === "toddler" ? 1.4 : 1) * (1.2 - p.traits[0] * 0.6);
      p.fear = Math.max(p.fear, Math.min(1, scared));
      this.learnPlace(p, Place.Danger, h.x, h.y, h.n, h.id, 0, this.time, h.sp);
      const company = this.near(p.x, p.y, 5).filter(q => q !== p && this.age(q) >= 14).length;
      /* wolves try a lone or weak person only when they are hungry; bears go for anyone who gets too close */
      const weak = st === "child" || st === "toddler" || p.injury > 0.3 || st === "elder";
      const pAttack = h.sp === Species.Bear ? (d < 2.5 ? 0.012 : 0) : h.hunger > 0.75 && company === 0 && d < 4 ? (weak ? 0.004 : this.sun < 0.2 ? 0.0012 : 0.0004) * h.n : 0;
      if (pAttack > 0 && this.rng.chance(pAttack)) this.attacked(p, h);
      else if (p.fear > 0.45 + p.traits[0] * 0.35 && p.goal !== Goal.Flee) { abandon(this, p); decide(this, p, Goal.Flee); }
    }
  }
  private attacked(p: Person, h: Herd): void {
    this.stats.attacks++;
    const st = this.stage(p), armed = p.spear > 0.1 && this.age(p) >= 15;
    const sev = this.rng.range(0.15, 0.7) * (st === "child" || st === "toddler" ? 1.5 : 1) * (armed ? 0.6 : 1) * (h.sp === Species.Bear ? 1.3 : 1);
    p.injury = Math.min(1, p.injury + sev); p.health -= sev * 0.7; p.fear = 1;
    this.remember(p, Mem.Attacked, 0, -0.8, h.sp);
    /* the animal backs off after the attack, more so from someone fighting back */
    h.state = 2; h.timer = 12; const a = Math.atan2(h.y - p.y, h.x - p.x); h.tx = h.x + Math.cos(a) * 20; h.ty = h.y + Math.sin(a) * 20;
    if (h.sp === Species.Wolf) h.hunger = Math.max(0, h.hunger - 0.2);
    const what = h.sp === Species.Bear ? "A bear" : "Wolves";
    if (p.health <= 0) { this.die(p, h.sp === Species.Bear ? "a bear" : "wolves"); return; }
    this.event("attack", h.sp === Species.Bear ? Bubble.Fear : Bubble.Wolf, `${what} attacked ${p.name} of the ${this.band(p).name}. ${p.sex === "f" ? "She" : "He"} got away hurt.`, p.x, p.y, [p.id], p.band);
    abandon(this, p); decide(this, p, Goal.Flee);
  }

  /* ---------------- seeing ---------------- */

  private look(p: Person): void {
    const st = this.stage(p); if (st === "baby" || st === "toddler") return;
    const r = this.sun > 0.3 ? 13 : 6;
    for (const h of this.herdsNear(p.x, p.y, r)) {
      if (h.sp === Species.Wolf || h.sp === Species.Bear) continue;
      this.learnPlace(p, Place.Game, h.x, h.y, h.n, h.id, 0, this.time, h.sp);
    }
    for (const c of this.carcasses) if (c.meat > 2 && Math.hypot(c.x - p.x, c.y - p.y) < r) this.learnPlace(p, Place.Carcass, c.x, c.y, c.meat, c.id, 0, this.time, c.sp);
    for (const b of this.bands) {
      if (b.id === p.band || Math.hypot(b.x - p.x, b.y - p.y) > r + 6) continue;
      this.learnPlace(p, Place.Camp, b.x, b.y, 1, b.id, 0);
      const mine = this.band(p);
      if (!mine.met.has(b.id)) {
        mine.met.add(b.id); b.met.add(mine.id); this.stats.contacts++;
        const same = mine.culture === b.culture;
        this.event("contact", Bubble.Question, same ? `${p.name} of the ${mine.name} came upon the camp of the ${b.name}, kin from the same people.` : `${p.name} of the ${mine.name} came upon strangers: the ${b.name}, who speak ${this.cultures[b.culture].lang.name}.`, b.x, b.y, [p.id], mine.id);
      }
    }
    /* someone met for the first time is a stranger; how warm the first impression is depends on both */
    for (const q of this.near(p.x, p.y, 4)) {
      if (q === p || q.band === p.band || this.stage(q) === "baby") continue;
      const r0 = p.rel.get(q.id);
      if (!r0) {
        const same = this.band(q).culture === this.band(p).culture;
        const r = this.rel(p, q.id); r.op = (same ? 0.08 : -0.04) + (p.traits[5] - 0.5) * 0.2 + (p.traits[1] - 0.5) * 0.2; r.fam = 0.1;
        this.remember(p, Mem.Stranger, q.id, same ? 0.1 : 0.02);
      }
    }
  }

  /* ---------------- camps each step: fire and wood ---------------- */

  private camps(dt: number): void {
    for (const b of this.bands) {
      if (b.fire > 0) b.fire = Math.max(0, b.fire - dt / DAY_SECONDS * (this.sun < 0.2 ? 0.75 : 0.5));
      /* whoever is at camp feeds the fire from the woodpile, and someone who knows how relights it */
      if (b.fire < 0.55 && b.store.wood >= 1) {
        let tender: Person | null = null;
        for (const id of b.members) { const q = this.byId.get(id); if (q && q.knows & Know.Fire && this.age(q) >= 10 && q.goal !== Goal.Sleep && Math.hypot(q.x - b.x, q.y - b.y) < 4) { tender = q; break; } }
        if (tender) { b.store.wood -= 1; b.fire = Math.min(1, b.fire + 0.3); if (b.fire < 0.35) this.bubble(tender, Bubble.Fire, 2); }
      }
    }
  }

  /* ---------------- each day ---------------- */

  private daily(): void {
    for (const p of this.people.slice()) {
      if (!this.byId.has(p.id)) continue;
      const age = this.age(p), st = stageOf(age);
      /* childhood hunger is remembered in the body */
      if (age < 16) p.childHunger = p.childHunger * 0.97 + (p.food < 0.4 ? 0.03 : 0);
      p.prestige *= 0.99; p.gave *= 0.97; p.took *= 0.97;
      if (st === "adult" && !p.partner && age < 55) p.longing = Math.min(1, p.longing + 0.035 * (0.6 + p.traits[5] * 0.6));
      p.clothesWear = Math.max(0, p.clothesWear - (this.tempC(p.x, p.y) < 0 ? 0.012 : 0.005));
      if (p.clothesWear <= 0 && p.clothes > 0) { p.clothes--; p.clothesWear = 0.6; this.dirty.add(p.id); }
      /* forget old trivial memories; strong ones last */
      p.mem = p.mem.filter(m => Math.abs(m.v) * Math.exp(-(this.time - m.t) / (YEAR * 0.8)) > 0.04);
      p.places = p.places.filter(pl => !((pl.k === Place.Game || pl.k === Place.Carcass || pl.k === Place.Danger) && this.time - pl.t > DAY_SECONDS * 5));
      this.illness(p, age, st);
      if (!this.byId.has(p.id)) continue;
      this.fertility(p, age);
      this.refreshLook(p, age, st);
    }
    this.couplesCheck();
    for (const b of this.bands.slice()) this.bandDay(b);
    /* carcasses spoil, and scavengers find them */
    for (const c of this.carcasses) { const T = this.tempC(c.x, c.y); c.meat *= T > 15 ? 0.6 : T > 5 ? 0.75 : T > -5 ? 0.92 : 0.98; for (const h of this.herdsNear(c.x, c.y, 20)) if (h.sp === Species.Wolf || h.sp === Species.Bear) { const eat = Math.min(c.meat, 6 * h.n); c.meat -= eat; h.hunger = Math.max(0, h.hunger - 0.3); } }
    this.carcasses = this.carcasses.filter(c => c.meat > 1);
    this.stats.maxPop = Math.max(this.stats.maxPop, this.people.length);
  }

  /**
    Illness and the ordinary dangers of life. The chance of falling seriously ill each day
    follows the age pattern of forager life (high for infants, low for young adults,
    rising steeply in old age), raised by hunger and cold. About a third of serious
    illnesses turn deadly, fewer when someone looks after the sick person.
  */
  private illness(p: Person, age: number, st: Stage): void {
    const rng = this.rng;
    if (p.sick > 0) {
      const tended = this.near(p.x, p.y, 2.5).some(q => q !== p && q.goal === Goal.Tend);
      if (p.sick > 1) { if (tended && rng.chance(0.3)) p.sick = 0.8; }
      else { p.sick = Math.max(0, p.sick - (0.2 + (p.food > 0.6 ? 0.1 : 0) + (tended ? 0.1 : 0))); }
      return;
    }
    const hazard = 0.15 * Math.exp(-0.9 * age) + 0.006 + 0.00011 * Math.exp(0.088 * age);
    let stress = 1 + (p.food < 0.4 ? 1.2 : 0) + (p.warmth < 0.4 ? 0.8 : 0);
    /* the sun at home favors the skin tone suited to it, very slowly, through children's health */
    if (age < 5) { const uv = this.climateAt(p.x, p.y).uv; stress += Math.pow(Math.abs(p.looks.mel - idealMel(uv)), 2) * 0.6; }
    if (rng.chance(hazard * stress * 3 / DAYS_PER_YEAR)) {
      const deadly = rng.chance(0.33 + (st === "elder" ? 0.2 : 0));
      p.sick = deadly ? 1.5 : 0.8;
      if (st !== "baby" && st !== "toddler") abandon(this, p);
    }
  }

  private fertility(p: Person, age: number): void {
    if (p.sex !== "f") return;
    if (p.pregnantBy) {
      if (this.time >= p.due) this.birth(p);
      return;
    }
    const dad = this.byId.get(p.partner);
    if (!dad || dad.band !== p.band || age < 17 || age > 46) return;
    const peak = age < 20 ? (age - 16) / 4 : age < 31 ? 1 : age < 40 ? 1 - (age - 31) * 0.06 : 0.45 - (age - 40) * 0.07;
    const youngest = p.children.map(id => this.byId.get(id)).filter((c): c is Person => !!c).reduce((m, c) => Math.min(m, this.age(c)), 99);
    const nursing = youngest < 1.6 ? 0.12 : youngest < 2.6 ? 0.45 : 1;
    const fed = Math.max(0, Math.min(1, (p.food - 0.4) / 0.9)) * Math.max(0, Math.min(1, p.health * 1.2 - 0.1));
    if (this.rng.chance(0.016 * Math.max(0, peak) * nursing * fed)) { p.pregnantBy = dad.id; p.fatherGenome = dad.genome; p.due = this.time + YEAR * 0.75; this.dirty.add(p.id); }
  }

  private birth(mom: Person): void {
    const dad = this.byId.get(mom.pregnantBy) ?? this.archive.get(mom.pregnantBy);
    const dadGenome = mom.fatherGenome ?? mom.genome;
    mom.pregnantBy = 0; mom.due = 0; mom.fatherGenome = null;
    const b = this.band(mom), twins = this.rng.chance(0.012) ? 2 : 1;
    const born: Person[] = [];
    for (let k = 0; k < twins; k++) {
      const kid = this.makePerson(b, this.rng.chance(0.512) ? "m" : "f", this.time, inherit(mom.genome, dadGenome, this.rng), mom.id, dad?.id ?? 0, 0);
      kid.food = 1.2; kid.clothes = 0; kid.spear = 0; kid.prestige = 0; kid.x = mom.x; kid.y = mom.y;
      for (const id of b.members) { const q = this.byId.get(id); if (!q || q === kid) continue; const r = this.rel(kid, id); r.fam = 0.5; r.op = this.kin(kid, q, 1) ? 0.6 : 0.15; const r2 = this.rel(q, kid.id); r2.fam = 0.5; r2.op = Math.max(r2.op, this.kin(kid, q, 1) ? 0.7 : 0.1); }
      born.push(kid);
    }
    this.stats.births += born.length;
    mom.baby = born[0].id;
    if (born[1]) born[1].carrier = mom.id;
    this.remember(mom, Mem.Birth, born[0].id, 0.9);
    if (dad && this.byId.has(dad.id)) this.remember(this.byId.get(dad.id)!, Mem.Birth, born[0].id, 0.8);
    const names = born.map(k => k.name).join(" and ");
    this.event("birth", Bubble.Baby, `${mom.name}${dad ? ` and ${dad.name}` : ""} of the ${b.name} had ${born.length > 1 ? "twins" : born[0].sex === "f" ? "a daughter" : "a son"}, ${names}.`, mom.x, mom.y, [...born.map(k => k.id), mom.id], b.id);
    relayout(this, b);
    /* childbirth is dangerous */
    if (this.rng.chance(0.008 + (this.age(mom) > 38 ? 0.01 : 0) + (mom.health < 0.5 ? 0.02 : 0))) this.die(mom, "childbirth");
  }

  die(p: Person, cause: string): void {
    if (!this.byId.has(p.id)) return;
    const b = this.bandById.get(p.band), age = this.age(p);
    this.byId.delete(p.id);
    this.people = this.people.filter(q => q !== p);
    if (b) b.members = b.members.filter(id => id !== p.id);
    this.archive.set(p.id, { id: p.id, name: p.name, sex: p.sex, born: p.born, died: this.time, cause, mother: p.mother, father: p.father, partner: p.partner, children: p.children.slice(), band: p.band, mel: p.looks.mel });
    this.stats.deaths++; this.stats.causes.set(cause, (this.stats.causes.get(cause) ?? 0) + 1);
    /* the family grieves */
    for (const id of [p.partner, p.mother, p.father, ...p.children]) { const q = this.byId.get(id); if (q) this.remember(q, Mem.Death, p.id, id === p.partner ? -0.9 : -0.8); }
    for (const [id, r] of p.rel) { const q = this.byId.get(id); if (q && r.op > 0.4 && !q.mem.some(m => m.k === Mem.Death && m.who === p.id)) this.remember(q, Mem.Death, p.id, -0.4 * r.op); }
    const partner = this.byId.get(p.partner); if (partner) partner.partner = 0;
    /* an infant goes to someone who can nurse it, or to close kin */
    if (p.baby) { const baby = this.byId.get(p.baby); if (baby) this.fosterBaby(baby, b); }
    for (const q of this.people) if (q.carrier === p.id) this.fosterBaby(q, b);
    for (const cid of p.children) { const c = this.byId.get(cid); if (c && this.age(c) < 14 && !this.byId.has(c.mother === p.id ? c.father : c.mother)) c.guardian = this.guardianFor(c)?.id ?? 0; }
    if (this.selected === p.id) this.selected = 0;
    const word = age < 2 ? "baby" : age < 12 ? "child" : "";
    const what = cause === "old age" ? "died of old age" : cause === "childbirth" ? "died in childbirth" : cause === "illness" ? (age < 5 ? "died of a fever" : "died of an illness") : cause === "wolves" || cause === "a bear" ? `was killed by ${cause}` : cause.startsWith("hunting") ? `was killed ${cause}` : `died of ${cause}`;
    const ageText = age < 1 ? `${Math.max(1, Math.round(age * 12))} months old` : `aged ${Math.floor(age)}`;
    this.event("death", Bubble.Sad, `${p.name} of the ${b?.name ?? "wilds"} ${what}${word ? `, a ${word} ` : ", "}${ageText}.`, p.x, p.y, [p.id], p.band);
    if (b) { relayout(this, b); if (b.members.length === 0) this.endBand(b, "is no more"); }
  }
  private fosterBaby(baby: Person, b: Band | undefined): void {
    baby.carrier = 0;
    if (!b) return;
    const ms = b.members.map(id => this.byId.get(id)).filter((q): q is Person => !!q);
    const nurse = ms.filter(q => q.sex === "f" && q.baby && q.baby !== baby.id && this.age(q) < 46).sort((a, c) => c.traits[1] - a.traits[1])[0];
    const kin = ms.filter(q => this.age(q) >= 14 && this.kin(baby, q, 2) && !q.baby).sort((a, c) => (c.sex === "f" ? 1 : 0) - (a.sex === "f" ? 1 : 0))[0];
    const carer = nurse ?? kin ?? ms.filter(q => q.sex === "f" && this.age(q) >= 16 && !q.baby).sort((a, c) => c.traits[1] - a.traits[1])[0];
    if (carer) { baby.carrier = carer.id; baby.guardian = carer.id; if (!carer.baby) carer.baby = baby.id; }
  }
  guardianFor(c: Person): Person | null {
    const b = this.band(c), ms = b.members.map(id => this.byId.get(id)).filter((q): q is Person => !!q && q !== c && this.age(q) >= 16);
    ms.sort((a, d) => (this.kin(c, d, 2) ? 1 : 0) - (this.kin(c, a, 2) ? 1 : 0) || d.traits[1] - a.traits[1]);
    return ms[0] ?? null;
  }
  endBand(b: Band, how: string): void {
    this.bands = this.bands.filter(o => o !== b); this.bandById.delete(b.id);
    for (const o of this.bands) o.met.delete(b.id);
    this.event("band-end", Bubble.Sad, `The ${b.name} ${how}.`, b.x, b.y, [], b.id);
  }

  private couplesCheck(): void {
    for (const p of this.people) {
      if (p.sex !== "f" || !p.partner) continue;
      const m = this.byId.get(p.partner); if (!m) { p.partner = 0; continue; }
      if (this.op(p, m.id) < -0.25 && this.op(m, p.id) < 0.1) {
        p.partner = 0; m.partner = 0; this.stats.partings++;
        this.remember(p, Mem.Parted, m.id, -0.5); this.remember(m, Mem.Parted, p.id, -0.5);
        this.event("parted", Bubble.Angry, `${p.name} and ${m.name} of the ${this.band(p).name} parted ways after too many quarrels.`, p.x, p.y, [p.id, m.id], p.band);
        relayout(this, this.band(p));
      }
    }
  }

  /* ---------------- the band's day: food keeps or spoils, and the band weighs moving or splitting ---------------- */

  private bandDay(b: Band): void {
    if (!this.bandById.has(b.id)) return;
    const ms = b.members.map(id => this.byId.get(id)).filter((q): q is Person => !!q);
    if (!ms.length) { this.endBand(b, "is no more"); return; }
    b.appetite = ms.reduce((a, q) => a + FOOD_DAY[this.stage(q)], 0);
    const T = this.tempC(b.x, b.y), spoil = T > 20 ? 0.35 : T > 10 ? 0.22 : T > 0 ? 0.1 : T > -8 ? 0.03 : 0.01;
    b.store.meat *= 1 - spoil; b.store.fish *= 1 - spoil; b.store.plant *= 0.96;
    const adults = ms.filter(q => this.age(q) >= 16);
    /* respect: who others listen to */
    let best: Person | null = null; for (const q of adults) if (!best || q.prestige > best.prestige) best = q;
    if (best && best.id !== b.respected && best.prestige > 0.8 && adults.length >= 4) {
      const had = b.respected; b.respected = best.id;
      if (had) this.event("respect", Bubble.Star, `${best.name} has become the one the ${b.name} listen to most.`, best.x, best.y, [best.id], b.id);
    } else if (!b.respected && best) b.respected = best.id;
    /* fairness: people notice who takes without giving */
    for (const q of adults) {
      if (q.baby || q.sick > 0 || q.injury > 0.3 || this.age(q) > 55) continue;
      if (q.took > 0.6 && q.gave < q.took * 0.25) for (const o of adults) if (o !== q && o.gave > 0.8 && this.rng.chance(0.3 * (1 - o.traits[1] * 0.6))) { this.rel(o, q.id).op -= 0.04; if (this.rng.chance(0.2)) this.remember(o, Mem.Freeloader, q.id, -0.2); }
      if (q.gave > q.took * 1.5 && q.gave > 0.8) q.prestige += 0.03;
    }
    if (b.moving) return;
    this.weighMove(b, ms, adults);
    if (!b.moving) this.weighSplit(b, ms, adults);
    if (this.bandById.has(b.id) && b.members.length <= 4) this.weighJoin(b, ms);
  }

  /**
    Whether to move camp. Each adult wants to move as much as food near camp has run out,
    their trips have come back light, the store is empty or the place has turned dangerous,
    and only if they know somewhere better. The band goes when those who want to go carry
    enough weight (respect, and the ambitious are louder); it goes to the place the most
    listened-to of them knows.
  */
  private weighMove(b: Band, ms: Person[], adults: Person[]): void {
    if (this.time - b.movedAt < DAY_SECONDS * 3 || adults.length === 0) return;
    const short = Math.max(0, 1 - storeDays(b) / 2);
    let wFor = 0, wAll = 0, lead: Person | null = null, leadW = -1, dest: [number, number] | null = null;
    for (const q of adults) {
      const here = siteValue(q, b.x, b.y, this.time);
      let bestV = here, at: [number, number] | null = null;
      for (const pl of q.places) {
        if (pl.k !== Place.Site && pl.k !== Place.Plants && pl.k !== Place.Fish && pl.k !== Place.Game) continue;
        const d = Math.hypot(pl.x - b.x, pl.y - b.y); if (d < 22 || d > 160) continue;
        const v = siteValue(q, pl.x, pl.y, this.time) * (1 - d / 400) + (pl.k === Place.Site ? pl.q : 0);
        if (v > bestV) { bestV = v; at = [pl.x, pl.y]; }
      }
      /* reasons to leave, and the pull of somewhere better */
      const poor = Math.max(0, 1 - q.tripYield / 2.4), danger = q.mem.some(m => m.k === Mem.Attacked && this.time - m.t < DAY_SECONDS * 4) ? 0.3 : 0;
      const push = 0.4 * poor + 0.4 * short + danger, pull = at ? Math.min(1, (bestV - here) / Math.max(6, here)) : 0;
      q.moveWish = Math.min(1, q.moveWish * 0.4 + 0.6 * (push * 0.7 + pull * 0.6) * (0.75 + q.traits[4] * 0.35));
      const wt = 0.5 + q.prestige + q.traits[3] * 0.4;
      wAll += wt;
      if (q.moveWish > 0.45 && at) { wFor += wt; if (wt > leadW) { leadW = wt; lead = q; dest = at; } }
    }
    if (!lead || !dest || wFor / wAll < 0.5) return;
    const spot = this.campSpot(dest[0], dest[1], 10); if (!spot) return;
    const route = this.walker.route(b.x, b.y, spot[0], spot[1], 40000);
    if (!route && Math.hypot(spot[0] - b.x, spot[1] - b.y) > 60) return;
    const name = placeName(this.cultures[b.culture].lang, this.rng);
    b.moving = { x: spot[0], y: spot[1], by: lead.id, since: this.time, name, route };
    this.stats.moves++;
    lead.prestige += 0.15;
    for (const q of ms) { abandon(this, q); this.remember(q, Mem.Moved, lead.id, 0.1); }
    const dir = compass(spot[0] - b.x, spot[1] - b.y), why = storeDays(b) < 1 ? "the food around camp had run out" : "the hunting and gathering had grown poor";
    this.event("move", Bubble.Move, `The ${b.name} packed up and set off ${dir}, because ${why}. ${lead.name} knew a better place, ${name}.`, b.x, b.y, [lead.id], b.id);
  }

  /** Called by the walkers when the last of a moving band has arrived, or long enough has passed. */
  arrive(b: Band): void {
    if (!b.moving) return;
    const m = b.moving; b.moving = null; b.siteName = m.name;
    this.settleCamp(b, m.x, m.y);
    for (const id of b.members) { const q = this.byId.get(id); if (q) { q.moveWish = 0; q.tripYield = 2.4; this.learnSurroundings(q, 28); } }
  }

  /**
    Splitting. A band that has grown big strains what the land around one camp can give,
    and quarrels pile up. The adult who most wants out (crowding, bad blood, or the
    ambition to lead their own) leaves with their household and anyone who would rather
    follow them, to a place they know.
  */
  private weighSplit(b: Band, ms: Person[], adults: Person[]): void {
    if (ms.length < 16 || this.time - b.founded < DAY_SECONDS * 20) return;
    const crowd = Math.max(0, Math.min(1, (ms.length - 28) / 18)), short = Math.max(0, 1 - storeDays(b) / 2);
    let founder: Person | null = null, fw = 0;
    for (const q of adults) {
      if (this.age(q) < 20 || this.age(q) > 58) continue;
      let bad = 0, n = 0; for (const o of adults) if (o !== q) { bad += Math.max(0, -this.op(q, o.id)); n++; }
      const tension = n ? bad / n * 3 : 0, low = q.traits[3] * Math.max(0, 1 - q.prestige);
      q.leaveWish = Math.min(1, crowd * 0.55 + short * crowd * 0.3 + tension * 0.5 + low * 0.3 * crowd + (b.respected && this.op(q, b.respected) < -0.3 ? 0.3 : 0));
      if (q.leaveWish > fw) { fw = q.leaveWish; founder = q; }
    }
    if (!founder || fw < 0.58) return;
    let at: [number, number] | null = null, bv = 0;
    for (const pl of founder.places) {
      const d = Math.hypot(pl.x - b.x, pl.y - b.y); if (d < 26 || d > 150 || (pl.k !== Place.Site && pl.k !== Place.Plants && pl.k !== Place.Fish)) continue;
      if (this.bands.some(o => Math.hypot(o.x - pl.x, o.y - pl.y) < 20)) continue;
      const v = siteValue(founder, pl.x, pl.y, this.time) + (pl.k === Place.Site ? pl.q : 0); if (v > bv) { bv = v; at = [pl.x, pl.y]; }
    }
    if (!at) { founder.moveWish = Math.max(founder.moveWish, 0.5); return; }
    const spot = this.campSpot(at[0], at[1], 10); if (!spot) return;
    /* who goes: the founder's household, and adults who like the founder more than the band and also want out */
    const goers = new Set<number>();
    const addHome = (q: Person) => { const h = homeOf(q, this.byId, this.time); for (const o of ms) if (homeOf(o, this.byId, this.time) === h || o.carrier === q.id) goers.add(o.id); goers.add(q.id); };
    addHome(founder);
    for (const q of adults) {
      if (goers.has(q.id) || goers.size > ms.length * 0.5) continue;
      let avg = 0; for (const o of adults) if (o !== q) avg += this.op(q, o.id); avg /= Math.max(1, adults.length - 1);
      if (this.op(q, founder.id) > avg + 0.08 && q.leaveWish > 0.3) addHome(q);
    }
    if (goers.size < 5 || ms.length - goers.size < 5) return;
    const nb = this.newBand(spot[0], spot[1], b.culture, b.id);
    nb.store.wood = 2; nb.respected = founder.id;
    const share = goers.size / ms.length;
    for (const k of ["plant", "meat", "fish", "hides"] as const) { const t = b.store[k] * share; b.store[k] -= t; nb.store[k] += t; }
    for (const id of goers) { const q = this.byId.get(id)!; b.members = b.members.filter(x => x !== id); q.band = nb.id; nb.members.push(id); abandon(this, q); this.remember(q, Mem.Split, founder.id, 0.2); this.dirty.add(id); }
    nb.met.add(b.id); b.met.add(nb.id);
    nb.moving = { x: spot[0], y: spot[1], by: founder.id, since: this.time, name: placeName(this.cultures[b.culture].lang, this.rng), route: this.walker.route(b.x, b.y, spot[0], spot[1], 40000) };
    nb.x = b.x; nb.y = b.y;
    founder.prestige += 0.4;
    this.stats.splits++;
    this.event("split", Bubble.Move, `The ${b.name} had grown too many for one fire. ${founder.name} led ${goers.size} of them away ${compass(spot[0] - b.x, spot[1] - b.y)} to start a band of their own, the ${nb.name}.`, b.x, b.y, [founder.id], nb.id);
    this.layoutHomes(b);
  }

  /** A band whittled down to a handful seeks out kin or a band it knows, if any. */
  private weighJoin(b: Band, ms: Person[]): void {
    const known = this.bands.filter(o => o !== b && ms.some(q => q.places.some(pl => pl.k === Place.Camp && pl.ref === o.id)));
    if (!known.length) return;
    const pick = known.sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
    for (const q of ms) { this.moveTo(q, pick); }
    this.stats.merges++;
    this.event("merge", Bubble.Home, `The last ${ms.length} of the ${b.name} went to live with the ${pick.name}.`, b.x, b.y, ms.map(q => q.id), pick.id);
    if (this.bandById.has(b.id)) this.endBand(b, "joined another band");
    this.layoutHomes(pick);
  }

  /* ---------------- what the renderer and the interface see ---------------- */

  private refreshLook(p: Person, age: number, st: Stage): void {
    const key = `${st}|${this.wearOf(p, st)}|${Math.round(hairAt(p.looks, age).gray * 6)}|${p.band}|${p.style}`;
    if (key !== p.lookKey) { p.lookKey = key; this.dirty.add(p.id); }
  }
  wearOf(p: Person, st: Stage): Wear {
    if (st === "baby") return "wrap";
    const c = this.culture(p), lvl = this.clothesNow(p);
    if (lvl >= 2) return "furs";
    if (lvl >= 1) return st === "toddler" ? "wrap" : p.sex === "f" ? c.mildF : c.mildM;
    return st === "toddler" || st === "child" ? "loin" : c.hotWear;
  }
  look_(p: Person): Look {
    const age = this.age(p), st = stageOf(age), c = this.culture(p), h = hairAt(p.looks, age);
    const cm = heightCm(p.looks, p.sex, p.childHunger);
    const bald = p.sex === "m" && p.looks.bald > 0.6 && age > 34 + (1 - p.looks.bald) * 30;
    const young = st === "baby" || st === "toddler" || st === "child";
    const style = young ? (p.looks.curl > 0.62 ? (p.sex === "f" ? "puffs" : "crop") : p.sex === "f" && (p.style === "braids" || p.style === "long") && st === "child" ? p.style : "short") : bald ? "bald" : p.style;
    const dye = c.dyes[p.id % c.dyes.length];
    return {
      id: p.id, name: p.name, sex: p.sex, stage: st, band: p.band,
      skin: p.looks.mel, hair: h.hex, gray: h.gray, style, beard: p.sex === "m" && age >= 19 && p.looks.beard > 0.42, eye: p.looks.eye,
      wear: this.wearOf(p, st), top: (p.id % 3 === 0) ? dye : c.hide, bottom: c.hide, beads: (p.id * 7919 % 100) / 100 < c.beads,
      tall: st === "adult" || st === "elder" ? (cm - (p.sex === "m" ? 166 : 155) > 6 ? 1 : cm - (p.sex === "m" ? 166 : 155) < -6 ? -1 : 0) : 0,
    };
  }
  /** Looks for everyone whose appearance changed since last asked. */
  takeLooks(): Look[] {
    const out: Look[] = [];
    for (const id of this.dirty) { const p = this.byId.get(id); if (p) out.push(this.look_(p)); }
    this.dirty.clear();
    return out;
  }
  allLooks(): Look[] { this.dirty.clear(); return this.people.map(p => this.look_(p)); }

  snapshot(): Float32Array {
    const out = new Float32Array(this.people.length * PERSON_STRIDE);
    let k = 0;
    for (const p of this.people) {
      const o = k * PERSON_STRIDE;
      let flags = 0;
      if (p.carryAmt > 0) flags |= p.carryKind === 4 ? PFlag.Wood : p.carryKind === 2 ? PFlag.Meat | PFlag.Carrying : PFlag.Carrying;
      if (p.spear > 0.1 && (p.goal === Goal.Hunt || p.party)) flags |= PFlag.Spear;
      if (p.baby && this.byId.get(p.baby)?.carrier === p.id) flags |= PFlag.Sling;
      if (p.injury > 0.25) flags |= PFlag.Injured;
      if (p.mood < -0.25) flags |= PFlag.Sad; else if (p.mood > 0.45) flags |= PFlag.Happy;
      if (p.id === this.selected) flags |= PFlag.Selected;
      if (p.pregnantBy && this.time > p.due - YEAR * 0.45) flags |= PFlag.Pregnant;
      out[o] = p.id; out[o + 1] = p.x; out[o + 2] = p.y; out[o + 3] = p.dir; out[o + 4] = p.anim; out[o + 5] = flags;
      out[o + 6] = this.time < p.bubbleUntil ? p.bubble : 0; out[o + 7] = p.mood; out[o + 8] = p.carrier;
      k++;
    }
    return out;
  }
  campSnaps(): CampSnap[] {
    return this.bands.map(b => {
      const sh: number[] = []; for (const [, [x, y]] of b.homes) sh.push(x, y);
      return { id: b.id, name: b.name, x: b.x, y: b.y, color: b.color, pop: b.members.length, fire: b.fire, shelters: sh, shelter: this.cultures[b.culture].shelter, food: Math.round(storeFood(b.store)) };
    });
  }

  /* ---------------- describing people ---------------- */

  describeLooks(p: Person): string {
    const age = this.age(p), cm = heightCm(p.looks, p.sex, p.childHunger);
    const hair = hairWord(p.looks, age), curl = curlWord(p.looks.curl);
    const parts = [`${skinWord(p.looks.mel)} skin`, `${curl} ${hair} hair`, `${p.looks.eyeName} eyes`];
    return age >= 16 ? `${cap(parts.join(", "))}. ${cap(heightWord(cm, p.sex))} and ${buildWord(p.looks.build)}.` : `${cap(parts.join(", "))}.`;
  }
}

/* shelters are re-laid when households change */
function relayout(s: Society, b: Band): void { if (s.bandById.has(b.id)) s.layoutHomes(b); }
export function compass(dx: number, dy: number): string {
  const a = Math.atan2(dy, dx) * 180 / Math.PI, d = ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"];
  return d[Math.round(((a + 360) % 360) / 45) % 8];
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export { SPECIES_NAMES };
