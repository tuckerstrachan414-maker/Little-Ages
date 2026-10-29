import { TECH_COUNT } from "./tree.ts";
import type { Person } from "../people/person.ts";
import type { Society } from "../people/society.ts";

/*
  Refinement: a people gets better at a thing the more it does it, without end but ever more
  slowly. Pots crack less often, a sickle cuts cleaner, a weir traps more, a granary holds
  more, a wall stands longer. It belongs to a people, not a person: it is the sum of all the
  small tricks of the trade, passed on by teaching, and most of it goes with anyone who learns
  the thing from them or goes to live among them. Yields grow with the logarithm of it, so
  the first hundred pots teach more than the next thousand.
*/

export const newRefine = (): Float32Array => new Float32Array(TECH_COUNT);
export const newUses = (): Uint32Array => new Uint32Array(TECH_COUNT);

/** A thing done by someone who knows it: the people's refinement of it creeps up, the more the better they know it, and ever more slowly. */
export function practiced(s: Society, p: Person, ix: number, amt: number): void {
  const b = s.bandById.get(p.band); if (!b) return;
  const r = s.refine.get(b.culture), u = s.uses.get(b.culture); if (!r || !u) return;
  u[ix]++;
  r[ix] += amt * p.know[ix] * 0.3 / (1 + r[ix] / 8);
}
/** Know-how passing between peoples brings most of its refinement along: whoever learns a thing from another people, or goes to live among them, carries their way of doing it. */
export function passRefine(s: Society, from: number, to: number, ix: number): void {
  if (from === to) return;
  const a = s.refine.get(from), c = s.refine.get(to); if (!a || !c) return;
  c[ix] = Math.max(c[ix], a[ix] * 0.6);
}
/** Everything a mover knows well enough goes along to the people they join. */
export function carryRefine(s: Society, p: Person, from: number, to: number): void {
  if (from === to) return;
  for (const ix of p.knownIds) if (p.know[ix] >= 0.25) passRefine(s, from, to, ix);
}
/** How much better a people does a thing for having refined it: 1 at the start, growing with the logarithm of the level. */
export function quality(s: Society, culture: number, ix: number): number {
  const r = s.refine.get(culture);
  return r ? 1 + 0.22 * Math.log2(1 + r[ix]) : 1;
}
/** The quality of a thing done by this person, by their people. */
export function qualityOf(s: Society, p: Person, ix: number): number {
  const b = s.bandById.get(p.band);
  return b ? quality(s, b.culture, ix) : 1;
}
/** The quality of a thing a band made, by its people; 1 when the band is gone. */
export function qualityFor(s: Society, bandId: number, ix: number): number {
  const b = s.bandById.get(bandId);
  return b ? quality(s, b.culture, ix) : 1;
}
/** The most refined things in the world, for the headless report: [culture, tech, level]. */
export function mostRefined(s: Society, n = 5): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [c, r] of s.refine) for (let i = 0; i < r.length; i++) if (r[i] > 0.05) out.push([c, i, r[i]]);
  return out.sort((a, b) => b[2] - a[2]).slice(0, n);
}
