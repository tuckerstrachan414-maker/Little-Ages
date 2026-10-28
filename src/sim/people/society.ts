import { Biome, Flag, Species, DAY_SECONDS, DAYS_PER_YEAR, SPECIES_NAMES, type WorldData } from "../../shared/types.ts";
import { Rng } from "../../shared/rng.ts";
import { Anim, Bubble, PERSON_STRIDE, PFlag, type CampSnap, type ChronicleEvent, type Look, type Stage, type Wear, type WorkSnap } from "../../shared/people.ts";
import { PLANT_UNITS, type Ecology } from "../ecology.ts";
import type { Wildlife, Herd } from "../wildlife.ts";
import { ancestryFor, founderGenome, inherit, looksOf, temperament, hairAt, idealMel, skinWord, hairWord, curlWord, heightCm, heightWord, buildWord, skinHex, type Ancestry, type Genome } from "./genetics.ts";
import { makeCulture, pickStyle, type Culture } from "./culture.ts";
import { personName, placeName } from "./language.ts";
import { Walker } from "./walk.ts";
import { type Band, homeOf, storeDays, storeFood, campFood, siteValue, estimate, newDay, noFood } from "./band.ts";
import { Goal, Mem, Place, St, YEAR, ageOf, stageOf, type Archived, type KnownPlace, type Person, type Rel } from "./person.ts";
import { decide, isInterruptible } from "./mind.ts";
import { doStep, abandon } from "./doing.ts";
import { weigh } from "./chronicle.ts";
import { eat, household, appetiteOf, reconcileHearths, carryHearth, spoil, spoilHearths, forgetDebts, shareRound } from "./sharing.ts";
import { type Feud, feudDay, feudsOnDeath, feudLeave, feudOf, grievance, handDown, maybeFight, sideOf, fadeGrudges } from "./feuds.ts";
import { chooseLeaders } from "./leaders.ts";
import { IDEA_COUNT, Idea, type IdeaLog, newIdeaLog, founderKnow, growUp, ideasDay, countBand, watch, bandKnows } from "./ideas.ts";
import { type Work, worksDay, lookAtWorks, plotHope } from "./works.ts";

/*
  Everyone alive, and the bands they live in. Each step every person's body changes (they
  get hungry, thirsty, tired, cold or lonely), they notice what is around them, and they
  either carry on with what they are doing or decide what to do next. Once a day the life
  cycle turns: children are conceived and born, people age, fall ill, recover or die, and
  each band weighs whether to stay where it is, move on, or split.
*/

export interface StartOptions { start: "bands" | "cradle"; bands: number; }
export interface Carcass { id: number; x: number; y: number; sp: number; meat: number; hides: number; t: number; by: number; mocked?: boolean; }

/** What a good place of each kind is worth, to compare a berry patch with a herd. */
const PLACE_TYPICAL = [1, 4, 4, 10, 2, 8, 6, 1, 3];
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
  nextId = 1; nextEvent = 1; private lastDay = -1; private lastNoon = -1;
  events: ChronicleEvent[] = [];
  fresh: ChronicleEvent[] = [];
  /** how many events of each kind there have been, so rare ones weigh more */
  seen = new Map<string, number>();
  /** looks that changed since the renderer last asked */
  dirty = new Set<number>();
  stats = { births: 0, deaths: 0, causes: new Map<string, number>(), couples: 0, partings: 0, moves: 0, splits: 0, merges: 0, kills: new Array(6).fill(0) as number[], food: { plant: 0, meat: 0, fish: 0, small: 0, weir: 0, crop: 0, dried: 0 }, contacts: 0, attacks: 0, learned: 0, maxPop: 0,
    /* sharing, feuds and leaders: food put in the pot and kept, asks and their answers, feuds begun and ended */
    social: { eaten: 0, shared: 0, kept: 0, rounds: 0, family: 0, asks: 0, given: 0, refused: 0, repaid: 0, feuds: 0, peace: 0, cooled: 0, fights: 0, inherited: 0, driven: 0, leaders: 0, contests: 0, mocked: 0, gifts: 0, leftFor: 0, factionSplits: 0 },
    /* ideas worked out, lost by a band, and passed on by each way; fires gone out, relit by a fire-maker, and fetched from another band */
    ideas: { found: 0, lost: 0, child: 0, watch: 0, shown: 0, told: 0, seen: 0 },
    fire: { out: 0, kindled: 0, embers: 0 } };
  /** feuds still burning, between two people and the families behind them */
  feuds: Feud[] = [];
  nextFeud = 1;
  /** pairs of bands that have exchanged gifts */
  giftPairs = new Set<string>();
  /** the world's record of every idea, and the weirs and plots people have made */
  ideas: IdeaLog[] = [];
  works: Work[] = [];
  /** changes whenever a weir or plot is made, ripens or goes, for the renderer */
  worksVersion = 0;
  /** bands that have brought in a harvest of their own sowing */
  harvested = new Set<number>();
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
    /* what every people already knew when the story starts */
    this.ideas = newIdeaLog(this);
    for (const b of this.bands) countBand(this, b);
    for (let i = 0; i < IDEA_COUNT; i++) { this.ideas[i].knowers = this.bands.reduce((n, b) => n + b.can[i], 0); this.ideas[i].bands = this.bands.filter(b => b.can[i]).length; }
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
  /** Whether there is a walk from a to b this season, remembered by camp-sized squares so asking again is cheap. */
  walkable(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.walker.reach(ax, ay, bx, by)) return false;
    if (this.walkSeason !== this.season) { this.walkCache.clear(); this.walkSeason = this.season; }
    const key = `${(ax / 4) | 0},${(ay / 4) | 0},${(bx / 4) | 0},${(by / 4) | 0}`;
    let ok = this.walkCache.get(key);
    if (ok === undefined) { ok = this.walker.route(ax, ay, bx, by, 40000) !== null; this.walkCache.set(key, ok); if (this.walkCache.size > 4000) this.walkCache.clear(); }
    return ok;
  }
  private walkCache = new Map<string, boolean>(); private walkSeason = -1;
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
  rel(p: Person, id: number): Rel { let r = p.rel.get(id); if (!r) { r = { op: 0, fam: 0, court: 0, seen: this.time, owe: 0, grudge: 0 }; p.rel.set(id, r); } return r; }
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
  campSpot(x: number, y: number, r: number, from?: [number, number]): [number, number] | null {
    let best: [number, number] | null = null, bs = -1;
    for (let k = 0; k < 60; k++) {
      const tx = Math.round(x + (this.rng.next() - 0.5) * 2 * r), ty = Math.round(y + (this.rng.next() - 0.5) * 2 * r);
      if (!this.roomy(tx, ty) || from && !this.walker.reach(from[0], from[1], tx + 0.5, ty + 0.5)) continue;
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
    /* a people is a few bands of the same tongue living near enough to visit and marry */
    const homes: { x: number; y: number; bands: number }[] = [];
    if (this.start.start === "cradle") {
      /* one homeland: the best warm, well-watered spot, with every band of the one people around it */
      const home = cands.find(c => this.climateAt(c.x, c.y).annual > 12) ?? cands[0];
      homes.push({ ...home, bands: n });
    } else {
      /* scattered: peoples as far apart as good land allows, on different shores and continents */
      const peoples = Math.max(1, Math.ceil(n / 2));
      const top = cands.slice(0, Math.max(60, Math.floor(cands.length * 0.6)));
      homes.push({ ...top[0], bands: 0 });
      while (homes.length < peoples && homes.length < top.length) {
        let best = top[0], bv = -1;
        for (const c of top) { let md = 1e9; for (const o of homes) md = Math.min(md, Math.hypot(c.x - o.x, (c.y - o.y) * 1.3)); const v = Math.pow(c.s, 0.6) * Math.min(md, w.w / 3); if (v > bv) { bv = v; best = c; } }
        if (bv <= 0) break; homes.push({ ...best, bands: 0 });
      }
      for (let k = 0; k < n; k++) homes[k % homes.length].bands++;
    }
    homes.forEach((home, h) => {
      const cult = h;
      this.cultures[cult] = makeCulture(cult, seed);
      const anc = this.ancestryAt(home.x, home.y);
      const sites: { x: number; y: number }[] = [home];
      for (const c of cands) {
        if (sites.length >= home.bands) break;
        const d = Math.hypot(c.x - home.x, c.y - home.y);
        if (d > (home.bands > 3 ? 110 : 60) || this.bands.some(b => Math.hypot(b.x - c.x, b.y - c.y) < 18) || sites.some(o => Math.hypot(o.x - c.x, o.y - c.y) < 18)) continue;
        if (!this.walker.reach(home.x, home.y, c.x, c.y)) continue;
        sites.push(c);
      }
      for (const site of sites) {
        const spot = this.campSpot(site.x, site.y, 6) ?? [site.x + 0.5, site.y + 0.5];
        /* richer land feeds a bigger band, and a hard winter keeps one small */
        const harsh = Math.max(0, Math.min(1, (-this.climateAt(spot[0], spot[1]).winter - 2) / 20));
        const size = Math.round(14 + Math.min(1, this.foodAround(spot[0], spot[1])) * 14 - harsh * 5 + rng.range(-3, 3));
        this.foundBand(spot[0], spot[1], cult, anc, size);
      }
      /* the bands of a people know each other and where they camp */
      const mine = this.bands.filter(b => b.culture === cult);
      for (const a of mine) for (const b of mine) if (a !== b) { a.met.add(b.id); for (const id of a.members) { const p = this.byId.get(id)!; if (this.age(p) >= 10) this.learnPlace(p, Place.Camp, b.x, b.y, 1, b.id, 0); } }
    });
  }
  private ancestryAt(x: number, y: number): Ancestry {
    const c = this.climateAt(x, y);
    return ancestryFor(c.uv, Math.max(0, Math.min(1, (6 - c.winter) / 30)), Math.max(0, Math.min(1, (c.summer - 14) / 20)), this.rng);
  }

  newBand(x: number, y: number, culture: number, parent: number): Band {
    const id = this.bands.length ? Math.max(...this.bands.map(b => b.id)) + 1 : 1;
    const name = placeName(this.cultures[culture].lang, this.rng);
    const b: Band = { id, name, culture, color: BAND_COLORS[(id - 1) % BAND_COLORS.length], x, y, fire: 0.8, store: { ...noFood(), wood: 2, hides: 0 }, hearths: new Map(),
      members: [], founded: this.time, movedAt: this.time, moves: 0, homes: new Map(), busy: new Map(), respected: 0, followers: 0, ledSince: this.time, contender: 0, parent, met: new Set(), appetite: 1, moving: null, siteName: placeName(this.cultures[culture].lang, this.rng), water: [x, y], past: [], today: newDay(), yesterday: newDay(), can: new Array(IDEA_COUNT).fill(0), keeper: new Array(IDEA_COUNT).fill(0), outAt: 0 };
    this.bands.push(b); this.bandById.set(id, b);
    return b;
  }

  private foundBand(x: number, y: number, culture: number, anc: Ancestry, size: number): void {
    const rng = this.rng, b = this.newBand(x, y, culture, 0), now = this.time;
    const clim = this.climateAt(x, y);
    const add = (sex: "f" | "m", age: number, g: Genome, mother = 0, father = 0) => this.makePerson(b, sex, now - age * YEAR - rng.next() * YEAR * 0.5, g, mother, father, clim.winter);
    /* several families: some led by an old couple with grown children and grandchildren, some young couples with their children */
    const couple = (ageF: number) => {
      const f = add("f", ageF, founderGenome(anc, rng)), m = add("m", ageF + rng.int(-3, 6), founderGenome(anc, rng));
      this.pair(f, m, false); return [f, m] as const;
    };
    const kidsOf = (f: Person, m: Person, ageF: number) => {
      const out: Person[] = [];
      for (let a = ageF - 19 - rng.int(0, 3); a >= Math.max(0, ageF - 44) && out.length < 6 && b.members.length < size + 1; a -= rng.range(2.6, 4.4)) {
        if (rng.chance(0.3)) continue;   /* not every child lived */
        out.push(add(rng.chance(0.51) ? "m" : "f", a, inherit(f.genome, m.genome, rng), f.id, m.id));
      }
      return out;
    };
    while (b.members.length < size - 1) {
      if (size - b.members.length >= 9 && rng.chance(0.4)) {
        const [gma, gpa] = couple(rng.int(52, 64));
        for (const k of kidsOf(gma, gpa, this.age(gma))) {
          if (this.age(k) < 18 || rng.chance(0.25) || b.members.length >= size) continue;
          const spouse = add(k.sex === "f" ? "m" : "f", Math.max(17, this.age(k) + rng.int(-4, 4)), founderGenome(anc, rng));
          const [f, m] = k.sex === "f" ? [k, spouse] : [spouse, k];
          this.pair(f, m, false); kidsOf(f, m, this.age(f));
        }
      } else {
        const ageF = rng.int(19, 44), [f, m] = couple(ageF); kidsOf(f, m, ageF);
      }
      if (rng.chance(0.3)) add(rng.chance(0.5) ? "f" : "m", rng.int(16, 24), founderGenome(anc, rng));
    }
    /* everyone in a band knows everyone, families best */
    const ms = b.members.map(id => this.byId.get(id)!);
    for (const p of ms) for (const q of ms) if (p !== q) { const r = this.rel(p, q.id); r.fam = 0.8; r.op = 0.12 + rng.next() * 0.25 + (this.kin(p, q, 1) ? 0.45 : 0); }
    this.settleCamp(b, x, y, true);
    for (const p of ms) this.learnSurroundings(p, 30);
    b.appetite = ms.reduce((a, q) => a + FOOD_DAY[this.stage(q)], 0);
    /* they were living here before the story starts: a few days of food are already in camp, some in the pot and some at each hearth */
    b.store.plant = b.appetite * 1; b.store.meat = b.appetite * 1.5;
    for (const h of b.homes.keys()) this.hearthFor(h, b).plant += appetiteOf(this, household(this, b, h)) * 1.5;
  }
  private hearthFor(head: number, b: Band) { let h = b.hearths.get(head); if (!h) { h = noFood(); b.hearths.set(head, h); } return h; }

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
      skills: [0, 0, 0, 0].map(() => adult * rng.range(0.15, 0.75)), know: founderKnow(age, adult), from: new Array(IDEA_COUNT).fill(0),
      mother, father, partner: 0, children: [], guardian: 0, band: b.id,
      x: b.x, y: b.y, dir: 0,
      food: 1.3 + rng.next() * 0.4, condition: 1.2, dayFood: 0, water: 0.7 + rng.next() * 0.3, rest: 0.7 + rng.next() * 0.3, warmth: 0.9, company: 0.7, fear: 0, health: 1, mood: 0.3, skin: age >= 6 ? 1 : 0,
      childHunger: 0, injury: 0, sick: 0, harm: [0, 0, 0, 0, 0], pregnantBy: 0, due: 0, fatherGenome: null, baby: 0, carrier: 0,
      carryKind: 0, carryAmt: 0, hides: 0,
      spear: age >= 15 ? rng.range(0.5, 1) : 0,
      clothes: winterC < -2 ? 2 : winterC < 12 ? 1 : 0, clothesWear: rng.range(0.6, 1),
      prestige: 0, gave: 0.5, took: 0.5, gaveToday: 0, shareRate: 0.6, shared: 0.4, longing: 0, follows: 0, askedAt: 0, visitedAt: this.time - rng.next() * DAY_SECONDS * 8, ember: 0, emberFrom: 0, joined: this.time, came: 0,
      goal: Goal.None, plan: [], si: 0, why: "", whyAt: 0, path: null, pi: 0, anim: Anim.Idle, bubble: Bubble.None, bubbleUntil: 0,
      rel: new Map(), mem: [], places: [], moveWish: 0, leaveWish: 0, lost: 0, tripYield: 2.5, nextLook: 0, nextDanger: 0, party: 0,
      style: "short", lookKey: "", learning: -1,
    };
    p.style = pickStyle(cult, sex, looks.curl, rng);
    p.follows = p.id;
    /* someone grown has standing earned over a life already lived: good hunters most, then good providers, and age */
    p.prestige = adult * rng.range(0.3, 1.2) * (1 + 6 * p.skills[1] + 2 * p.skills[0]) * (age > 40 ? 1.3 : 1);
    p.nextLook = this.time + rng.next() * 3; p.nextDanger = this.time + rng.next();
    if (mom) mom.children.push(p.id); if (dad) dad.children.push(p.id);
    this.people.push(p); this.byId.set(p.id, p); b.members.push(p.id);
    if (age < 2 && mom) { p.carrier = mom.id; mom.baby = p.id; }
    this.dirty.add(p.id);
    return p;
  }

  pair(f: Person, m: Person, announce = true): void {
    /* someone leaving an unhappy marriage for this one: the one left behind does not forgive the newcomer */
    const left: [Person, Person][] = [];
    for (const [x, y] of [[f, m], [m, f]] as [Person, Person][]) {
      const old = x.partner && x.partner !== y.id ? this.byId.get(x.partner) : undefined;
      if (!old) continue;
      old.partner = 0; x.partner = 0; this.stats.partings++; this.stats.social.leftFor++;
      this.remember(old, Mem.Left, x.id, -0.75); this.remember(x, Mem.Parted, old.id, -0.3);
      this.rel(old, x.id).op = Math.min(this.op(old, x.id), -0.2);
      this.rel(old, y.id).op = Math.min(this.op(old, y.id) - 0.4, -0.45);
      left.push([x, old]);
    }
    f.partner = m.id; m.partner = f.id; f.longing = 0; m.longing = 0;
    /* whoever else had been courting one of them takes it hard */
    if (announce) for (const [won, winner] of [[f, m], [m, f]] as [Person, Person][]) {
      for (const q of this.near(won.x, won.y, 40)) {
        if (q === winner || q === won || q.partner || (q.rel.get(won.id)?.court ?? 0) < 0.35) continue;
        this.rel(q, winner.id).op = Math.max(-1, this.op(q, winner.id) - 0.3);
        this.remember(q, Mem.Rejected, won.id, -0.3);
        grievance(this, q, winner, 0.55, `won ${won.name}, whom ${q.sex === "f" ? "she" : "he"} had been courting`);
      }
    }
    const rf = this.rel(f, m.id), rm = this.rel(m, f.id); rf.op = Math.max(rf.op, 0.55); rm.op = Math.max(rm.op, 0.55); rf.court = rm.court = 1; rf.fam = rm.fam = 1;
    if (!announce) return;
    this.stats.couples++;
    this.remember(f, Mem.Paired, m.id, 0.7); this.remember(m, Mem.Paired, f.id, 0.7);
    for (const [x, old] of left) {
      const y = x === f ? m : f;
      this.event("leftfor", Bubble.Heart, `${x.name} left ${old.name} to be with ${y.name}.`, x.x, x.y, [x.id, old.id, y.id], x.band);
      grievance(this, old, y, 0.85, `took ${old.sex === "f" ? "her husband from her" : "his wife from him"}`);
      relayout(this, this.band(old));
    }
    /* a couple from two bands settles with one of them, as their people's custom leans */
    if (f.band !== m.band) {
      /* the one a band listens to stays with it, and their new partner comes to them */
      const cult = this.cultures[this.band(m).culture], leads = (q: Person) => this.band(q).respected === q.id;
      const toMan = leads(m) && !leads(f) ? true : leads(f) && !leads(m) ? false : this.rng.chance(cult.locality);
      const mover = toMan ? f : m, stay = toMan ? m : f;
      if (!left.length) this.event("couple", Bubble.Heart, `${f.name} and ${m.name} became a couple. ${mover.name} left the ${this.band(mover).name} to live with the ${this.band(stay).name}.`, stay.x, stay.y, [f.id, m.id], stay.band, this.band(f).culture !== this.band(m).culture ? 1 : 0);
      this.moveTo(mover, this.band(stay));
    } else if (!left.length) this.event("couple", Bubble.Heart, `${f.name} and ${m.name} of the ${this.band(f).name} became a couple.`, f.x, f.y, [f.id, m.id], f.band, this.band(f).culture !== this.band(m).culture ? 1 : 0);
    relayout(this, this.band(f));
  }
  /** Moves a person (and any baby or young children they look after) to another band. */
  moveTo(p: Person, to: Band): void {
    const move = (q: Person) => {
      const from = this.bandById.get(q.band); if (from) { from.members = from.members.filter(id => id !== q.id); carryHearth(from, to, q.id); }
      q.band = to.id; to.members.push(q.id); abandon(this, q); this.dirty.add(q.id); q.follows = q.id; q.joined = this.time; q.came = from?.id ?? 0;
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
    b.past.push([x, y]); if (b.past.length > 8) b.past.shift();
    b.water = this.waterNear(x, y, 8) ?? [x, y];
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
    reconcileHearths(this, b);
  }
  homeSpot(p: Person): [number, number] {
    const b = this.band(p), h = b.homes.get(homeOf(p, this.byId, this.time));
    const j = (p.id * 0.618) % 1;
    if (h) return this.dryNear(h[0] + (j - 0.5) * 1.2, h[1] + 0.6 + ((p.id * 0.37) % 1) * 0.5);
    return this.dryNear(b.x + Math.cos(p.id) * 2.2, b.y + Math.sin(p.id) * 1.8);
  }
  /** The spot itself if it is dry ground, else the nearest dry ground around it. */
  dryNear(x: number, y: number, r = 4): [number, number] {
    if (this.walker.dry(x, y)) return [x, y];
    for (let d = 1; d <= r; d++) for (let k = 0; k < 8 * d; k++) {
      const a = k / (8 * d) * Math.PI * 2, tx = x + Math.cos(a) * d, ty = y + Math.sin(a) * d;
      if (this.walker.dry(tx, ty)) return [Math.floor(tx) + 0.5, Math.floor(ty) + 0.5];
    }
    return [x, y];
  }
  /** Where someone sits at the fire: a ring around it, each in their own place. */
  fireSpot(p: Person): [number, number] {
    const b = this.band(p), a = (p.id * 2.399) % (Math.PI * 2), r = 1.5 + ((p.id * 0.618) % 1) * 1.6;
    return this.dryNear(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r * 0.75);
  }
  siteValueFor(p: Person, x: number, y: number): number { return siteValue(p, x, y, this.time); }
  atCamp(p: Person, r = 6): boolean { const b = this.band(p); return Math.hypot(p.x - b.x, p.y - b.y) < r; }
  /** The camp of any band within r tiles, if one is there. */
  campNear(x: number, y: number, r: number): Band | null { for (const o of this.bands) if (Math.hypot(o.x - x, o.y - y) < r) return o; return null; }

  /* ---------------- knowledge of places ---------------- */

  learnPlace(p: Person, k: number, x: number, y: number, q: number, ref: number, src: number, t = this.time, sp?: number): void {
    const same = (pl: KnownPlace) => pl.k === k && (ref ? pl.ref === ref : Math.hypot(pl.x - x, pl.y - y) < (k === Place.Water ? 3 : 8));
    const old = p.places.find(same);
    if (old) { if (t >= old.t) { old.x = x; old.y = y; old.q = q; old.t = t; old.src = src; if (sp !== undefined) old.sp = sp; } return; }
    p.places.push({ k, x, y, q, t, src, ref, sp });
    if (p.places.length > 40) {
      /* forget the least useful: far from where they live, poor for its kind, and long ago */
      const camp = this.bandById.get(p.band), now = this.time;
      let worst = -1, wv = 1e9;
      p.places.forEach((pl, i) => {
        if (pl.k === Place.Camp && pl.ref === p.band) return;
        const d = camp ? Math.hypot(pl.x - camp.x, pl.y - camp.y) : 0, near = 1 / (1 + d / 25);
        const worth = pl.k === Place.Water || pl.k === Place.Camp ? 1.5 : Math.min(2, estimate(pl, now) / PLACE_TYPICAL[pl.k]);
        const v = worth * near - (now - pl.t) / (DAY_SECONDS * 40);
        if (v < wv) { wv = v; worst = i; }
      });
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
      if (e.plants[c] * PLANT_UNITS > 10) { const spot = this.foodSpot(gx, gy, "plant"); if (spot) this.learnPlace(p, Place.Plants, spot[0], spot[1], e.plants[c] * PLANT_UNITS * 0.06, 0, 0); }
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
  event(kind: string, icon: number, text: string, x: number, y: number, who: number[], band: number, hint = 0): void {
    const { sig, title } = weigh(this, kind, who, band, hint);
    const e: ChronicleEvent = { id: this.nextEvent++, t: this.time, kind, icon: icon as ChronicleEvent["icon"], text, x, y, who, band, sig, title };
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
      /* never left standing in a lake: step out to the nearest dry ground */
      if (!this.walker.passable(p.x, p.y)) { [p.x, p.y] = this.dryNear(p.x, p.y, 6); p.path = null; }
      if (time >= p.nextDanger) { p.nextDanger = time + 0.8 + (p.id % 7) * 0.05; this.danger(p); }
      if (time >= p.nextLook) { p.nextLook = time + 2.5 + (p.id % 11) * 0.1; this.look(p); this.feel(p); }
      if (p.si >= p.plan.length || (isInterruptible(p.goal) && time - p.whyAt > 7) || this.urgent(p)) decide(this, p);
      doStep(this, p, dt);
    }
    this.camps(dt);
    for (const b of this.bands) if (b.moving) {
      /* the band has arrived when most of it is there, or after three days whatever the stragglers do */
      const m = b.moving; let there = 0;
      for (const id of b.members) { const q = this.byId.get(id); if (q && Math.hypot(q.x - m.x, q.y - m.y) < 5) there++; }
      const lead = this.byId.get(m.by), leadThere = !!lead && lead.band === b.id && Math.hypot(lead.x - m.x, lead.y - m.y) < 5;
      if (there >= b.members.length * 0.5 || leadThere || time - m.since > DAY_SECONDS * 2) this.arrive(b);
    }
    if (day !== this.lastDay) { this.lastDay = day; this.day = day; this.daily(); }
    /* a second round of sharing at midday, as food comes in */
    if (day !== this.lastNoon && this.dayFrac() >= 0.5) { this.lastNoon = day; for (const b of this.bands) shareRound(this, b); }
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
    if (p.goal === Goal.Drink) return false;
    if (p.water < (p.goal === Goal.Sick || p.goal === Goal.Migrate ? 0.1 : 0.2)) return true;
    if (p.goal === Goal.Flee || p.goal === Goal.Migrate || p.goal === Goal.Sick) return false;
    if (p.warmth < 0.22 && p.goal !== Goal.Warm && p.goal !== Goal.Sleep && this.band(p).fire > 0.05) return true;
    if (p.food < 0.12 && p.carryAmt > 0 && p.carryKind !== 4 && p.goal !== Goal.Eat) return true;
    if (p.sick > 0.5) return true;
    /* the fire is out in the cold and nobody at camp can light it: someone who can make fire comes back to do it, even from their bed */
    if (p.know[Idea.MakeFire] > 0 && p.goal !== Goal.Kindle && this.time - p.whyAt > 6) {
      const b = this.band(p);
      if (b.fire <= 0 && !b.moving && this.tempC(b.x, b.y) < 10 && Math.hypot(p.x - b.x, p.y - b.y) < 30 && !this.fireMakerNear(b, 6)) return true;
    }
    /* night falls: whoever is still out working heads home */
    if (this.sun < 0.08 && (p.goal === Goal.Gather || p.goal === Goal.Fish || p.goal === Goal.Snare || p.goal === Goal.Wood || p.goal === Goal.Explore || p.goal === Goal.Haul || p.goal === Goal.Talk || p.goal === Goal.Play || p.goal === Goal.Follow)) {
      const st = p.plan[p.si]; return !(st && st.k === St.Drop) && !(st && st.k === St.Go && p.si === p.plan.length - 2);
    }
    if (this.sun < 0.08 && p.goal === Goal.Hunt && this.time - p.whyAt > 30) return true;
    return false;
  }

  /** The body: hunger, thirst, tiredness, cold, loneliness and health, every step. */
  private body(p: Person, dt: number): void {
    const st = this.stage(p), days = dt / DAY_SECONDS, b = this.band(p);
    const working = p.goal >= Goal.Gather && p.goal <= Goal.Wood, asleep = p.goal === Goal.Sleep && p.anim === Anim.Sleep;
    const moving = p.anim === Anim.Walk || p.anim === Anim.Carry || p.anim === Anim.CaneWalk, running = p.anim === Anim.Run || p.anim === Anim.Play;
    const T = this.tempC(p.x, p.y);
    if (st === "baby") {
      /*
        Infants nurse from whoever carries them if she has milk: their mother, or a mother
        with a baby of her own who takes in an orphan, as wet nurses did. Milk keeps coming
        from a mother's reserves for a while after her own meals run short. A baby old
        enough can be fed soft food at camp.
      */
      const c = this.byId.get(p.carrier), cb = c?.baby ? this.byId.get(c.baby) : undefined;
      const milk = !!c && c.sex === "f" && (c.baby === p.id || (!!cb && this.age(cb) < 2.5)) && (c.food > 0.25 || c.condition > 0.4);
      const twins = milk && c!.baby !== p.id;
      p.food = Math.max(0, Math.min(2, p.food + ((milk ? (twins ? 0.9 : 1.1) : 0) - 0.5) * days));
      if (!milk && this.age(p) > 0.9 && this.atCamp(p) && p.food < 1.2) this.eatFromStore(p, b, 0.8 * days);
    } else {
      let burn = FOOD_DAY[st] * (asleep ? 0.7 : running ? 1.5 : working ? 1.25 : moving ? 1.15 : 1);
      if (p.pregnantBy) burn += 0.15;
      if (p.baby) burn += 0.35;
      if (p.warmth < 0.5) burn += 0.25;
      p.food = Math.max(0, p.food - burn * days);
    }
    p.dayFood += Math.min(1.5, p.food) * days;
    /* the sick are brought food where they lie */
    if (p.goal === Goal.Sick && p.food < 0.9 && this.atCamp(p, 6)) this.eatFromStore(p, b, 1.2 * days);
    /* and nobody starves at camp with food at hand: a starving child is given a meal, and a grown-up gets up from bed or the fire to eat */
    else if (p.food < 0.12 && (st === "child" || st === "toddler" || asleep || p.goal === Goal.Rest || p.goal === Goal.Warm) && this.atCamp(p, 8)) this.eatFromStore(p, b, 0.6);
    p.water = Math.max(0, p.water - (asleep ? 0.3 : 1.25) * (T > 28 ? 1.35 : T < 0 ? 0.75 : 1) * (working || running ? 1.15 : 1) * days);
    /* a sip from the water skin when thirsty and away from water */
    if (p.water < 0.62 && p.skin > 0) { const t = Math.min(p.skin, (0.9 - p.water) / 0.7); p.skin -= t; p.water += t * 0.7; }
    /* little ones drink from the skins and gourds kept at camp, or from whoever carries them */
    if ((st === "baby" || st === "toddler") && p.water < 0.8) {
      if (this.atCamp(p, 5) || p.carrier) p.water = 0.8;
      else for (const id of [p.mother, p.guardian, p.father]) { const m = this.byId.get(id); if (m && m.skin > 0.05 && Math.hypot(m.x - p.x, m.y - p.y) < 3) { m.skin -= 0.05; p.water = 0.8; break; } }
    } else if (st === "child" && p.water < 0.35 && p.skin <= 0 && ((this.time * 2) | 0) % 3 === p.id % 3) {
      /* a thirsty child away from water is given a drink by a grown-up of the band walking nearby */
      for (const q of this.near(p.x, p.y, 4)) if (q.band === p.band && q.skin > 0.2 && this.age(q) >= 16) { q.skin -= 0.12; p.water += 0.17; break; }
    }
    p.rest = Math.max(0, Math.min(1, p.rest + (asleep ? 0.06 : p.anim === Anim.Sit || p.anim === Anim.HoldBaby || p.anim === Anim.Sick ? 0.006 : -0.021 * (running ? 1.5 : 1)) * dt));
    /* warmth: clothes set how cold it can be before you feel it; a fire and a shelter help */
    /* any band's fire warms whoever sits by it, a guest's host's as much as their own */
    const host = Math.hypot(p.x - b.x, p.y - b.y) < 7 ? b : this.campNear(p.x, p.y, 7);
    const fireNear = !!host && host.fire > 0.04 && Math.hypot(p.x - host.x, p.y - host.y) < 3, home = asleep && !!host;
    const comfort = 16 - 8 * this.clothesNow(p) - (moving || working || running ? 5 : 0) - (st === "baby" ? 8 : 0);
    const felt = T + (fireNear ? 16 : 0) + (home ? 7 : 0);
    const target = Math.max(0, Math.min(1, 0.96 - Math.max(0, comfort - felt) / 16));
    p.warmth += (target - p.warmth) * Math.min(1, dt * (target > p.warmth ? 0.12 : 0.05));
    /* company: being around people you like fills it, being alone drains it */
    if (!asleep && st !== "baby") {
      let friends = 0;
      if (((this.time * 2) | 0) % 4 === p.id % 4) for (const q of this.near(p.x, p.y, 4)) if (q !== p && this.op(p, q.id) > 0.1) { friends++; if (friends > 1) break; }
      p.company = Math.max(0, Math.min(1, p.company - 0.5 * days + (friends ? 0.5 * days * 4 : 0)));
    }
    p.fear = Math.max(0, p.fear - 0.12 * dt);
    /* health: hunger, thirst and cold wear it down; food and rest restore it */
    let dh = 0;
    const hurt = (k: number, v: number) => { dh -= v; p.harm[k] += v; };
    if (p.food < 0.1) hurt(0, 0.14 * days);
    if (p.water < 0.04) hurt(1, 0.5 * days);
    if (p.warmth < 0.25) hurt(2, (0.25 - p.warmth) * (st === "baby" || st === "toddler" || st === "elder" ? 2.4 : 1.6) * days);
    if (p.sick > 0) hurt(3, (p.sick > 1 ? 0.22 : 0.02) * days);
    if (dh === 0 && p.food > 0.5 && p.water > 0.3) dh = (0.06 + (asleep ? 0.06 : 0)) * days;
    p.health = Math.max(0, Math.min(1 - p.injury * 0.5, p.health + dh));
    p.injury = Math.max(0, p.injury - 0.03 * days * (p.food > 0.4 ? 1 : 0.3));
    if (p.health <= 0) {
      /* the cause is whatever wore them down most, not just the last straw */
      let k = 0; for (let j = 1; j < 5; j++) if (p.harm[j] > p.harm[k]) k = j;
      this.die(p, p.injury > 0.3 && p.harm[k] < 0.3 ? "injuries" : ["hunger", "thirst", "the cold", "illness", "injuries"][k]);
    }
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

  /** Eats from the household's own hearth first, then the band's pot (what spoils first, first). */
  eatFromStore(p: Person, b: Band, want: number): number { return eat(this, p, b, want); }

  /* ---------------- danger ---------------- */

  private danger(p: Person): void {
    const st = this.stage(p); if (st === "baby") return;
    const hs = this.herdsNear(p.x, p.y, 7).filter(h => h.sp === Species.Wolf || h.sp === Species.Bear);
    if (!hs.length) return;
    const company = this.near(p.x, p.y, 5).filter(q => q !== p && this.age(q) >= 14).length;
    const young = st === "child" || st === "toddler", armed = p.spear > 0.1 && this.age(p) >= 15;
    for (const h of hs) {
      const d = Math.hypot(h.x - p.x, h.y - p.y), bear = h.sp === Species.Bear;
      /* company and a spear steady the nerves: wolves seldom face down armed people together */
      const steady = bear ? 1 / (1 + company * 0.3) : (armed ? 0.55 : 1) / (1 + company * 0.7);
      const scared = (1 - d / 7) * (bear ? 1 : 0.5 + h.n * 0.1) * (young ? 1.4 : 1) * (1.2 - p.traits[0] * 0.6) * (young ? 1 : steady);
      p.fear = Math.max(p.fear, Math.min(1, scared));
      this.learnPlace(p, Place.Danger, h.x, h.y, h.n, h.id, 0, this.time, h.sp);
      /* an armed hunter, bolder with others at hand, shouts and waves the pack off, from camp or from a kill */
      if (!bear && armed && !young && d < 5 && h.state !== 2 && (company > 0 || p.traits[0] > 0.6) && this.rng.chance(0.15 + p.traits[0] * 0.2)) {
        const a = Math.atan2(h.y - p.y, h.x - p.x);
        h.state = 2; h.prey = -1; h.timer = 10; h.tx = h.x + Math.cos(a) * 18; h.ty = h.y + Math.sin(a) * 18;
        p.fear = Math.max(0, p.fear - 0.3); p.prestige += 0.01;
        if (this.rng.chance(0.15)) this.bubble(p, Bubble.Angry, 2);
        continue;
      }
      /* wolves try a lone or weak person only when they are hungry; bears go for anyone who gets too close */
      const weak = young || p.injury > 0.3 || st === "elder";
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
    h.state = 2; h.timer = 12; h.prey = -1; const a = Math.atan2(h.y - p.y, h.x - p.x); h.tx = h.x + Math.cos(a) * 20; h.ty = h.y + Math.sin(a) * 20;
    if (h.sp === Species.Wolf) h.hunger = Math.max(0, h.hunger - 0.2);
    const what = h.sp === Species.Bear ? "A bear" : "Wolves";
    if (p.health <= 0) { this.die(p, h.sp === Species.Bear ? "a bear" : "wolves"); return; }
    this.event("attack", h.sp === Species.Bear ? Bubble.Fear : Bubble.Wolf, `${what} attacked ${p.name} of the ${this.band(p).name}. ${p.sex === "f" ? "She" : "He"} got away hurt.`, p.x, p.y, [p.id], p.band);
    abandon(this, p); decide(this, p, Goal.Flee);
  }

  /**
    Mood: how well each need is met, weighted by what this person cares about (the
    sociable miss company more, the ambitious care about standing), plus how the things
    they remember feel: a new baby or a good hunt lifts it, a death or a quarrel weighs on it.
  */
  private feel(p: Person): void {
    const t = p.traits;
    const parts: [number, number][] = [
      [Math.min(1, p.food / 1.2), 1.2], [p.water, 0.8], [p.rest, 0.6], [p.warmth, 1], [p.company, 0.4 + t[5] * 0.8],
      [1 - p.fear, 0.6 + (1 - t[0]) * 0.5], [p.health, 1.2], [Math.min(1, 0.3 + p.prestige), t[3] * 0.6],
    ];
    let sw = 0, sv = 0; for (const [v, w] of parts) { sv += (v - 0.55) * w; sw += w; }
    let mem = 0;
    for (const m of p.mem) mem += m.v * Math.exp(-(this.time - m.t) / (DAY_SECONDS * 8));
    if (p.partner) mem += 0.08;
    const kids = p.children.length ? p.children.filter(id => this.byId.has(id)).length : 0;
    if (kids) mem += 0.05;
    p.mood = Math.max(-1, Math.min(1, sv / sw * 2 + Math.max(-0.6, Math.min(0.6, mem * 0.5))));
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
        this.event("contact", Bubble.Question, same ? `${p.name} of the ${mine.name} came upon the camp of the ${b.name}, kin from the same people.` : `${p.name} of the ${mine.name} came upon strangers: the ${b.name}, who speak ${this.cultures[b.culture].lang.name}.`, b.x, b.y, [p.id], mine.id, same ? 0 : 1);
      }
    }
    maybeFight(this, p);
    /* watching others at work, and things others have made */
    watch(this, p);
    if (this.works.length) lookAtWorks(this, p);
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

  /**
    The fire. It burns down and has to be fed from the woodpile by whoever is at camp. Once
    it is out, only someone who can make fire can bring it back, or someone who carries an
    ember home from another band's fire. On the move the band carries its fire along, as
    embers smoldering in a bundle of moss and fungus, which keep a day or two.
  */
  private camps(dt: number): void {
    for (const b of this.bands) {
      if (b.fire <= 0) continue;
      if (b.moving) { b.fire = Math.max(0, b.fire - dt / DAY_SECONDS * 0.12); if (b.fire <= 0) this.fireOut(b); continue; }
      b.fire = Math.max(0, b.fire - dt / DAY_SECONDS * (this.sun < 0.2 ? 0.55 : 0.4));
      /* whoever is at camp and awake feeds it from the woodpile */
      if (b.fire < 0.55 && b.store.wood >= 1) {
        let tender: Person | null = null;
        for (const id of b.members) { const q = this.byId.get(id); if (q && q.know[Idea.KeepFire] > 0 && this.age(q) >= 10 && q.goal !== Goal.Sleep && Math.hypot(q.x - b.x, q.y - b.y) < 4) { tender = q; break; } }
        if (tender) { b.store.wood -= 1; b.fire = Math.min(1, b.fire + 0.3); if (b.fire < 0.35) this.bubble(tender, Bubble.Fire, 2); }
      }
      if (b.fire <= 0) this.fireOut(b);
    }
  }
  /** The fire has gone out. Everyone at camp feels it; a band that cannot make fire has a problem. */
  private fireOut(b: Band): void {
    b.fire = 0; b.outAt = this.time; this.stats.fire.out++;
    const T = this.tempC(b.x, b.y);
    for (const id of b.members) { const q = this.byId.get(id); if (q && this.age(q) >= 10 && Math.hypot(q.x - b.x, q.y - b.y) < 12) this.remember(q, Mem.FireOut, 0, T < 8 ? -0.3 : -0.12); }
    if (!bandKnows(b, Idea.MakeFire) && (T < 12 || !b.past.length || this.rng.chance(0.2))) this.event("fireout", Bubble.Fire, `The fire of the ${b.name} went out${T < 4 ? " in the cold" : ""}, and none of them knows how to make fire.`, b.x, b.y, [], b.id, T < 4 ? 1 : 0);
  }
  /** Whether someone who can make fire is at or near camp, awake or able to be woken. */
  fireMakerNear(b: Band, r: number): boolean {
    for (const id of b.members) { const q = this.byId.get(id); if (q && q.know[Idea.MakeFire] > 0 && !q.carrier && q.goal !== Goal.Sick && this.age(q) >= 12 && Math.hypot(q.x - b.x, q.y - b.y) < r) return true; }
    return false;
  }
  /** The fire lit again, by someone who can make it or with an ember carried home. */
  relight(b: Band): void {
    if (b.store.wood >= 1) { b.store.wood -= 1; b.fire = 0.32; } else b.fire = 0.16;
  }

  /* ---------------- each day ---------------- */

  private daily(): void {
    for (const p of this.people.slice()) {
      if (!this.byId.has(p.id)) continue;
      const age = this.age(p), st = stageOf(age);
      /* a two-year-old walks on their own feet */
      if (age >= 2 && p.carrier) { const c = this.byId.get(p.carrier); if (c && c.baby === p.id) c.baby = this.youngestBaby(c); p.carrier = 0; abandon(this, p); }
      p.condition = p.condition * 0.8 + p.dayFood * 0.2; p.dayFood = 0;
      /* childhood hunger is remembered in the body */
      if (age < 16) p.childHunger = p.childHunger * 0.97 + (p.food < 0.4 ? 0.03 : 0);
      p.prestige *= 0.99; p.gave *= 0.97; p.took *= 0.97; p.gaveToday = 0;
      for (let j = 0; j < 5; j++) p.harm[j] *= 0.85;
      if (st === "adult" && age < 55 && (!p.partner || this.op(p, p.partner) < -0.05)) p.longing = Math.min(1, p.longing + (p.partner ? 0.02 : 0.035) * (0.6 + p.traits[5] * 0.6));
      forgetDebts(p); fadeGrudges(p);
      /* growing up, children take on their parents' grudges */
      if (age >= 9 && age < 17 && this.rng.chance(0.06)) handDown(this, p);
      p.clothesWear = Math.max(0, p.clothesWear - (this.tempC(p.x, p.y) < 0 ? 0.012 : 0.005));
      if (p.clothesWear <= 0 && p.clothes > 0) { p.clothes--; p.clothesWear = 0.6; this.dirty.add(p.id); }
      /* forget old trivial memories; strong ones last */
      p.mem = p.mem.filter(m => Math.abs(m.v) * Math.exp(-(this.time - m.t) / (YEAR * 0.8)) > 0.04);
      p.places = p.places.filter(pl => !((pl.k === Place.Game || pl.k === Place.Carcass || pl.k === Place.Danger) && this.time - pl.t > DAY_SECONDS * 5));
      this.illness(p, age, st);
      if (!this.byId.has(p.id)) continue;
      if (age >= 5 && age < 18) growUp(this, p, age);
      this.fertility(p, age);
      this.refreshLook(p, age, st);
    }
    this.couplesCheck();
    feudDay(this);
    ideasDay(this);
    worksDay(this);
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
    const fed = Math.max(0, Math.min(1, (p.condition - 0.35) / 0.65)) * Math.max(0, Math.min(1, p.health * 1.2 - 0.1));
    if (this.rng.chance(0.02 * Math.max(0, peak) * nursing * fed)) { p.pregnantBy = dad.id; p.fatherGenome = dad.genome; p.due = this.time + YEAR * 0.75; this.dirty.add(p.id); }
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
    this.event("birth", Bubble.Baby, `${mom.name}${dad ? ` and ${dad.name}` : ""} of the ${b.name} had ${born.length > 1 ? "twins" : born[0].sex === "f" ? "a daughter" : "a son"}, ${names}.`, mom.x, mom.y, [...born.map(k => k.id), mom.id], b.id, born.length > 1 ? 2 : 0);
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
    this.archive.set(p.id, { id: p.id, name: p.name, sex: p.sex, born: p.born, died: this.time, x: p.x, y: p.y, cause, mother: p.mother, father: p.father, partner: p.partner, children: p.children.slice(), band: p.band, mel: p.looks.mel });
    this.stats.deaths++; this.stats.causes.set(cause, (this.stats.causes.get(cause) ?? 0) + 1);
    feudsOnDeath(this, p, cause);
    /* the family grieves */
    for (const id of [p.partner, p.mother, p.father, ...p.children]) { const q = this.byId.get(id); if (q) this.remember(q, Mem.Death, p.id, id === p.partner ? -0.9 : -0.8); }
    for (const [id, r] of p.rel) { const q = this.byId.get(id); if (q && r.op > 0.4 && !q.mem.some(m => m.k === Mem.Death && m.who === p.id)) this.remember(q, Mem.Death, p.id, -0.4 * r.op); }
    const partner = this.byId.get(p.partner); if (partner) partner.partner = 0;
    for (const q of this.people) if (q.baby === p.id) q.baby = 0;
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
  /** The youngest baby someone still carries, after an older one has started walking. */
  private youngestBaby(c: Person): number {
    for (const q of this.people) if (q.carrier === c.id && this.age(q) < 2) return q.id;
    return 0;
  }
  guardianFor(c: Person): Person | null {
    const b = this.band(c), ms = b.members.map(id => this.byId.get(id)).filter((q): q is Person => !!q && q !== c && this.age(q) >= 16);
    ms.sort((a, d) => (this.kin(c, d, 2) ? 1 : 0) - (this.kin(c, a, 2) ? 1 : 0) || d.traits[1] - a.traits[1]);
    return ms[0] ?? null;
  }
  /** `announce` is false when something else (a merge) has already told the story. */
  endBand(b: Band, how: string, announce = true): void {
    this.bands = this.bands.filter(o => o !== b); this.bandById.delete(b.id);
    for (const o of this.bands) o.met.delete(b.id);
    if (announce) this.event("band-end", Bubble.Sad, `The ${b.name} ${how}.`, b.x, b.y, [], b.id);
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
    this.stats.social.shared += b.today.shared; this.stats.social.kept += b.today.plant + b.today.meat + b.today.fish - b.today.shared;
    b.yesterday = b.today; b.today = newDay();
    b.appetite = ms.reduce((a, q) => a + FOOD_DAY[this.stage(q)], 0);
    /* fresh meat and fish rot within days in the warm; plant food keeps longer, in baskets longer still; dried meat keeps for months */
    const T = this.tempC(b.x, b.y), rot = T > 20 ? 0.35 : T > 10 ? 0.2 : T > 5 ? 0.1 : T > 0 ? 0.04 : 0.015;
    const plantKeep = T < 5 ? 0.99 : bandKnows(b, Idea.Baskets) ? 0.985 : 0.97, driedKeep = T > 22 ? 0.99 : 0.996;
    b.yesterday.spoiled += spoil(b.store, rot, plantKeep, driedKeep) + spoilHearths(b, rot, plantKeep, driedKeep);
    reconcileHearths(this, b);
    shareRound(this, b);
    const adults = ms.filter(q => this.age(q) >= 16);
    /* who the band listens to */
    chooseLeaders(this, b, adults);
    /* fairness: people notice who takes from the pot without bringing anything, and who shares */
    for (const q of adults) {
      if (q.baby || q.sick > 0 || q.injury > 0.3 || this.age(q) > 55) continue;
      if (q.took > 0.6 && q.gave < q.took * 0.25) for (const o of adults) if (o !== q && o.gave > 0.8 && this.rng.chance(0.3 * (1 - o.traits[1] * 0.6))) {
        this.rel(o, q.id).op -= 0.04;
        if (this.rng.chance(0.2)) { this.remember(o, Mem.Freeloader, q.id, -0.2); grievance(this, o, q, 0.3, `eats from the pot and brings nothing in`); }
      }
      if (q.shared > 0.8 && q.shared > q.took * 1.2) q.prestige += 0.03;
      /* someone who keeps nearly everything for their own while the pot runs dry is talked about */
      if (q.gave > 1 && q.shareRate < 0.3 && storeFood(b.store) < b.appetite * 0.5) for (const o of adults) if (o !== q && !this.kin(o, q, 1) && this.rng.chance(0.15)) { this.rel(o, q.id).op -= 0.03; if (this.rng.chance(0.15)) this.remember(o, Mem.Stingy, q.id, -0.15); }
    }
    if (b.moving) return;
    /* families leave (a feud, or hunger), and whoever is left weighs moving camp or splitting */
    const still = (list: Person[]) => list.filter(q => q.band === b.id && this.byId.has(q.id));
    feudLeave(this, b);
    if (!this.bandById.has(b.id)) return;
    this.weighLeave(b, still(ms), still(adults));
    if (!this.bandById.has(b.id)) return;
    this.weighMove(b, still(ms), still(adults));
    if (!b.moving) this.weighSplit(b, still(ms), still(adults));
    if (this.bandById.has(b.id) && b.members.length <= 4) this.weighJoin(b, still(ms));
  }

  /**
    Whether to move camp. Each adult wants to move as much as food near camp has run out,
    their trips have come back light, the store is empty or the place has turned dangerous,
    and only if they know somewhere better. The band goes when those who want to go carry
    enough weight (respect, and the ambitious are louder); it goes to the place the most
    listened-to of them knows.
  */
  private weighMove(b: Band, ms: Person[], adults: Person[]): void {
    if (this.time - b.movedAt < DAY_SECONDS * 2.5 || adults.length === 0) return;
    /* everyone at camp knows when meals have been thin */
    const deficit = Math.max(0, 1 - (b.yesterday.plant + b.yesterday.meat + b.yesterday.fish) / Math.max(1, b.appetite));
    const short = Math.max(0, 1 - storeDays(b) / 2);
    let wFor = 0, wAll = 0, lead: Person | null = null, leadW = -1;
    /* the places those who want to go speak for, best first; the loudest voice leads */
    const offers: { v: number; at: [number, number]; by?: Person }[] = [];
    for (const q of adults) {
      /* a household with a crop ripening by camp counts it among what the place gives */
      const here = siteValue(q, b.x, b.y, this.time) + plotHope(this, b, homeOf(q, this.byId, this.time)) * 0.5;
      /* somewhere better: places they know with food, far enough to be fresh ground */
      const mine: { v: number; at: [number, number] }[] = [];
      for (const pl of q.places) {
        if (pl.k !== Place.Site && pl.k !== Place.Plants && pl.k !== Place.Fish && pl.k !== Place.Game) continue;
        const d = Math.hypot(pl.x - b.x, pl.y - b.y); if (d < 20 || d > 120) continue;
        /* good land seen across a lake or a strait is no use to people on foot */
        if (!this.walker.reach(b.x, b.y, pl.x, pl.y) || this.bands.some(o => o !== b && Math.hypot(o.x - pl.x, o.y - pl.y) < 16)) continue;
        mine.push({ v: (siteValue(q, pl.x, pl.y, this.time) + (pl.k === Place.Site ? 8 + pl.q : 0)) * (1 - d / 300), at: [pl.x, pl.y] });
      }
      mine.sort((a, c) => c.v - a.v);
      const bestV = mine[0]?.v ?? 0;
      const danger = q.mem.some(m => m.k === Mem.Attacked && this.time - m.t < DAY_SECONDS * 4) ? 0.3 : 0;
      const push = Math.min(1, 0.65 * deficit + 0.35 * short + danger), pull = mine.length ? Math.min(1, bestV / Math.max(4, here + 4)) : 0;
      q.moveWish = Math.min(1, q.moveWish * 0.35 + 0.65 * push * (0.55 + 0.45 * pull) * (0.8 + q.traits[4] * 0.4));
      const wt = 0.5 + q.prestige + q.traits[3] * 0.4;
      wAll += wt;
      if (q.moveWish > 0.4 && pull > 0.35) {
        wFor += wt; if (wt > leadW) { leadW = wt; lead = q; }
        for (const m of mine.slice(0, 4)) offers.push({ v: m.v * (1 + wt * 0.2), at: m.at, by: q });
      }
    }
    /*
      Hungry enough, a band will set out even without anyone knowing somewhere better:
      they head for ground they have not camped on lately, where nobody has been
      stripping the bushes, and see what they find.
    */
    const fresh: typeof offers = [];
    if ((!lead || wFor / wAll < 0.45) && deficit > 0.5 && storeDays(b) < 1) {
      for (let k = 0; k < 24; k++) {
        const a = this.rng.next() * Math.PI * 2, d = this.rng.range(26, 46), x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
        if (!this.walker.dry(x, y) || !this.walker.reach(b.x, b.y, x, y) || !this.waterNear(x, y, 6)) continue;
        let far = 1e9; for (const [px, py] of b.past) far = Math.min(far, Math.hypot(px - x, py - y));
        const crowd = this.bands.some(o => o !== b && Math.hypot(o.x - x, o.y - y) < 18) ? 0.3 : 1;
        fresh.push({ v: far * crowd, at: [x, y] });
      }
      const sorted = adults.slice().sort((a, c) => c.prestige + c.traits[3] * 0.4 - (a.prestige + a.traits[3] * 0.4));
      if (fresh.length && sorted.length) { lead = sorted[0]; wFor = wAll; fresh.sort((a, c) => c.v - a.v); }
    }
    if (!lead || wFor / wAll < 0.45) return;
    /* the first of the places on offer where a camp can actually stand: dry, roomy ground by fresh water, that they can walk to */
    const tries = [...offers.sort((a, c) => c.v - a.v), ...fresh];
    let spot: [number, number] | null = null, route: number[] | null = null;
    for (const o of tries.slice(0, 6)) {
      const sp = this.campSpot(o.at[0], o.at[1], 12, [b.x, b.y]); if (!sp) continue;
      const r = this.walker.route(b.x, b.y, sp[0], sp[1], 40000); if (!r) continue;
      spot = sp; route = r; if (o.by) lead = o.by; break;
    }
    if (!spot || !route) return;
    const name = placeName(this.cultures[b.culture].lang, this.rng);
    b.moving = { x: spot[0], y: spot[1], by: lead.id, since: this.time, name, route };
    this.stats.moves++;
    lead.prestige += 0.15;
    for (const q of ms) { abandon(this, q); this.remember(q, Mem.Moved, lead.id, 0.1); }
    const dir = compass(spot[0] - b.x, spot[1] - b.y), why = storeDays(b) < 1 ? "the food around camp had run out" : "the hunting and gathering had grown poor";
    const known = lead.places.some(pl => Math.hypot(pl.x - spot[0], pl.y - spot[1]) < 20);
    this.event("move", Bubble.Move, known ? `The ${b.name} packed up and set off ${dir}, because ${why}. ${lead.name} knew a better place, ${name}.` : `The ${b.name} were going hungry and set off ${dir} into land they did not know, led by ${lead.name}.`, b.x, b.y, [lead.id], b.id, known ? 0 : 1);
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
    if (ms.length < 11 || this.time - b.founded < DAY_SECONDS * 8) return;
    /* a hot feud inside the band, or a second voice at odds with the first, can split a band too small to split for crowding */
    const feuds = this.feuds.filter(f => f.heat > 0.45 && this.byId.get(f.a)?.band === b.id && this.byId.get(f.b)?.band === b.id);
    const leader = this.byId.get(b.respected), rival = this.byId.get(b.contender);
    const faction = !!rival && !!leader && rival.band === b.id && (this.op(rival, leader.id) < 0.05 || !!feudOf(this, rival, leader));
    if (ms.length < 16 && !feuds.length && !faction) return;
    const crowd = Math.max(0, Math.min(1, (ms.length - 26) / 14)), short = Math.max(0, 1 - storeDays(b) / 2);
    let founder: Person | null = null, fw = 0, why: "crowd" | "feud" | "faction" = "crowd", enemy: Person | null = null;
    for (const q of adults) {
      if (this.age(q) < 20 || this.age(q) > 58) continue;
      let bad = 0, n = 0; for (const o of adults) if (o !== q) { bad += Math.max(0, -this.op(q, o.id)); n++; }
      const tension = n ? bad / n * 3 : 0, low = q.traits[3] * Math.max(0, 1 - q.prestige);
      let feudPush = 0, foe: Person | null = null;
      for (const f of feuds) if (f.a === q.id || f.b === q.id) { const v = f.heat * 0.45; if (v > feudPush) { feudPush = v; foe = this.byId.get(f.a === q.id ? f.b : f.a) ?? null; } }
      const factionPush = faction && q === rival ? 0.25 + Math.min(0.2, followersIn(this, b, q) * 0.03) : 0;
      /* the leader, and the leader's own household, do not lead a band away from itself */
      const lh = leader && leader.band === b.id ? homeOf(leader, this.byId, this.time) : -1;
      if (q === leader || homeOf(q, this.byId, this.time) === lh) { q.leaveWish = 0; continue; }
      q.leaveWish = Math.min(1, crowd * 0.55 + short * crowd * 0.3 + tension * 0.5 + low * 0.3 * crowd + (b.respected && this.op(q, b.respected) < -0.3 ? 0.3 : 0) + feudPush + factionPush);
      if (q.leaveWish > fw) { fw = q.leaveWish; founder = q; why = feudPush > crowd * 0.55 && feudPush >= factionPush ? "feud" : factionPush > crowd * 0.55 ? "faction" : "crowd"; enemy = foe; }
    }
    if (!founder || fw < 0.58) return;
    const known: { v: number; at: [number, number] }[] = [];
    for (const pl of founder.places) {
      const d = Math.hypot(pl.x - b.x, pl.y - b.y); if (d < 26 || d > 150 || (pl.k !== Place.Site && pl.k !== Place.Plants && pl.k !== Place.Fish)) continue;
      if (!this.walker.reach(b.x, b.y, pl.x, pl.y) || this.bands.some(o => Math.hypot(o.x - pl.x, o.y - pl.y) < 20)) continue;
      known.push({ v: siteValue(founder, pl.x, pl.y, this.time) + (pl.k === Place.Site ? pl.q : 0), at: [pl.x, pl.y] });
    }
    known.sort((a, c) => c.v - a.v);
    if (fw > 0.75) {
      /* nowhere known will do: the founder will lead them into fresh land, away from where this band has camped */
      const fresh: { v: number; at: [number, number] }[] = [];
      for (let k = 0; k < 24; k++) {
        const a = this.rng.next() * Math.PI * 2, d = this.rng.range(30, 55), x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
        if (!this.walker.dry(x, y) || !this.walker.reach(b.x, b.y, x, y) || !this.waterNear(x, y, 6) || this.bands.some(o => Math.hypot(o.x - x, o.y - y) < 20)) continue;
        let far = 1e9; for (const [px, py] of b.past) far = Math.min(far, Math.hypot(px - x, py - y));
        fresh.push({ v: far, at: [x, y] });
      }
      known.push(...fresh.sort((a, c) => c.v - a.v));
    }
    let spot: [number, number] | null = null, route: number[] | null = null;
    for (const o of known.slice(0, 6)) {
      const sp = this.campSpot(o.at[0], o.at[1], 12, [b.x, b.y]); if (!sp) continue;
      const r = this.walker.route(b.x, b.y, sp[0], sp[1], 40000); if (!r) continue;
      spot = sp; route = r; break;
    }
    if (!spot || !route) { founder.moveWish = Math.max(founder.moveWish, 0.5); return; }
    /*
      Who goes: the founder's household; those who listen to the founder; the founder's side of
      a feud; and adults who like the founder more than the band and also want out.
    */
    const goers = new Set<number>();
    const addHome = (q: Person) => { const h = homeOf(q, this.byId, this.time); for (const o of ms) if (homeOf(o, this.byId, this.time) === h || o.carrier === q.id) goers.add(o.id); goers.add(q.id); };
    addHome(founder);
    const feud = enemy ? feudOf(this, founder, enemy) : null, fside = feud ? sideOf(this, feud, founder) : 0;
    const leadHome = leader && leader.band === b.id ? homeOf(leader, this.byId, this.time) : -1;
    for (const q of adults) {
      if (goers.has(q.id) || goers.size > ms.length * 0.55 || homeOf(q, this.byId, this.time) === leadHome) continue;
      if (enemy && (q === enemy || (feud && sideOf(this, feud, q) && sideOf(this, feud, q) !== fside))) continue;
      let avg = 0; for (const o of adults) if (o !== q) avg += this.op(q, o.id); avg /= Math.max(1, adults.length - 1);
      const side = feud && sideOf(this, feud, q) === fside;
      if (q.follows === founder.id || side || (this.op(q, founder.id) > avg + 0.08 && q.leaveWish > 0.3)) addHome(q);
    }
    if (goers.size < 5 || ms.length - goers.size < 5) return;
    const nb = this.newBand(spot[0], spot[1], b.culture, b.id);
    /* they take embers from the old fire, if it is burning */
    nb.store.wood = 2; nb.respected = founder.id; nb.ledSince = this.time; nb.fire = b.fire > 0 ? 0.8 : 0;
    const share = goers.size / ms.length;
    for (const k of ["plant", "meat", "fish", "dried", "hides"] as const) { const t = b.store[k] * share; b.store[k] -= t; nb.store[k] += t; }
    for (const id of goers) { const q = this.byId.get(id)!; b.members = b.members.filter(x => x !== id); carryHearth(b, nb, id); q.band = nb.id; nb.members.push(id); abandon(this, q); this.remember(q, Mem.Split, founder.id, 0.2); this.dirty.add(id); }
    countBand(this, nb);
    nb.met.add(b.id); b.met.add(nb.id);
    nb.moving = { x: spot[0], y: spot[1], by: founder.id, since: this.time, name: placeName(this.cultures[b.culture].lang, this.rng), route };
    nb.x = b.x; nb.y = b.y;
    founder.prestige += 0.4;
    this.stats.splits++;
    if (why !== "crowd") this.stats.social.factionSplits++;
    const dir = compass(spot[0] - b.x, spot[1] - b.y), him = founder.sex === "f" ? "her" : "him";
    const text = why === "feud" && enemy ? `The feud between ${founder.name} and ${enemy.name} split the ${b.name}. ${founder.name} led ${goers.size} of them away ${dir} to start a band of their own, the ${nb.name}.`
      : why === "faction" ? `The ${b.name} could no longer agree whom to listen to. ${founder.name} led the ${goers.size} who looked to ${him} away ${dir}, to start a band of their own, the ${nb.name}.`
      : `The ${b.name} had grown too many for one fire. ${founder.name} led ${goers.size} of them away ${dir} to start a band of their own, the ${nb.name}.`;
    this.event("split", Bubble.Move, text, b.x, b.y, [founder.id, ...(enemy ? [enemy.id] : [])], nb.id, why === "crowd" ? 0 : 1);
    this.layoutHomes(b); this.layoutHomes(nb);
  }

  /**
    Going to live with kin. When a band is going hungry, a household that knows a band of
    its own people that is eating well may pack up and join them, as families did between
    the bands of one people. Those with close kin there, or who are fond of people there,
    go first.
  */
  private weighLeave(b: Band, ms: Person[], adults: Person[]): void {
    const deficit = Math.max(0, 1 - (b.yesterday.plant + b.yesterday.meat + b.yesterday.fish) / Math.max(1, b.appetite));
    if (deficit < 0.45 || storeDays(b) > 0.6 || ms.length < 6) return;
    const seen = new Set<number>();
    for (const q of adults) {
      const home = homeOf(q, this.byId, this.time); if (seen.has(home)) continue; seen.add(home);
      if (q.partner && this.byId.get(q.partner)?.band !== b.id) continue;
      /* a family that has only just come gives the place a chance before packing up again */
      if (this.time - q.joined < DAY_SECONDS * 20) continue;
      /* the leader's household stays and sees the band through */
      if (b.respected && homeOf(this.byId.get(b.respected) ?? q, this.byId, this.time) === home && this.byId.get(b.respected)?.band === b.id) continue;
      let best: Band | null = null, bv = 0;
      for (const pl of q.places) {
        if (pl.k !== Place.Camp || pl.ref === b.id) continue;
        const o = this.bandById.get(pl.ref); if (!o || o.moving) continue;
        const d = Math.hypot(o.x - q.x, o.y - q.y); if (d > 130 || !this.walkable(b.x, b.y, o.x, o.y)) continue;
        const ties = o.members.reduce((t, id) => t + Math.max(0, this.op(q, id)) + (this.kin(q, this.byId.get(id) ?? { id: 0, mother: 0, father: 0 }, 1) ? 1 : 0), 0);
        const v = (storeDays(o) - 0.5) * (o.culture === b.culture ? 1 : 0.3) * (1 + ties * 0.4) * (1 - d / 200);
        if (v > bv) { bv = v; best = o; }
      }
      if (!best || bv < 0.6 || !this.rng.chance(0.3 * deficit)) continue;
      const fam = ms.filter(o => homeOf(o, this.byId, this.time) === home);
      for (const o of fam) { this.moveTo(o, best); this.remember(o, Mem.Moved, best.id, -0.1); }
      this.event("leave", Bubble.Home, `${q.name}'s family left the hungry ${b.name} to live with the ${best.name}${best.culture === b.culture ? ", their own people" : ""}.`, b.x, b.y, fam.map(o => o.id), best.id);
      relayout(this, b); relayout(this, best);
      if (b.members.length < 6) break;
    }
  }

  /** A band whittled down to a handful seeks out kin or a band it knows, if any. */
  private weighJoin(b: Band, ms: Person[]): void {
    const known = this.bands.filter(o => o !== b && ms.some(q => q.places.some(pl => pl.k === Place.Camp && pl.ref === o.id)) && this.walkable(b.x, b.y, o.x, o.y));
    if (!known.length) return;
    const pick = known.sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
    for (const q of ms) { this.moveTo(q, pick); }
    this.stats.merges++;
    this.event("merge", Bubble.Home, `The last ${ms.length} of the ${b.name} went to live with the ${pick.name}.`, b.x, b.y, ms.map(q => q.id), pick.id);
    if (this.bandById.has(b.id)) this.endBand(b, "joined another band", false);
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
    /* clothes in the band's colors, chosen to stand out against the wearer's skin */
    const pick = (opts: string[]) => { const sl = lum(skinHex(p.looks.mel)); let best = opts[0], bd = -1; for (const o of opts) { const d = Math.abs(lum(o) - sl); if (d > bd) { bd = d; best = o; } } return best; };
    const v = (p.id * 2654435761 >>> 0) % 7;
    const top = v < 3 ? pick([c.hide, c.hideD]) : pick([c.dyes[v % 3], c.hide, c.hideD]);
    const bottom = pick([c.hideD, c.hide, c.dyes[(v + 1) % 3]]);
    const trim = c.dyes.find(d => d !== top) ?? c.dyes[0];
    return {
      id: p.id, name: p.name, sex: p.sex, stage: st, band: p.band,
      skin: p.looks.mel, hair: h.hex, gray: h.gray, style, beard: p.sex === "m" && age >= 19 && p.looks.beard > 0.42, eye: p.looks.eye,
      wear: this.wearOf(p, st), top, bottom, beads: (p.id * 7919 % 100) / 100 < c.beads, trim, paint: st === "adult" || st === "teen" ? c.paint : 0,
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
      if (this.bandById.get(p.band)?.respected === p.id) flags |= PFlag.Leader;
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
      /* a drying rack beside each household with meat on it, and one by the fire for the pot's */
      const racks: number[] = [];
      for (const [head, h] of b.hearths) if (h.dried >= 1) { const at = b.homes.get(head); if (at) racks.push(at[0] + 1.3, at[1] + 0.1); }
      if (b.store.dried >= 2) racks.push(b.x - 2.2, b.y + 1);
      return { id: b.id, name: b.name, x: b.x, y: b.y, color: b.color, pop: b.members.length, fire: b.fire, shelters: sh, shelter: this.cultures[b.culture].shelter, food: Math.round(campFood(b)), racks };
    });
  }
  worksSnap(): WorkSnap[] { return this.works.map(w => ({ id: w.id, kind: w.kind, x: w.x, y: w.y, wx: w.wx, wy: w.wy, state: Math.round(w.state * 20) / 20, food: Math.round(w.food), crop: w.crop })); }

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
function followersIn(s: Society, b: Band, p: Person): number { let n = 0; for (const id of b.members) { const q = s.byId.get(id); if (q && q !== p && q.follows === p.id) n++; } return n; }
export function compass(dx: number, dy: number): string {
  const a = Math.atan2(dy, dx) * 180 / Math.PI, d = ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"];
  return d[Math.round(((a + 360) % 360) / 45) % 8];
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Perceived lightness of a color, 0..1. */
function lum(hex: string): number { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
export { SPECIES_NAMES };
