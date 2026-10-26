/*
  Runs a world with no window and reports how life on it changes, season by season.
  npm run sim -- --size medium --seed 7 --years 10 --start bands --bands 12
  Add --wild to watch the wildlife alone, without people. The same seed always gives the
  same report, which is how determinism is checked.
*/
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { Birds, Bird } from "../src/sim/birds.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, SEASON_NAMES, SPECIES_NAMES, type SizeKey } from "../src/shared/types.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const size = arg("size", "medium") as SizeKey, seed = +arg("seed", "7"), years = +arg("years", "2");
const start = arg("start", "bands") as "bands" | "cradle", nBands = +arg("bands", "12"), wildOnly = process.argv.includes("--wild");

const t0 = performance.now();
const world = generateWorld(size, seed, () => {});
const eco = new Ecology(world, seed), wild = new Wildlife(world, seed, eco), birds = new Birds(world, seed);
if (!process.argv.includes("--raw")) { const t = performance.now(); settle(wild, eco, 8, () => {}); console.log(`the wild settled for 8 years in ${((performance.now() - t) / 1000).toFixed(1)}s`); }
console.log(`${size} world, seed ${seed}: ${world.w}x${world.h}, ${(world.landFraction * 100).toFixed(1)}% land, made in ${(world.genMs / 1000).toFixed(1)}s`);

let time = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS, lastDay = -1;
const people = wildOnly ? null : new Society(world, eco, wild, seed, { start, bands: nBands }, time);
if (people) {
  console.log(`${start === "cradle" ? "One cradle" : "Scattered peoples"}: ${people.people.length} people in ${people.bands.length} bands of ${people.cultures.length} peoples`);
  for (const c of people.cultures) {
    const bs = people.bands.filter(b => b.culture === c.id), ms = bs.flatMap(b => b.members.map(id => people.byId.get(id)!));
    console.log(`  the ${c.lang.name}: ${bs.map(b => b.name).join(", ")}; ${ms.length} people, mean skin ${mean(ms.map(p => p.looks.mel)).toFixed(2)}; names like ${ms.slice(0, 4).map(p => p.name).join(", ")}`);
  }
}
function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

const seasonAt = (t: number) => Math.floor(t / DAY_SECONDS / DAYS_PER_SEASON) % 4;
const report = (label: string) => {
  const by = new Array(SPECIES_NAMES.length).fill(0);
  for (const h of wild.herds) by[h.sp] += h.n;
  const geese = birds.flocks.filter(f => f.kind === Bird.Goose), tot = eco.total();
  const lat = geese.reduce((a, f) => a + Math.abs(f.y / world.h - 0.5) * 2, 0) / Math.max(1, geese.length);
  let line = `${label.padEnd(16)} ${SPECIES_NAMES.map((n, k) => `${n.split(" ").pop()} ${by[k]}`).join(", ")} | rabbits ~${tot.rabbits} fish ~${tot.fish} | geese lat ${lat.toFixed(2)}`;
  if (people) {
    const s = people.stats, ad = people.people.filter(p => people.age(p) >= 16);
    line += `\n${"".padEnd(16)} people ${people.people.length} (${ad.length} adults) in ${people.bands.length} bands | born ${s.births}, died ${s.deaths} [${[...s.causes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}] | couples ${s.couples}, moves ${s.moves}, splits ${s.splits}, merges ${s.merges}, contacts ${s.contacts} | mood ${mean(people.people.map(p => p.mood)).toFixed(2)}`;
  }
  console.log(line);
};

const tr = performance.now();
let lastSeason = seasonAt(time);
report(`Y1 ${SEASON_NAMES[lastSeason]}`);
const end = time + years * 4 * DAYS_PER_SEASON * DAY_SECONDS, dt = people ? 2 : 1;
while (time < end) {
  time += dt;
  const s = seasonAt(time), day = Math.floor(time / DAY_SECONDS);
  wild.update(dt, s, day); birds.update(dt, s);
  if (day !== lastDay) { lastDay = day; eco.daily(s); }
  people?.update(dt, time, s);
  if (s !== lastSeason) { lastSeason = s; if (s === 0 || years <= 3) report(`Y${Math.floor(day / (4 * DAYS_PER_SEASON)) + 1} ${SEASON_NAMES[s]}`); }
}
if (people) {
  const s = people.stats, k = s.kills;
  console.log(`\nAfter ${years} years: ${people.people.length} people in ${people.bands.length} bands (most ever ${s.maxPop}).`);
  console.log(`Food brought in: ${Math.round(s.food.plant)} plant, ${Math.round(s.food.meat)} meat, ${Math.round(s.food.fish)} fish, ${Math.round(s.food.small)} small game. Kills: ${SPECIES_NAMES.map((n, i) => k[i] ? `${k[i]} ${n.toLowerCase()}` : "").filter(Boolean).join(", ")}.`);
  console.log(`Skills passed on by watching: ${s.learned}. Animal attacks on people: ${s.attacks}.`);
  for (const c of people.cultures) {
    const ms = people.people.filter(p => people.cultures[people.bandById.get(p.band)!.culture] === c);
    if (ms.length) console.log(`  the ${c.lang.name}: ${ms.length} people in ${people.bands.filter(b => b.culture === c.id).length} bands, mean skin ${mean(ms.map(p => p.looks.mel)).toFixed(2)}, mean height gene ${mean(ms.map(p => p.looks.heightG)).toFixed(2)}`);
  }
  const ev = people.events.slice(-8);
  console.log("Lately:"); for (const e of ev) console.log(`  - ${e.text}`);
}
console.log(`simulated ${years} years in ${((performance.now() - tr) / 1000).toFixed(1)}s (${((performance.now() - t0) / 1000).toFixed(1)}s in all)`);
