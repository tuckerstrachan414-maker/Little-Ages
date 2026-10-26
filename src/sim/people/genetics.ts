import type { Rng } from "../../shared/rng.ts";

/*
  Genes. Every person carries two copies of each locus, one from each parent, and a child
  gets one copy from each parent at random. Visible traits add up over many loci the way
  real ones do: skin tone, how dark the hair is, how much it curls, height and build are
  polygenic, so a child of a dark-skinned and a light-skinned parent lands in between and
  siblings each come out a little different. Red hair and blue eyes are recessive, so they
  can skip a generation and reappear. Temperament is partly heritable too, and the rest
  comes from chance and from life.
*/

/** Loci per trait. Each locus is two alleles, 0 or 1; a 1 pushes the trait up. */
export const LOCI = {
  skin: 12, hairDark: 6, red: 1, curl: 5, eyeBlue: 1, eyeMod: 3, height: 10, build: 5, beard: 3, bald: 2, gray: 2,
  /* bravery, kindness, greed, ambition, curiosity, sociability, temper, diligence */
  temper: 8 * 4,
} as const;
type TraitKey = keyof typeof LOCI;
const OFFSET: Record<TraitKey, number> = {} as Record<TraitKey, number>;
let total = 0;
for (const k of Object.keys(LOCI) as TraitKey[]) { OFFSET[k] = total; total += LOCI[k]; }
export const N_LOCI = total;
/** Index of a trait's first locus in the genome. */
export const locusOf = (key: TraitKey) => OFFSET[key];

export const TRAITS = ["bravery", "kindness", "greed", "ambition", "curiosity", "sociability", "temper", "diligence"] as const;
export type Trait = (typeof TRAITS)[number];
export const T = { bravery: 0, kindness: 1, greed: 2, ambition: 3, curiosity: 4, sociability: 5, temper: 6, diligence: 7 } as const;

/** Allele frequencies a founding population starts with, one per trait (temper: one per personality trait). */
export interface Ancestry {
  skin: number; hairDark: number; red: number; curl: number; eyeBlue: number; eyeMod: number;
  height: number; build: number; beard: number; bald: number; gray: number; temper: number[];
}

/** Two alleles per locus, stored side by side. */
export type Genome = Uint8Array;

function fill(g: Genome, key: TraitKey, p: number, rng: Rng, from = 0, count: number = LOCI[key]) {
  const o = OFFSET[key] + from;
  for (let l = 0; l < count; l++) { g[(o + l) * 2] = rng.chance(p) ? 1 : 0; g[(o + l) * 2 + 1] = rng.chance(p) ? 1 : 0; }
}

/** A founder drawn from an ancestry: every allele independently, so the band starts in Hardy-Weinberg balance. */
export function founderGenome(a: Ancestry, rng: Rng): Genome {
  const g = new Uint8Array(N_LOCI * 2);
  fill(g, "skin", a.skin, rng); fill(g, "hairDark", a.hairDark, rng); fill(g, "red", a.red, rng); fill(g, "curl", a.curl, rng);
  fill(g, "eyeBlue", a.eyeBlue, rng); fill(g, "eyeMod", a.eyeMod, rng); fill(g, "height", a.height, rng); fill(g, "build", a.build, rng);
  fill(g, "beard", a.beard, rng); fill(g, "bald", a.bald, rng); fill(g, "gray", a.gray, rng);
  for (let t = 0; t < 8; t++) fill(g, "temper", a.temper[t], rng, t * 4, 4);
  return g;
}

/** One copy of each locus from each parent, chosen at random, with a rare mutation. */
export function inherit(mother: Genome, father: Genome, rng: Rng, mutation = 0.0015): Genome {
  const g = new Uint8Array(N_LOCI * 2);
  for (let l = 0; l < N_LOCI; l++) {
    g[l * 2] = mother[l * 2 + (rng.next() < 0.5 ? 0 : 1)];
    g[l * 2 + 1] = father[l * 2 + (rng.next() < 0.5 ? 0 : 1)];
  }
  if (mutation > 0) for (let i = 0; i < g.length; i++) if (rng.next() < mutation) g[i] ^= 1;
  return g;
}

/** Share of "up" alleles across a trait's loci, 0..1. */
export function dose(g: Genome, key: TraitKey, from = 0, count: number = LOCI[key]): number {
  const o = OFFSET[key] + from; let s = 0;
  for (let l = 0; l < count; l++) s += g[(o + l) * 2] + g[(o + l) * 2 + 1];
  return s / (count * 2);
}
const homozygous = (g: Genome, key: TraitKey) => { const o = OFFSET[key] * 2; return g[o] === 1 && g[o + 1] === 1; };
/** Carries at least one copy of a recessive allele (shows in the family, not always in the person). */
export const carries = (g: Genome, key: "red" | "eyeBlue") => { const o = OFFSET[key] * 2; return g[o] + g[o + 1] > 0; };

/*
  What the genes build. Environment adds noise at birth (`noise` is fixed per person so
  the same person always looks the same) and childhood hunger stunts height.
*/
export interface Looks {
  /** skin melanin 0 (very fair) .. 1 (very dark) */
  mel: number;
  /** hair eumelanin 0 (blond) .. 1 (black), before age and redness */
  hairEu: number;
  red: boolean;
  /** 0 straight .. 1 tightly coiled */
  curl: number;
  eye: string;
  eyeName: string;
  /** genetic height potential, -1..1 around the average for one's sex */
  heightG: number;
  /** 0 slight .. 1 broad */
  build: number;
  beard: number;
  bald: number;
  /** how early hair goes gray, 0 late .. 1 early */
  grayEarly: number;
}

export function looksOf(g: Genome, noise: number[]): Looks {
  const mel = clamp01(0.02 + 0.96 * dose(g, "skin") + noise[0] * 0.035);
  /* darker skin carries darker hair with it; blond hair needs both light skin and light-hair alleles */
  const hairEu = clamp01(dose(g, "hairDark") * 0.78 + mel * 0.34 - 0.04 + noise[1] * 0.06);
  const red = homozygous(g, "red") && hairEu < 0.78;
  const blue = homozygous(g, "eyeBlue"), mod = dose(g, "eyeMod");
  let eye: string, eyeName: string;
  if (blue) [eye, eyeName] = mod < 0.34 ? ["#3f6fa8", "blue"] : mod < 0.67 ? ["#687a86", "gray"] : ["#4d6e3e", "green"];
  else if (mel < 0.42 && mod > 0.66) [eye, eyeName] = ["#5e4a26", "hazel"];
  else if (mel < 0.55 && mod > 0.4) [eye, eyeName] = ["#3c2616", "brown"];
  else [eye, eyeName] = ["#231710", "dark brown"];
  return {
    mel, hairEu, red, eye, eyeName,
    curl: clamp01(dose(g, "curl") + noise[2] * 0.08),
    heightG: (dose(g, "height") - 0.5) * 2 + noise[3] * 0.12,
    build: clamp01(dose(g, "build") + noise[4] * 0.1),
    beard: dose(g, "beard"), bald: dose(g, "bald"), grayEarly: dose(g, "gray"),
  };
}

/** Inborn temperament, 0..1 each: about two fifths genes, the rest the luck of the draw. */
export function temperament(g: Genome, rng: Rng): number[] {
  const out: number[] = [];
  for (let t = 0; t < 8; t++) out.push(clamp01(0.5 + (dose(g, "temper", t * 4, 4) - 0.5) * 0.64 + rng.gauss() * 0.14));
  return out;
}

/* ---------- colors and words ---------- */

const SKIN_STOPS: [number, string][] = [[0, "#f7dccb"], [0.18, "#efc3a3"], [0.36, "#d9a277"], [0.54, "#b47b50"], [0.72, "#8a5634"], [0.88, "#64391f"], [1, "#452616"]];
/** Field Notes skin ramp from melanin (the style board's ramp, slightly desaturated for the palette). */
export function skinHex(mel: number): string {
  let i = 0; while (i < SKIN_STOPS.length - 2 && mel > SKIN_STOPS[i + 1][0]) i++;
  const [a, ca] = SKIN_STOPS[i], [b, cb] = SKIN_STOPS[i + 1];
  return desat(mixHex(ca, cb, clamp01((mel - a) / (b - a))), 0.9);
}
export function skinWord(mel: number): string {
  return mel < 0.12 ? "very fair" : mel < 0.26 ? "fair" : mel < 0.4 ? "light brown" : mel < 0.54 ? "olive brown" : mel < 0.68 ? "brown" : mel < 0.84 ? "dark brown" : "deep brown";
}

const HAIR_STOPS: [number, string][] = [[0, "#e3c47a"], [0.2, "#c9a35c"], [0.38, "#9a7448"], [0.55, "#6a4428"], [0.72, "#3d2618"], [0.86, "#2a1c16"], [1, "#1c1614"]];
const RED_STOPS: [number, string][] = [[0, "#d98a4a"], [0.35, "#b8582c"], [0.6, "#8b3f24"], [0.78, "#6a3220"]];
function ramp(stops: [number, string][], v: number): string {
  let i = 0; while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
  const [a, ca] = stops[i], [b, cb] = stops[i + 1];
  return mixHex(ca, cb, clamp01((v - a) / (b - a)));
}
/** Hair color at a given age: children's hair darkens as they grow, and it grays with age. */
export function hairAt(l: Looks, age: number): { hex: string; gray: number; eu: number } {
  const darken = age < 12 ? 0.8 + age / 60 : 1;
  const eu = clamp01(l.hairEu * darken);
  const base = l.red ? ramp(RED_STOPS, eu) : ramp(HAIR_STOPS, eu);
  const start = 44 - l.grayEarly * 14;
  const gray = clamp01((age - start) / 26);
  return { hex: base, gray, eu };
}
export function hairWord(l: Looks, age: number): string {
  const h = hairAt(l, age);
  if (h.gray > 0.75) return "white";
  if (h.gray > 0.4) return "gray";
  if (l.red) return h.eu < 0.3 ? "strawberry blond" : h.eu < 0.55 ? "red" : "auburn";
  return h.eu < 0.2 ? "blond" : h.eu < 0.36 ? "dark blond" : h.eu < 0.52 ? "light brown" : h.eu < 0.68 ? "brown" : h.eu < 0.82 ? "dark brown" : "black";
}
export function curlWord(c: number): string { return c < 0.28 ? "straight" : c < 0.5 ? "wavy" : c < 0.72 ? "curly" : "tightly coiled"; }

/** Adult height in centimeters: genes, sex, and how well fed the childhood was (0..1 hunger). */
export function heightCm(l: Looks, sex: "f" | "m", childHunger: number): number {
  return Math.round((sex === "m" ? 166 : 155) + l.heightG * 26 - childHunger * 7);
}
export function heightWord(cm: number, sex: "f" | "m"): string {
  const d = cm - (sex === "m" ? 166 : 155);
  return d < -9 ? "very short" : d < -4 ? "short" : d <= 4 ? "of middling height" : d <= 9 ? "tall" : "very tall";
}
export function buildWord(b: number): string { return b < 0.3 ? "slight" : b < 0.48 ? "lean" : b < 0.66 ? "sturdy" : "broad"; }

/* ---------- founders that fit the land ---------- */

/**
  An ancestry for a people who have long lived at a place. `uv` is how strong the sun is
  (1 at the equator, near 0 at the poles), `cold` how harsh the winters are, `warm` how
  hot the summers. Skin, hair and eyes follow sunlight the way they do on Earth; stockier
  builds follow the cold. Hair curl and height vary from people to people by chance.
*/
export function ancestryFor(uv: number, cold: number, warm: number, rng: Rng): Ancestry {
  const g = () => rng.gauss();
  const north = 1 - uv;
  return {
    skin: clamp(0.04 + 0.92 * Math.pow(uv, 1.25) + g() * 0.05, 0.02, 0.98),
    hairDark: clamp(0.96 - 0.62 * north * north + g() * 0.05, 0.25, 0.99),
    red: north > 0.55 ? clamp(0.06 + (north - 0.55) * 0.7 * rng.range(0.4, 1.3), 0, 0.45) : rng.range(0, 0.03),
    curl: clamp(0.12 + 0.62 * warm * rng.range(0.4, 1.35) + g() * 0.08, 0.02, 0.95),
    eyeBlue: north > 0.4 ? clamp(Math.pow((north - 0.4) / 0.5, 1.4) * rng.range(0.55, 1.1), 0, 0.9) : rng.range(0, 0.04),
    eyeMod: clamp(0.3 + north * 0.3 + g() * 0.08, 0.05, 0.9),
    height: clamp(0.5 + g() * 0.09, 0.25, 0.75),
    build: clamp(0.34 + cold * 0.34 + g() * 0.07, 0.1, 0.9),
    beard: clamp(0.5 + g() * 0.15, 0.15, 0.85),
    bald: clamp(0.35 + g() * 0.1, 0.1, 0.6),
    gray: clamp(0.5 + g() * 0.08, 0.2, 0.8),
    temper: Array.from({ length: 8 }, () => clamp(0.5 + g() * 0.04, 0.35, 0.65)),
  };
}

/** The skin tone the sun at a place favors, for slow selection over many generations. */
export const idealMel = (uv: number) => clamp01(0.04 + 0.92 * Math.pow(uv, 1.25));

/* ---------- tiny color helpers (kept here so the worker needs no DOM) ---------- */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
function hex2rgb(h: string): [number, number, number] { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function rgb2hex(r: number, g: number, b: number): string { return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
export function mixHex(a: string, b: string, t: number): string { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function desat(hex: string, k: number): string { const [r, g, b] = hex2rgb(hex), m = (r + g + b) / 3; return rgb2hex(m + (r - m) * k, m + (g - m) * k, m + (b - m) * k); }
