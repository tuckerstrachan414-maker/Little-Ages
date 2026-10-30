import { DAYS_PER_YEAR, DAY_SECONDS } from "../../shared/types.ts";
import { Goal, type Person } from "./person.ts";
import { abandon } from "./doing.ts";
import { idealMel } from "./genetics.ts";
import { knows } from "./ideas.ts";
import { techIx } from "../tech/tree.ts";
import { dietScore } from "../economy/diet.ts";
import { buildingsNear } from "../buildings/build.ts";
import { Line } from "../buildings/defs.ts";
import type { Society } from "./society.ts";
import type { Band } from "./band.ts";
import type { Stage } from "../../shared/people.ts";

/*
  Illness and the ordinary dangers of life. The chance of falling seriously ill each day
  follows the age pattern of forager life (high for infants, low for young adults, rising
  again in old age), worse for the hungry, the cold, the badly fed, and the crowded: a
  camp of many households fouls its ground and its water unless there is a well. A sick
  person tended by someone who knows which herbs ease a fever is likelier to pull through.
*/

const HERB = () => techIx("herb-lore");
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function illness(s: Society, p: Person, age: number, st: Stage): void {
  const rng = s.rng;
  if (p.sick > 0) {
    /* someone at their side now, or at any hour of the day gone by */
    const tender = s.near(p.x, p.y, 2.5).find(q => q !== p && q.goal === Goal.Tend);
    const tended = !!tender || (p.tendedAt > 0 && s.time - p.tendedAt < DAY_SECONDS), herbs = (!!tender && knows(tender, HERB())) || (p.herbsAt > 0 && s.time - p.herbsAt < DAY_SECONDS);
    if (herbs) s.stats.health.tended++;
    if (p.sick > 1) { if (tended && rng.chance(herbs ? 0.35 : 0.15)) p.sick = 0.8; }
    else p.sick = Math.max(0, p.sick - (0.2 + (p.food > 0.6 ? 0.1 : 0) + (tended ? 0.06 : 0) + (herbs ? 0.12 : 0)));
    return;
  }
  const hazard = 0.15 * Math.exp(-0.9 * age) + 0.006 + 0.00011 * Math.exp(0.088 * age);
  let stress = 1 + (p.food < 0.4 ? 1.2 : 0) + (p.warmth < 0.4 ? 0.8 : 0);
  /* the sun at home favors the skin tone suited to it, very slowly, through children's health */
  if (age < 5) { const uv = s.climateAt(p.x, p.y).uv; stress += Math.pow(Math.abs(p.looks.mel - idealMel(uv)), 2) * 0.6; }
  /* one kind of food alone wears the body down; a camp of more people than a band fouls its ground and its water, half as much with a well to drink from */
  stress += (1 - dietScore(p)) * 0.4;
  stress += crowding(s, s.band(p));
  if (rng.chance(hazard * stress * 3 / DAYS_PER_YEAR)) {
    const deadly = rng.chance(0.33 + (st === "elder" ? 0.2 : 0));
    p.sick = deadly ? 1.5 : 0.8;
    if (st !== "baby" && st !== "toddler") abandon(s, p);
  }
}

/** The illness stress of a crowded camp: nothing up to thirty people within sixteen tiles of it, rising to one at ninety; half as much with a well to drink from. */
export function crowding(s: Society, b: Band): number {
  const crowd = clamp01((b.crowd - 30) / 60);
  return crowd > 0.02 ? crowd * (buildingsNear(s, b.x, b.y, 12, Line.Well).length ? 0.5 : 1) : 0;
}
