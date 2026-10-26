import type { Look } from "../../shared/people.ts";
import type { Society } from "./society.ts";
import type { Person } from "./person.ts";

/*
  Finding things by name: the living and the dead, bands and their camps, whole peoples. The
  same typing reaches all of them, best match first. Plain letters match the invented
  languages' accented ones, so "kaelo" finds "Kaelo" however it is spelled.
*/

export type SearchKind = "person" | "dead" | "band" | "people" | "place";
export interface SearchItem {
  kind: SearchKind; id: number;
  title: string; sub: string;
  /** where to fly: where they are, where they died, or the camp */
  x: number; y: number;
  band: number;
  look?: Look;
}

/** Lowercase, accents and apostrophes gone. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’`]/g, "").toLowerCase();

/** 0 for no match; higher is better. Whole name, then start of name, then start of any word, then anywhere. */
export function score(name: string, q: string): number {
  if (!q) return 0;
  const n = fold(name);
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.split(/[\s-]+/).some(w => w.startsWith(q))) return 60;
  return n.includes(q) ? 30 : 0;
}

const ageWord = (age: number) => age < 1 ? `${Math.max(1, Math.round(age * 12))} months` : `${Math.floor(age)}`;
const noun = (sex: "f" | "m", age: number) => age < 16 ? (sex === "f" ? "Girl" : "Boy") : sex === "f" ? "Woman" : "Man";

export function searchWorld(s: Society, raw: string, limit = 6): SearchItem[] {
  const q = fold(raw.trim());
  /* with nothing typed, offer the people the bands listen to */
  if (!q) {
    const out: SearchItem[] = [];
    for (const b of s.bands) {
      const p = s.byId.get(b.respected);
      if (p) out.push(personItem(s, p, `listened to most in the ${b.name}`));
    }
    return out.sort((a, c) => (s.byId.get(c.id)?.prestige ?? 0) - (s.byId.get(a.id)?.prestige ?? 0)).slice(0, limit);
  }
  const hits: { sc: number; item: SearchItem }[] = [];
  const keep = (sc: number, item: SearchItem) => { if (sc > 0) hits.push({ sc, item }); };

  for (const p of s.people) keep(score(p.name, q), personItem(s, p));
  for (const a of s.archive.values()) {
    const sc = score(a.name, q);
    if (!sc) continue;
    const b = s.bandById.get(a.band);
    keep(sc - 5, { kind: "dead", id: a.id, title: a.name, sub: `${noun(a.sex, (a.died - a.born) / 2400)} of the ${b?.name ?? "wilds"}, died aged ${ageWord((a.died - a.born) / 2400)}, ${a.cause}`, x: a.x, y: a.y, band: a.band });
  }
  for (const b of s.bands) {
    const lang = s.cultures[b.culture].lang.name;
    keep(score(b.name, q) + 5, { kind: "band", id: b.id, title: `The ${b.name}`, sub: `a band of the ${lang}, ${b.members.length} ${b.members.length === 1 ? "person" : "people"}`, x: b.x, y: b.y, band: b.id });
    keep(score(b.siteName, q), { kind: "place", id: b.id, title: b.siteName, sub: `camp of the ${b.name}`, x: b.x, y: b.y, band: b.id });
  }
  for (const c of s.cultures) {
    const bs = s.bands.filter(b => b.culture === c.id);
    if (!bs.length) continue;
    const big = bs.slice().sort((a, d) => d.members.length - a.members.length)[0];
    const pop = bs.reduce((a, b) => a + b.members.length, 0);
    keep(score(c.lang.name, q) + 3, { kind: "people", id: big.id, title: `The ${c.lang.name}`, sub: `${bs.length} ${bs.length === 1 ? "band" : "bands"}, ${pop} people`, x: big.x, y: big.y, band: big.id });
  }
  hits.sort((a, b) => b.sc - a.sc || a.item.title.localeCompare(b.item.title));
  /* a few of each kind, so a common name does not bury the bands */
  const out: SearchItem[] = [], per = new Map<SearchKind, number>();
  for (const { item } of hits) {
    const n = per.get(item.kind) ?? 0;
    if (n >= limit) continue;
    per.set(item.kind, n + 1); out.push(item);
  }
  return out;
}

function personItem(s: Society, p: Person, note = ""): SearchItem {
  const age = s.age(p), b = s.band(p);
  return { kind: "person", id: p.id, title: p.name, sub: note ? `${noun(p.sex, age)}, ${ageWord(age)}, ${note}` : `${noun(p.sex, age)}, ${ageWord(age)}, of the ${b.name}`, x: p.x, y: p.y, band: p.band, look: s.look_(p) };
}

/* ---------------- relationship threads ---------------- */

export const Bond = { Couple: 0, Kin: 1, Friend: 2, Rival: 3 } as const;
export type Bond = (typeof Bond)[keyof typeof Bond];
/** Someone this far below zero in another's eyes is a rival (the tag says "can't stand"). */
export const RIVAL_OP = -0.2;
/** Threads longer than this (in tiles) are left out: a thread across the map says nothing. */
const MAX_LEN = 20;

/**
  The relationships between people in a stretch of map, as triples [a, b, bond]: couples, parents
  and children, friends who like each other back, and rivals who dislike each other back. The
  strongest are kept when there are too many to read.
*/
export function bondEdges(s: Society, view: { x0: number; y0: number; x1: number; y1: number }, cap = 600): Int32Array {
  const inView = (p: { x: number; y: number }) => p.x >= view.x0 && p.x <= view.x1 && p.y >= view.y0 && p.y <= view.y1;
  const edges: { a: number; b: number; k: Bond; w: number }[] = [];
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= MAX_LEN;
  for (const p of s.people) {
    if (!inView(p)) continue;
    const q = p.partner ? s.byId.get(p.partner) : undefined;
    if (q && p.id < q.id && near(p, q)) edges.push({ a: p.id, b: q.id, k: Bond.Couple, w: 10 });
    for (const pid of [p.mother, p.father]) {
      const o = pid ? s.byId.get(pid) : undefined;
      /* a baby on a hip is already drawn as carried */
      if (o && near(p, o) && p.carrier !== o.id) edges.push({ a: o.id, b: p.id, k: Bond.Kin, w: 6 });
    }
    for (const [oid, r] of p.rel) {
      if (oid <= p.id || oid === p.partner || oid === p.mother || oid === p.father) continue;
      const o = s.byId.get(oid);
      if (!o || !near(p, o)) continue;
      const back = o.rel.get(p.id);
      if (!back) continue;
      if (r.op > 0.55 && back.op > 0.4 && r.fam > 0.4) edges.push({ a: p.id, b: oid, k: Bond.Friend, w: 2 + r.op + back.op });
      else if (r.op < RIVAL_OP && back.op < RIVAL_OP / 2) edges.push({ a: p.id, b: oid, k: Bond.Rival, w: 3 - r.op - back.op });
    }
  }
  edges.sort((a, b) => b.w - a.w);
  const n = Math.min(cap, edges.length), out = new Int32Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = edges[i].a; out[i * 3 + 1] = edges[i].b; out[i * 3 + 2] = edges[i].k; }
  return out;
}
