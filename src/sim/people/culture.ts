import { Rng } from "../../shared/rng.ts";
import type { HairStyle, HutStyle, Wear } from "../../shared/people.ts";
import { makeLanguage, type Language } from "./language.ts";

/*
  A culture is what a people does by habit and passes to its children: the language, how
  they dress and dye their clothes, how they wear their hair, what shelters they raise,
  how freely they share food, and where a new couple goes to live. None of it is fixed:
  later milestones let it drift and blend. Each band carries its people's culture.
*/

export interface Culture {
  id: number;
  lang: Language;
  /** colors of worked hide (light and dark), and the dyes used for clothes, trim and beads */
  hide: string; hideD: string; dyes: string[];
  /** body paint worn on bare skin: 0 none, 1 ochre stripes, 2 white clay dots */
  paint: number;
  /** what people wear when it is hot, and when it is mild (by sex) */
  hotWear: Wear; mildF: Wear; mildM: Wear;
  /** how strongly each hairstyle is favored, by sex */
  hairF: Partial<Record<HairStyle, number>>; hairM: Partial<Record<HairStyle, number>>;
  beads: number;
  shelter: "tent" | "leanto" | "dome";
  /** the huts they raise once they stay: round huts from those who bend domes, longhouses from lean-to builders, tall cones from tent makers */
  hut: HutStyle;
  /** 0..1, how much of what anyone brings in is shared with the whole band */
  sharing: number;
  /** 0 couples live with the woman's band, 1 with the man's, in between either */
  locality: number;
  /** chance a child is named after a grandparent */
  namesake: number;
  /** whether first cousins may marry */
  cousins: boolean;
  /** how a people builds once it builds to last: how steep its roofs, how many windows a wall gets, how much it decorates */
  build: { pitch: number; windows: number; decor: number };
}

/* buckskin, tan, bleached and smoked hides; dyes from ochre, clay, charcoal, plants and bark */
const HIDES: [string, string][] = [["#d4b68c", "#9c7a52"], ["#c29a68", "#7e5d3c"], ["#e2d6ba", "#a8946e"], ["#b48a5e", "#6e5442"]];
const DYES = ["#b4553e", "#d1a646", "#6f8a44", "#3f3733", "#ece4d0", "#8c4a32", "#c97a3a", "#4f6a8a"];
const STYLES_F: HairStyle[] = ["long", "braids", "bun", "topknot", "wavy", "coils", "puffs", "crop", "shaggy"];
const STYLES_M: HairStyle[] = ["short", "long", "topknot", "shaggy", "crop", "braids", "coils", "bun"];

export function makeCulture(id: number, seed: number): Culture {
  const rng = new Rng(seed * 4241 + id * 977 + 5);
  const weights = (list: HairStyle[]) => { const o: Partial<Record<HairStyle, number>> = {}; for (const s of list) o[s] = Math.pow(rng.next(), 2.2) * 3 + 0.08; return o; };
  const dyes: string[] = []; while (dyes.length < 3) { const d = rng.pick(DYES); if (!dyes.includes(d)) dyes.push(d); }
  const [hide, hideD] = rng.pick(HIDES);
  const c: Culture = {
    id, lang: makeLanguage(id, seed),
    hide, hideD, dyes, paint: rng.pick([0, 0, 1, 2]),
    hotWear: rng.chance(0.55) ? "loin" : "wrap",
    mildF: rng.pick(["tunic", "dress", "wrap"] as Wear[]), mildM: rng.chance(0.7) ? "tunic" : "wrap",
    hairF: weights(STYLES_F), hairM: weights(STYLES_M),
    beads: rng.range(0.1, 0.7),
    shelter: rng.pick(["tent", "leanto", "dome"] as const),
    hut: "round",
    sharing: rng.range(0.55, 0.95),
    locality: rng.pick([0.15, 0.5, 0.5, 0.85]),
    namesake: rng.range(0, 0.35),
    cousins: rng.chance(0.45),
    build: { pitch: 1, windows: 1, decor: 1 },
  };
  c.hut = hutStyleOf(c.shelter);
  /* drawn after everything above, so the peoples of old seeds keep their looks */
  c.build = { pitch: rng.range(0.6, 1.4), windows: rng.pick([0, 1, 1, 2]), decor: rng.pick([0, 1, 1, 2]) };
  return c;
}
/** The hut style that grows out of a people's shelters. */
export const hutStyleOf = (shelter: Culture["shelter"]): HutStyle => (shelter === "dome" ? "round" : shelter === "leanto" ? "long" : "cone");

/** A hairstyle for someone: what their culture favors, among what their hair can do. */
export function pickStyle(c: Culture, sex: "f" | "m", curl: number, rng: Rng): HairStyle {
  const fits: Record<HairStyle, [number, number]> = {
    long: [0, 0.6], wavy: [0.22, 0.55], shaggy: [0.15, 0.7], bun: [0, 0.7], topknot: [0, 0.6], braids: [0, 1],
    coils: [0.6, 1], puffs: [0.55, 1], crop: [0.4, 1], short: [0, 1], bald: [0, 1],
  };
  const pref = sex === "f" ? c.hairF : c.hairM;
  const opts = (Object.keys(pref) as HairStyle[]).filter(s => curl >= fits[s][0] && curl <= fits[s][1]);
  if (!opts.length) return sex === "f" ? (curl > 0.6 ? "coils" : "long") : (curl > 0.5 ? "crop" : "short");
  let sum = 0; for (const s of opts) sum += pref[s]!;
  let r = rng.next() * sum;
  for (const s of opts) { r -= pref[s]!; if (r <= 0) return s; }
  return opts[0];
}
