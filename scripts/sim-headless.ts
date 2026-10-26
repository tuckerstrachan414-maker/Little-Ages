/*
  Runs a world with no window and reports how life on it changes, season by season.
  npm run sim -- --size medium --seed 7 --years 3
  The same seed always gives the same report, which is how determinism is checked.
*/
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { Birds, Bird } from "../src/sim/birds.ts";
import { settle } from "../src/sim/settle.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, SEASON_NAMES, SPECIES_NAMES, type SizeKey } from "../src/shared/types.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const size = arg("size", "medium") as SizeKey, seed = +arg("seed", "7"), years = +arg("years", "2");

const t0 = performance.now();
const world = generateWorld(size, seed, () => {});
const eco = new Ecology(world, seed), wild = new Wildlife(world, seed, eco), birds = new Birds(world, seed);
if (!process.argv.includes("--raw")) { const t = performance.now(); settle(wild, eco, 8, () => {}); console.log(`the wild settled for 8 years in ${((performance.now() - t) / 1000).toFixed(1)}s`); }
console.log(`${size} world, seed ${seed}: ${world.w}x${world.h}, ${(world.landFraction * 100).toFixed(1)}% land, made in ${(world.genMs / 1000).toFixed(1)}s`);

const seasonAt = (t: number) => Math.floor(t / DAY_SECONDS / DAYS_PER_SEASON) % 4;
const report = (label: string) => {
  const by = new Array(SPECIES_NAMES.length).fill(0), cond = new Array(SPECIES_NAMES.length).fill(0);
  for (const h of wild.herds) { by[h.sp] += h.n; cond[h.sp] += h.cond * h.n; }
  if (process.env.COND) console.log("   condition: " + SPECIES_NAMES.map((n, k) => `${n.split(" ").pop()} ${(cond[k] / Math.max(1, by[k])).toFixed(2)}`).join(", "));
  const geese = birds.flocks.filter(f => f.kind === Bird.Goose);
  const lat = geese.reduce((a, f) => a + Math.abs(f.y / world.h - 0.5) * 2, 0) / Math.max(1, geese.length);
  const away = geese.filter(f => f.away).length, tot = eco.total();
  console.log(`${label.padEnd(16)} ${SPECIES_NAMES.map((n, k) => `${n.split(" ").pop()} ${by[k]}`).join(", ")} | herds ${wild.herds.length} | rabbits ~${tot.rabbits} fish ~${tot.fish} | geese mean latitude ${lat.toFixed(3)}, ${away}/${geese.length} flocks south for winter`);
};

let time = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS, lastDay = -1, lastSeason = seasonAt(time);
report(`Y1 ${SEASON_NAMES[lastSeason]}`);
const end = time + years * 4 * DAYS_PER_SEASON * DAY_SECONDS, dt = 1;
while (time < end) {
  time += dt;
  const s = seasonAt(time), day = Math.floor(time / DAY_SECONDS);
  wild.update(dt, s, day); birds.update(dt, s);
  if (day !== lastDay) { lastDay = day; eco.daily(s); }
  if (s !== lastSeason) { lastSeason = s; report(`Y${Math.floor(day / (4 * DAYS_PER_SEASON)) + 1} ${SEASON_NAMES[s]}`); }
}
console.log(`simulated ${years} years in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
