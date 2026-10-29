/// <reference lib="webworker" />
import { generateWorld } from "./world/gen.ts";
import { bake } from "./world/bake.ts";
import { Wildlife } from "./wildlife.ts";
import { Ecology, CELL } from "./ecology.ts";
import { Birds } from "./birds.ts";
import { settle } from "./settle.ts";
import { Society } from "./people/society.ts";
import { personDetail, bandDetail, villageDetail } from "./people/inspect.ts";
import { villageSnaps } from "./people/villages.ts";
import { searchWorld, bondEdges } from "./people/search.ts";
import { ideaSummary } from "./people/ideas.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, type MapMode, type Season, type WorldData } from "../shared/types.ts";
import type { ToWorker, FromWorker } from "../shared/protocol.ts";

/*
  The simulation thread. It owns the world and everything living in it, advances game time,
  and sends the page a compact snapshot ten times a second. The page only draws.
*/

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

let world: WorldData | null = null;
let wildlife: Wildlife | null = null;
let eco: Ecology | null = null;
let birds: Birds | null = null;
let people: Society | null = null;
let inspect = { person: 0, band: 0, village: 0 }, inspectAt = 0, firstLooks = true;
let bonds: { on: boolean; view: { x0: number; y0: number; x1: number; y1: number } } = { on: false, view: { x0: 0, y0: 0, x1: 0, y1: 0 } }, bondsAt = 0;
let lastDay = -1;
let time = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;   /* the first morning of summer */
let speed = 1;
let mode: MapMode = "terrain";
let lastSeason = -1;
const SETTLE_YEARS = 8;
let sentDay = -1;
let worksSent = -1, villagesSent = -1;

const seasonAt = (t: number) => (Math.floor(t / DAY_SECONDS / DAYS_PER_SEASON) % 4) as Season;
function sendBake() { if (!world) return; const s = seasonAt(time); const px = bake(world, s, mode); post({ type: "baked", season: s, mode, pixels: px }, [px.buffer]); }
const copy = <T extends Float32Array | Uint8Array>(a: T): T => a.slice() as T;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "generate") {
    world = generateWorld(m.size, m.seed, (stage, pct) => post({ type: "progress", stage, pct }));
    eco = new Ecology(world, m.seed);
    wildlife = new Wildlife(world, m.seed, eco);
    birds = new Birds(world, m.seed);
    settle(wildlife, eco, SETTLE_YEARS, p => post({ type: "progress", stage: 5, pct: p }));
    time = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS; lastSeason = seasonAt(time);
    post({ type: "progress", stage: 6, pct: 0.2 });
    people = new Society(world, eco, wildlife, m.seed, { start: m.start, bands: m.bands }, time);
    firstLooks = true; inspect = { person: 0, band: 0, village: 0 }; bonds.on = false; worksSent = -1; villagesSent = -1;
    post({ type: "progress", stage: 6, pct: 0.9 });
    const w = world;
    const out: WorldData = { ...w, elev: copy(w.elev), biome: copy(w.biome), flags: copy(w.flags), tree: copy(w.tree), temp: copy(w.temp), rain: copy(w.rain), depth: copy(w.depth) };
    post({ type: "world", world: out }, [out.elev.buffer, out.biome.buffer, out.flags.buffer, out.tree.buffer, out.temp.buffer, out.rain.buffer, out.depth.buffer]);
    sendBake(); sendFields();
  } else if (m.type === "speed") speed = m.speed;
  else if (m.type === "mode") { mode = m.mode; sendBake(); }
  else if (m.type === "settime") { time = m.time; const s = seasonAt(time); if (s !== lastSeason) { lastSeason = s; sendBake(); } }
  else if (m.type === "search") post({ type: "results", seq: m.seq, items: people ? searchWorld(people, m.q) : [] });
  else if (m.type === "bonds") { bonds = { on: m.on, view: m.view }; if (m.on) bondsAt = 0; }
  else if (m.type === "ideas") { if (people) post({ type: "ideas", list: ideaSummary(people) }); }
  else if (m.type === "inspect") { inspect = { person: m.person, band: m.band, village: m.village ?? 0 }; if (people) people.selected = m.person; inspectAt = 0; }
};

function sendFields() {
  if (!eco) return;
  const { rabbits, fish } = eco.snapshot(), t = eco.total();
  post({ type: "fields", gw: eco.gw, gh: eco.gh, cell: CELL, rabbits, fish, rabbitTotal: t.rabbits, fishTotal: t.fish }, [rabbits.buffer, fish.buffer]);
}

setInterval(() => {
  if (!world || !wildlife || !eco || !birds || !people) return;
  const dt = 0.1 * speed;
  if (dt > 0) {
    /* big steps at high speed are split so herds still turn and avoid water */
    const steps = Math.max(1, Math.ceil(dt / 2));
    for (let k = 0; k < steps; k++) {
      time += dt / steps;
      const s = seasonAt(time), day = Math.floor(time / DAY_SECONDS);
      wildlife.update(dt / steps, s, day); birds.update(dt / steps, s);
      if (day !== lastDay) { lastDay = day; eco.daily(s); }
      people.update(dt / steps, time, s);
    }
    if (Math.floor(time / DAY_SECONDS) !== sentDay) { sentDay = Math.floor(time / DAY_SECONDS); sendFields(); }
    const s = seasonAt(time); if (s !== lastSeason) { lastSeason = s; sendBake(); }
  }
  const herds = wildlife.snapshot();
  let animals = 0; for (const h of wildlife.herds) animals += h.n;
  const flocks = birds.snapshot();
  const folk = people.snapshot();
  const looks = firstLooks ? people.allLooks() : people.takeLooks(); firstLooks = false;
  const events = people.fresh; people.fresh = [];
  /* weirs fill and plots grow slowly: send them when they change, and once a game day besides */
  const wv = people.worksVersion * 1000 + Math.floor(time / DAY_SECONDS) % 1000, works = wv !== worksSent ? people.worksSnap() : undefined; worksSent = wv;
  const vv = people.villagesVersion * 1000 + Math.floor(time / DAY_SECONDS) % 1000, villages = vv !== villagesSent ? villageSnaps(people) : undefined; villagesSent = vv;
  post({ type: "tick", time, speed, herds, herdCount: wildlife.herds.length, animals, birds: flocks, flockCount: birds.flocks.length, birdCount: birds.count(),
    people: folk, peopleCount: people.people.length, camps: people.campSnaps(), looks, events, pop: people.people.length, works, villages }, [herds.buffer, flocks.buffer, folk.buffer]);
  /* the pinned tag refreshes twice a second */
  const now = performance.now();
  if (bonds.on && now - bondsAt > 700) { bondsAt = now; const edges = bondEdges(people, bonds.view); post({ type: "bonds", edges }, [edges.buffer]); }
  if (now - inspectAt > 450) {
    inspectAt = now;
    if (inspect.person) post({ type: "person", id: inspect.person, detail: personDetail(people, inspect.person) });
    if (inspect.band) post({ type: "band", id: inspect.band, detail: bandDetail(people, inspect.band) });
    if (inspect.village) post({ type: "village", id: inspect.village, detail: villageDetail(people, inspect.village) });
  }
}, 100);
