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
import { TECHS as IDEAS } from "../src/sim/tech/tree.ts";
import { MATS } from "../src/sim/economy/goods.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, SEASON_NAMES, SPECIES_NAMES, type SizeKey } from "../src/shared/types.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const size = arg("size", "medium") as SizeKey, seed = +arg("seed", "7"), years = +arg("years", "2");
const start = arg("start", "bands") as "bands" | "cradle", nBands = +arg("bands", "12"), wildOnly = process.argv.includes("--wild");
/* --summary ends with one JSON line of the numbers a balance sweep compares (see scripts/sweep.ts) */
const summary = process.argv.includes("--summary");

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
    const o = s.social, led = people.bands.filter(b => b.respected).length;
    const known = IDEAS.filter(d => !d.start && people.ideas[d.id].knowers > 0).map(d => `${d.name} ${people.ideas[d.id].knowers}`);
    const f = people.stats.fire, ki = people.stats.ideas;
    line += `\n${"".padEnd(16)} ideas: ${known.length ? known.join(", ") : "nothing new yet"} | worked out ${ki.found}, lost by a band ${ki.lost}, learned growing up ${ki.child}, watching ${ki.watch}, shown ${ki.shown}, on visits ${ki.told}, from things left ${ki.seen} | fires out ${f.out}, made ${f.kindled}, fetched ${f.embers} | ${people.works.length} weirs and plots, weir fish ${Math.round(people.stats.food.weir)}, harvest ${Math.round(people.stats.food.crop)}, dried ${Math.round(people.stats.food.dried)}`;
    {
      let huts = 0, going = 0, ruins = 0, pits = 0, inPits = 0;
      for (const w of people.works) { if (w.kind === 2) { if ((w.prog ?? 1) < 1) going++; else if (w.state < 0.2) ruins++; else huts++; } else if (w.kind === 3) { pits++; inPits += w.foods ? w.foods.plant + w.foods.meat + w.foods.fish + w.foods.dried : 0; } }
      const h = people.stats.homes, c = people.stats.camp;
      const pl = people.stats.places, live = people.villages.filter(v => !v.abandoned);
      line += `\n${"".padEnd(16)} places: ${people.gatherings.length} gatherings now (${pl.gatherings} in all), ${live.length} villages lived in${live.length ? ` (${live.map(v => `${v.name} "${v.gloss}" ${v.pop}`).join(", ")})` : ""}, ${pl.villages} founded, ${pl.abandoned} given up, ${pl.returns} returned to | fields ${people.works.filter(w => w.kind === 1 && (w.sown ?? 1) > 1).length} sown again, ${people.works.filter(w => w.kind === 1 && w.fallow).length} resting, best seed line ${Math.max(0, ...people.bands.flatMap(b => Object.values(b.seed))).toFixed(2)}`;
      const r = people.resources, rs = r.stats, known = new Set<number>(); for (const set of r.known.values()) for (const id of set) known.add(id);
      const byKind = new Map<number, number>(); for (const id of known) { const d = r.byId(id)!; byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1); }
      line += `\n${"".padEnd(16)} land: ${known.size} of ${r.deposits.length} deposits found${byKind.size ? ` (${[...byKind].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${MATS[k].name.replace(/ ore$/, "")} ${n}`).join(", ")})` : ""}, ${rs.exhausted} dug out | wood cut ${Math.round(rs.cut)} loads, ${rs.felled} trees felled, ${rs.regrown} grown back | forest left around camps ${mean(people.bands.map(b => r.forestLeft(b.x, b.y, 16))).toFixed(2)}`;
      line += `\n${"".padEnd(16)} homes: ${huts} huts standing, ${going} going up, ${ruins} fallen in (${h.huts} raised) | ${pits} pits holding ${Math.round(inPits)} (${h.pits} dug; ${Math.round(h.stored)} put by, ${Math.round(h.fetched)} fetched, ${Math.round(h.eaten)} eaten from them) | ${Math.round(c.left)} food left behind on moves, ${c.home} moves home`;
    }
    line += `\n${"".padEnd(16)} shared ${(o.shared / Math.max(1, o.shared + o.kept) * 100).toFixed(0)}% into the pot | ${Math.round(o.given)} food passed between hearths (${Math.round(o.rounds)} in the evening rounds, ${Math.round(o.family)} eaten at family hearths), ${o.asks} asked for, ${o.refused} refused, ${Math.round(o.repaid)} paid back | feuds ${o.feuds} begun (${people.feuds.length} burning, ${o.peace} settled, ${o.cooled} cooled, ${o.inherited} passed down), fights ${o.fights}, families driven out ${o.driven}, feud/faction splits ${o.factionSplits} | ${led}/${people.bands.length} bands led, new leaders ${o.leaders}, two voices ${o.contests}, mocked ${o.mocked} | gifts ${o.gifts}, left for another ${o.leftFor}`;
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
  console.log(`Things learned from others: ${s.learned}. Animal attacks on people: ${s.attacks}.`);
  for (const d of IDEAS) if (!d.start) { const log = people.ideas[d.id]; console.log(`  ${d.name}: ${log.first ? `first worked out by ${log.first.name} of the ${log.first.bandName} in year ${Math.floor(log.first.t / 2400) + 1}, ${log.knowers} know it now${log.times > 1 ? `, worked out ${log.times} times` : ""}${!log.knowers ? " (lost)" : ""}` : "not yet worked out"}`); }
  for (const c of people.cultures) {
    const ms = people.people.filter(p => people.cultures[people.bandById.get(p.band)!.culture] === c);
    if (ms.length) console.log(`  the ${c.lang.name}: ${ms.length} people in ${people.bands.filter(b => b.culture === c.id).length} bands, mean skin ${mean(ms.map(p => p.looks.mel)).toFixed(2)}, mean height gene ${mean(ms.map(p => p.looks.heightG)).toFixed(2)}`);
  }
  for (const v of people.villages) console.log(`  village ${v.name} "${v.gloss}" (named ${v.why}): founded year ${Math.floor(v.founded / 2400) + 1} when ${v.story}; ${v.abandoned ? `given up in year ${Math.floor(v.abandoned / 2400) + 1}` : `${v.pop} people now, peak ${v.peak}`}`);
  const ev = people.events.slice(-8);
  console.log("Lately:"); for (const e of ev) console.log(`  - ${e.text}`);
  const big = people.events.slice().sort((a, b) => b.sig - a.sig || a.t - b.t).slice(0, 6);
  console.log("Biggest moments (of the last " + people.events.length + " events):"); for (const e of big) console.log(`  - [${e.sig.toFixed(2)}] ${e.title}: ${e.text}`);
}
console.log(`simulated ${years} years in ${((performance.now() - tr) / 1000).toFixed(1)}s (${((performance.now() - t0) / 1000).toFixed(1)}s in all)`);
if (people) {
  const c = people.stats.camp, stays = c.stays.reduce((a, n) => a + n, 0);
  console.log(`Stays at a camp (days): ${["<5", "5-10", "10-20", "20-40", "40-80", "80+"].map((k, i) => `${k} ${c.stays[i]}`).join(", ")}; mean ${(c.stayDays / Math.max(1, stays)).toFixed(1)} | band-days at camps held 40+ days ${(c.longDays / Math.max(1, c.bandDays) * 100).toFixed(1)}% | moves to a known place ${c.offer}, into the unknown ${c.fresh}`);
  const ins = people.stats.inspire;
  console.log(`Chances to see a new way (tries, expected finds = spark x odds): ${IDEAS.filter(d => !d.start).map(d => `${d.name} ${ins.tries[d.id]} / ${(d.spark * ins.odds[d.id]).toFixed(2)}`).join(", ")}`);
}
if (people && summary) {
  const s = people.stats, c = s.camp;
  const cause = (k: string) => s.causes.get(k) ?? 0;
  const out: Record<string, number | string> = {
    seed, years, pop: people.people.length, maxPop: s.maxPop, bands: people.bands.length, births: s.births, deaths: s.deaths,
    hunger: cause("hunger"), cold: cause("the cold"), illness: cause("illness"), thirst: cause("thirst"),
    moves: s.moves, splits: s.splits, merges: s.merges,
    meanStay: +(c.stayDays / Math.max(1, c.stays.reduce((a, n) => a + n, 0))).toFixed(2), long: +(c.longDays / Math.max(1, c.bandDays)).toFixed(4),
    huts: people.works.filter(w => w.kind === 2 && (w.prog ?? 1) >= 1 && w.state >= 0.2).length, pits: people.works.filter(w => w.kind === 3).length, homeMoves: c.home, left: Math.round(c.left),
    hutsRaised: s.homes.huts, pitsDug: s.homes.pits, firstHut: s.homes.firstHut ? +(s.homes.firstHut / 2400 + 1).toFixed(1) : 0, firstPit: s.homes.firstPit ? +(s.homes.firstPit / 2400 + 1).toFixed(1) : 0,
    gatherings: s.places.gatherings, villages: s.places.villages, liveVillages: people.villages.filter(v => !v.abandoned).length, firstVillage: s.places.firstVillage ? +(s.places.firstVillage / 2400 + 1).toFixed(1) : 0,
    ideas: IDEAS.filter(d => !d.start && people.ideas[d.id].knowers > 0).map(d => d.name).join("|"),
    felled: people.resources.stats.felled, regrown: people.resources.stats.regrown, found: people.resources.stats.found, exhausted: people.resources.stats.exhausted,
    secs: +((performance.now() - tr) / 1000).toFixed(1),
  };
  console.log("SUMMARY " + JSON.stringify(out));
}
