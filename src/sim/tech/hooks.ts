import { DAY_SECONDS } from "../../shared/types.ts";
import { Mem, St, type Person } from "../people/person.ts";
import { keepingDays } from "../people/band.ts";
import type { Society } from "../people/society.ts";
import { Idea, techIx, type TechHooks } from "./tree.ts";
import { genericPressure } from "./engine.ts";
import { TECHS } from "./tree.ts";

/*
  What the data cannot say: for a few nodes, how badly someone needs them right now and the
  story of the moment they came, written by hand. The first discoveries keep the formulas and
  the words they have always had, here, so that nothing about how they come changes.
*/

const she = (p: Person) => (p.sex === "f" ? "she" : "he");
const She = (p: Person) => (p.sex === "f" ? "She" : "He");
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** How far the band's pot is short of a couple of days' food. */
const potShort = (s: Society, p: Person) => { const b = s.band(p); return clamp01(1 - (b.appetite > 0 ? (b.store.plant + b.store.meat + b.store.fish + b.store.dried) / b.appetite : 9) / 2); };
const stayAt = (s: Society, p: Person) => clamp01((s.time - s.band(p).movedAt) / (DAY_SECONDS * 25));

export const HOOKS: Partial<Record<number, TechHooks>> = {
  /* dogs: someone with wolf pups grown at the hearth needs no other want to see what they are; without them, only the band's wants and wolves about speak for it */
  [techIx("taming-dogs")]: { pressure(s, p, _k, c) { const d = TECHS[techIx("taming-dogs")]; return c.pups ? Math.max(0.5, genericPressure(s, p, d, c)) : c.wolves ? genericPressure(s, p, d, c) * 0.5 : 0; } },
  [Idea.MakeFire]: {
    pressure(s, p, k) {
      const b = s.band(p), out = b.fire <= 0;
      const fireLost = p.mem.some(m => m.k === Mem.FireOut && s.time - m.t < DAY_SECONDS * 30);
      if (k === St.Kindle) return 1;
      return out ? (k === St.Knap ? 0.8 : 0.4) : fireLost ? 0.25 : 0.03;
    },
    story(s, p, k) {
      const b = s.band(p), T = s.tempC(b.x, b.y);
      return k === St.Kindle
        ? `${p.name} of the ${b.name} was trying to bring back the dead fire${T < 6 ? " in the cold" : ""}, twirling a stick hard into a notch of dry wood, when smoke curled up and the tinder caught. ${She(p)} can make fire from nothing.`
        : k === St.Knap ? `${p.name} of the ${b.name} was striking stones${b.fire <= 0 ? " by the cold hearth" : ""} when a spark leapt into a tuft of dry moss and caught. ${She(p)} can make fire from nothing.`
        : `${p.name} of the ${b.name} was boring holes with a stick when the wood grew hot enough to smoke. ${She(p)} worked out how to make fire from nothing.`;
    },
  },
  [Idea.Blades]: {
    pressure(_s, p, k) { const hungry = clamp01(1 - p.food / 1.4); return k === St.Knap ? 0.2 + (p.spear <= 0 ? 0.4 : 0) + hungry * 0.2 : 0.1; },
    story(s, p) { return `${p.name} of the ${s.band(p).name} was knapping a spear point when ${she(p)} found that a core struck just so gives long, keen blades: better points that break less, and knives that cut clean.`; },
  },
  [Idea.Axe]: {
    pressure(s, p) { const b = s.band(p), T = s.tempC(p.x, p.y); return 0.1 + (T < 8 ? 0.35 : 0) + (b.store.wood < 2 ? 0.3 : 0); },
    story(s, p) { const b = s.band(p), T = s.tempC(b.x, b.y); return `${p.name} of the ${b.name}, breaking branches for the fire${T < 8 ? " against the cold" : ""}, ground a stone to an edge and bound it to a handle: an axe that fells what hands cannot break.`; },
  },
  [Idea.Digging]: {
    pressure(s, p, _k, c) { return (c.roots ? 0.45 : 0.08) + potShort(s, p) * 0.35 + (c.poor ? 0.2 : 0); },
    story(s, p, _k, c) { return `${p.name} of the ${s.band(p).name}, scrabbling for ${c.roots ? "roots in hard ground" : "food where little was to be had"}, hardened a stick in the fire and dug with it. Roots and tubers that were out of reach can be had now.`; },
  },
  [Idea.Baskets]: {
    pressure(s, p, _k, c) { return (c.full ? 0.55 : 0.08) + potShort(s, p) * 0.25; },
    story(s, p) { return `${p.name} of the ${s.band(p).name}, with more food in the patch than ${she(p)} could carry home, wove grass and reeds into a basket.`; },
  },
  [Idea.Planting]: {
    pressure(s, p) {
      /* sprouts come up where seeds were spilled at a camp lived in long enough to see it */
      const b = s.band(p);
      if (Math.hypot(p.x - b.x, p.y - b.y) > 12) return 0;
      return (0.05 + potShort(s, p) * 0.5) * (0.3 + stayAt(s, p) * 0.7) * (s.season === 0 ? 1.5 : 1);
    },
    story(s, p) { return `${p.name} of the ${s.band(p).name} noticed shoots coming up where seeds had been spilled around camp, and pushed seeds into the ground on purpose. If the band stays, they will come up.`; },
  },
  [Idea.Nets]: {
    pressure(s, p, _k, c) { return (c.poor ? 0.45 : 0.1) + potShort(s, p) * 0.35; },
    story(s, p) { return `${p.name} of the ${s.band(p).name}, catching little at the water, knotted cord into a mesh and drew it through the shallows: a net, full of fish.`; },
  },
  [Idea.Weirs]: {
    pressure(s, p, _k, c) { return c.river ? 0.35 + potShort(s, p) * 0.35 : 0.05; },
    story(s, p, _k, c) { return `${p.name} of the ${s.band(p).name} saw fish crowding the shallows of the ${c.river ? "river" : "water"} and drove in a fence of stakes to trap them: a weir that fishes while its makers sleep.`; },
  },
  [Idea.Drying]: {
    pressure(s, p, k, c) {
      const b = s.band(p), T = s.tempC(p.x, p.y);
      if (k === St.Butcher) return c.big ? 0.5 + (T > 10 ? 0.3 : 0) : 0;
      const rot = b.yesterday.spoiled / Math.max(2, b.appetite * 0.6);
      return Math.min(1, rot) * 0.8;
    },
    story(s, p, _k, c) { return `${p.name} of the ${s.band(p).name}, with ${c.big ? "more meat from the kill than anyone could eat" : "meat going bad at camp"}, cut it into thin strips and hung them over the smoke. Dried, it keeps for months.`; },
  },
  [Idea.Pits]: {
    pressure(s, p, _k, c) {
      /* the autumn's plenty, more than can be eaten before it spoils, with lean months coming and a camp lived in long enough to think of keeping it */
      const b = s.band(p), stay = stayAt(s, p);
      const lean = s.season >= 1 && s.tempC(b.x, b.y, s.time + DAY_SECONDS * 15) < 8;
      const plenty = (c.full ? 0.5 : 0.1) + Math.min(0.4, keepingDays(b) / 10);
      return plenty * (s.season === 2 ? 1 : s.season === 1 ? 0.35 : 0.12) * (lean ? 1.5 : 0.7) * (0.4 + 0.6 * stay);
    },
    story(s, p) { return `${p.name} of the ${s.band(p).name}, with more ${s.season === 2 ? "of the autumn's food" : "food"} at the hearth than the family could eat before it spoiled, dug a pit in the dry ground, lined it with bark and grass and put the food by. Kept in the ground, it lasts for months.`; },
  },
  [Idea.Huts]: {
    pressure(s, p) {
      /* fetching wood at a camp lived in long, with cold or wet weather making the old shelters miserable */
      const stay = stayAt(s, p), T = s.tempC(p.x, p.y);
      if (stay < 0.2) return 0;
      return stay * (T < 6 ? 1 : T < 14 ? 0.6 : 0.25) * (s.season >= 2 ? 1 : 0.6);
    },
    story(s, p) { const b = s.band(p), T = s.tempC(b.x, b.y); return `${p.name} of the ${b.name}, bringing in poles at a camp they had lived at a long while${T < 8 ? `, with the cold coming through the old shelter` : ""}, set them in the ground, bent and lashed them into a frame and covered it: a hut, warm and dry, that will stand when they are away.`; },
  },
};
