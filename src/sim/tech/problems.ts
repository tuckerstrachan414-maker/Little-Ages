import { DAY_SECONDS } from "../../shared/types.ts";
import { Mem, Place } from "../people/person.ts";
import { keepingDays, storeDays, type Band } from "../people/band.ts";
import type { Society } from "../people/society.ts";
import type { Ctx } from "./defs.ts";
import { worksAround } from "../people/works.ts";
import { Mat } from "../economy/goods.ts";

/*
  What a band is short of, worked out once a day from numbers it already has: how thin the
  meals are, what rotted, how cold the nights, how far the water, what will not fit in the
  pits, whether there is wood to be had, how crowded the camp is, who is sick. A new way of
  doing things comes to someone only when it answers one of these. Nothing here is a
  want of the game's; it is what the people would feel.
*/

export const Problem = { Hunger: 0, Spoilage: 1, Cold: 2, Wet: 3, Water: 4, Storage: 5, Wood: 6, Crowding: 7, Carry: 8, Illness: 9, Far: 10, Fire: 11, Meat: 12, HerdLoss: 13, Dry: 14, Clay: 15, Stone: 16, Flint: 17, Broke: 18, Grain: 19, Pots: 20 } as const;
export type ProblemKey = keyof typeof Problem;
export const PROBLEM_COUNT = Object.keys(Problem).length;
export const PROBLEM_WORDS: Record<ProblemKey, string> = {
  Hunger: "with little left to eat", Spoilage: "with food going bad at camp", Cold: "with the cold coming through the shelters", Wet: "with the rain coming through",
  Water: "with the water a long walk from camp", Storage: "with more food put by than the pits could hold", Wood: "with the firewood running short", Crowding: "with the camp grown crowded",
  Carry: "with more to bring home than two arms could carry", Illness: "with sickness in the camp", Far: "with the food a long walk from camp", Fire: "with the fire dead",
  Meat: "with no meat brought in for days", HerdLoss: "after the wolves took the animals they kept", Dry: "in a dry year, with the grass gone brown",
  Clay: "where the bank was all clay", Stone: "among the loose stone of the hillside", Flint: "where flint lay about",
  Broke: "after half the pots had cracked in the fire", Grain: "with the grain of the harvest hard to chew", Pots: "with a pot of water on the fire",
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const newProblems = () => new Float32Array(PROBLEM_COUNT);

/** Once a day, for each band: how pressing each want is, 0..1. */
export function problemsDay(s: Society, b: Band): void {
  const pr = b.problems;
  const ms = b.members.map(id => s.byId.get(id)).filter((q): q is NonNullable<typeof q> => !!q);
  const adults = ms.filter(q => s.age(q) >= 16), T = s.tempC(b.x, b.y);
  pr[Problem.Hunger] = clamp01(1 - storeDays(b) / 2);
  pr[Problem.Spoilage] = clamp01(b.yesterday.spoiled / Math.max(2, b.appetite * 0.6));
  /* the cold bites harder on people sleeping in shelters than in huts */
  const inHuts = [...b.homes.values()].filter(h => h[2] > 0).length, homes = Math.max(1, b.homes.size);
  pr[Problem.Cold] = clamp01((10 - T) / 20) * (inHuts / homes < 0.5 ? 1.3 : 0.7);
  const i = (b.y | 0) * s.w.w + (b.x | 0), wetLand = s.w.biome[i] === 21 || s.w.biome[i] === 16 || s.w.biome[i] === 20;
  pr[Problem.Wet] = (wetLand ? 0.5 : 0) + ((s.season === 0 || s.season === 2) && s.w.rain[i] > 160 ? 0.3 : 0);
  if (inHuts / homes >= 0.5) pr[Problem.Wet] *= 0.2;
  pr[Problem.Water] = clamp01(Math.hypot(b.water[0] - b.x, b.water[1] - b.y) / 10 + (s.weather.moistAt(b.x, b.y) < 0.3 && !b.well ? 0.3 : 0));
  /* food that keeps, beyond what the pits can take */
  const kept = keepingDays(b) * b.appetite;
  pr[Problem.Storage] = clamp01((kept - b.pit - b.appetite * 6) / Math.max(4, b.appetite * 6));
  pr[Problem.Wood] = (b.store.wood < 2 ? 0.5 : 0) + (s.resources.forestLeft(b.x, b.y, 16) < 0.5 ? 0.4 : 0);
  let crowd = 0; for (const o of s.bands) if (Math.hypot(o.x - b.x, o.y - b.y) < 16) crowd += o.members.length;
  pr[Problem.Crowding] = clamp01(crowd / 40); b.crowd = crowd;
  pr[Problem.Carry] = clamp01(adults.reduce((n, q) => n + (q.tripYield > 4.8 ? 1 : 0), 0) / Math.max(1, adults.length));
  pr[Problem.Illness] = clamp01(ms.filter(q => q.sick > 0).length / Math.max(1, ms.length) * 4);
  let far = 0, nFar = 0; for (const q of adults) for (const pl of q.places) if (pl.k === Place.Plants || pl.k === Place.Fish || pl.k === Place.Game) { far += Math.hypot(pl.x - b.x, pl.y - b.y); nFar++; }
  pr[Problem.Far] = nFar ? clamp01(far / nFar / 20) : 0;
  pr[Problem.Fire] = b.fire <= 0 ? 1 : 0;
  pr[Problem.Meat] = clamp01((b.yesterday.meat + b.yesterday.fish > 0 ? 0 : (s.time - b.meatAt) / DAY_SECONDS) / 6);
  pr[Problem.HerdLoss] = clamp01(ms.reduce((n, q) => n + q.mem.filter(m => m.k === Mem.HerdLoss && s.time - m.t < DAY_SECONDS * 20).length, 0) / 3);
  pr[Problem.Dry] = 1 - s.weather.moistAt(b.x, b.y);
  pr[Problem.Clay] = s.resources.knownNear(b.culture, b.x, b.y, 20, "clay") ? 1 : 0;
  /* pots cracking in the fire lately; grain among the band's crops; pots at any hearth */
  pr[Problem.Broke] = b.broke ? clamp01(1 - (s.time - b.broke) / (DAY_SECONDS * 20)) : 0;
  let grain = (b.seed["wild grain"] ?? 0) > 0 ? 1 : 0;
  if (!grain) for (const w of worksAround(s, b.x, b.y, 16)) if (w.kind === 1 && w.band === b.id && w.crop === "wild grain") { grain = 1; break; }
  pr[Problem.Grain] = grain;
  let pots = 0; for (const g of b.hgoods.values()) if (g[Mat.Pots] >= 1) { pots = 1; break; }
  pr[Problem.Pots] = pots;
  pr[Problem.Stone] = s.resources.knownNear(b.culture, b.x, b.y, 20, "stone") ? 1 : 0;
  pr[Problem.Flint] = s.resources.knownNear(b.culture, b.x, b.y, 20, "flint") ? 1 : 0;
}

/** The problem a tech answers that presses hardest on this band, for the story of its finding. */
export function strongest(b: Band, weights: Partial<Record<ProblemKey, number>>): ProblemKey | null {
  let best: ProblemKey | null = null, bv = 0;
  for (const k of Object.keys(weights) as ProblemKey[]) { const v = (weights[k] ?? 0) * b.problems[Problem[k]]; if (v > bv) { bv = v; best = k; } }
  return best;
}

/** Context flags at the moment of work that stand in for a problem (a full load for Carry, a poor catch for Hunger). */
export const CTX_PROBLEMS: Partial<Record<ProblemKey, (c: Ctx) => number | undefined>> = {
  Carry: c => (c.full ? 1 : undefined),
  Broke: c => (c.broke === undefined ? undefined : c.broke ? 1 : 0),
  Illness: c => (c.sick ? 1 : undefined),
  Clay: c => (c.clayNear === undefined ? undefined : c.clayNear ? 1 : 0),
  Grain: c => (c.grain === undefined ? undefined : c.grain ? 1 : 0),
  Pots: c => (c.pots === undefined ? undefined : c.pots ? 1 : 0),
  Storage: c => (c.overflow ? 1 : undefined),
  Wet: c => (c.damp ? 1 : undefined),
  /* animals kept so long they come when called are meat that need not be hunted, whatever came in yesterday */
  Meat: c => (c.kept ? 1 : undefined),
};

/** The three wants that press hardest, in words, for a band's card. */
export function needsLine(b: Band): string {
  const atHand = new Set<ProblemKey>(["Clay", "Stone", "Flint", "Grain", "Pots"]);
  const top = [...(Object.keys(Problem) as ProblemKey[])].filter(k => !atHand.has(k)).map(k => [k, b.problems[Problem[k]]] as const).filter(([, v]) => v > 0.25).sort((a, c) => c[1] - a[1]).slice(0, 3);
  const words: Record<ProblemKey, string> = {
    Hunger: "little to eat", Spoilage: "food going bad", Cold: "cold nights", Wet: "the wet getting in", Water: "water far away", Storage: "more food than the pits hold", Wood: "firewood short",
    Crowding: "a crowded camp", Carry: "more than can be carried", Illness: "sickness", Far: "food far from camp", Fire: "no fire", Meat: "no meat lately", HerdLoss: "animals lost to wolves", Dry: "dry ground",
    Clay: "", Stone: "", Flint: "", Broke: "pots cracking in the fire", Grain: "", Pots: "",
  };
  return top.map(([k]) => words[k]).filter(Boolean).join(", ");
}
