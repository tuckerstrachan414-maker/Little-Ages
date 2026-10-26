import { Rng } from "../../shared/rng.ts";

/*
  Invented languages. Each people gets its own sound inventory (which consonants and vowels
  it uses, how common each is), its own syllable shapes (some only ever say
  consonant-vowel, some close syllables with n, k or s) and its own habits for names.
  Every name a people gives, to children, bands and places, is built from those sounds,
  so two peoples sound different and a name tells you whose it is. Later, languages that
  split apart will drift; for now each band speaks its people's tongue.
*/

/* [spelling, how likely a language is to have it] */
const CONS: [string, number][] = [
  ["m", 0.95], ["n", 0.95], ["t", 0.92], ["k", 0.92], ["p", 0.78], ["s", 0.8], ["l", 0.66], ["r", 0.6], ["h", 0.55],
  ["w", 0.55], ["y", 0.55], ["b", 0.45], ["d", 0.45], ["g", 0.42], ["f", 0.26], ["v", 0.2], ["sh", 0.34], ["ch", 0.26],
  ["ng", 0.28], ["z", 0.16], ["kh", 0.14], ["ts", 0.12], ["th", 0.12], ["q", 0.07], ["j", 0.18], ["tl", 0.05], ["mb", 0.07], ["nd", 0.07],
];
const VOW: [string, number][] = [["a", 1], ["i", 1], ["u", 0.97], ["e", 0.8], ["o", 0.8], ["aa", 0.16], ["ii", 0.1], ["uu", 0.1], ["ai", 0.18], ["au", 0.14], ["ei", 0.12], ["y", 0.06]];
const CODAS = ["n", "m", "s", "k", "t", "l", "r", "ng", "sh", "h"];

export interface Language {
  id: number;
  /** consonants with how often each is picked */
  cons: [string, number][];
  vowels: [string, number][];
  codas: string[];
  /** chance a syllable closes with a coda */
  closed: number;
  /** chance a word starts with a bare vowel */
  vowelStart: number;
  /** name endings that lean female and male (empty if the language does not mark it) */
  femEnd: string[];
  mascEnd: string[];
  /** the people's name for themselves */
  name: string;
}

function weighted<T>(rng: Rng, list: [T, number][]): T {
  let s = 0; for (const [, w] of list) s += w;
  let r = rng.next() * s;
  for (const [v, w] of list) { r -= w; if (r <= 0) return v; }
  return list[list.length - 1][0];
}

export function makeLanguage(id: number, seed: number): Language {
  const rng = new Rng(seed * 7919 + id * 104729 + 17);
  const cons = CONS.filter(([, p]) => rng.chance(p)).map(([c]) => [c, 0.3 + rng.next() * rng.next() * 3] as [string, number]);
  while (cons.length < 7) { const c = rng.pick(CONS)[0]; if (!cons.some(([x]) => x === c)) cons.push([c, 1]); }
  /* a language that says "y" as a consonant does not also use it as a vowel */
  const vowels = VOW.filter(([v, p]) => rng.chance(p) && !(v === "y" && cons.some(([c]) => c === "y"))).map(([v]) => [v, v.length > 1 ? 0.25 : 0.6 + rng.next() * 1.4] as [string, number]);
  if (!vowels.some(([v]) => v === "a")) vowels.push(["a", 1.5]);
  const codas = CODAS.filter(c => cons.some(([x]) => x === c || (c === "ng" && x === "n")) && rng.chance(0.55));
  const closed = codas.length ? rng.range(0.06, 0.42) : 0;
  const singleVowels = vowels.filter(([v]) => v.length === 1).map(([v]) => v);
  const marks = rng.chance(0.65);
  const femEnd = marks ? pickSome(rng, singleVowels, 2) : [];
  const mascEnd = marks ? pickSome(rng, [...singleVowels.filter(v => !femEnd.includes(v)), ...codas.slice(0, 2)], 2) : [];
  const lang: Language = { id, cons, vowels, codas, closed, vowelStart: rng.range(0.03, 0.2), femEnd, mascEnd, name: "" };
  lang.name = placeName(lang, rng);
  return lang;
}
function pickSome(rng: Rng, from: string[], n: number): string[] { const a = [...from], out: string[] = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rng.next() * a.length), 1)[0]); return out; }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A word of some syllables in this language's sounds. */
export function word(l: Language, rng: Rng, syllables: number): string {
  let out = "", prevCoda = "";
  for (let s = 0; s < syllables; s++) {
    const onset = s === 0 && rng.chance(l.vowelStart) ? "" : weighted(rng, l.cons);
    /* no doubled sounds across a syllable break, and no coda running into a hard onset cluster */
    if (onset && prevCoda && (onset === prevCoda || onset.length > 1)) { out = out.slice(0, out.length - prevCoda.length); }
    out += onset + weighted(rng, l.vowels);
    prevCoda = "";
    if (rng.chance(l.closed) && s < syllables - 1 + (rng.chance(0.5) ? 1 : 0)) { const c = rng.pick(l.codas); out += c; prevCoda = c; }
  }
  return out.replace(/(.)\1\1/g, "$1$1");
}

/** A personal name. Most peoples have a few habits for girls' and boys' names, but not rules. */
export function personName(l: Language, rng: Rng, sex: "f" | "m"): string {
  let w = "";
  for (let tries = 0; tries < 12; tries++) {
    w = word(l, rng, rng.chance(0.55) ? 2 : rng.chance(0.75) ? 3 : 1);
    const ends = sex === "f" ? l.femEnd : l.mascEnd;
    if (ends.length && rng.chance(0.62)) {
      const e = rng.pick(ends), vEnd = /[aeiouy]$/.test(w), vStart = /^[aeiouy]/.test(e);
      w = vEnd && vStart ? w.replace(/[aeiouy]+$/, "") + e : vEnd || vStart ? w + e : w;
    }
    if (pronounceable(w)) break;
  }
  return cap(w);
}
/* names of three to eight letters, with a consonant somewhere and no long vowel or consonant pileups */
function pronounceable(w: string): boolean {
  return w.length >= 3 && w.length <= 8 && /[^aeiouy]/.test(w) && !/[aeiouy]{3}/.test(w) && !/[^aeiouy]{4}/.test(w) && !/(.)\1\1/.test(w) && !/^(.+)\1$/.test(w);
}

/** A name for a band, a camp or a place. */
export function placeName(l: Language, rng: Rng): string {
  let w = "";
  for (let tries = 0; tries < 12; tries++) { w = word(l, rng, rng.chance(0.55) ? 2 : 3); if (pronounceable(w)) break; }
  return cap(w);
}
