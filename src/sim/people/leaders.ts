import { DAY_SECONDS } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { Mem, type Person } from "./person.ts";
import type { Band } from "./band.ts";
import { MEAT, type Carcass, type Society } from "./society.ts";
import { close, feudOf, grievance } from "./feuds.ts";
import { SPECIES_SHORT } from "./mind.ts";

/*
  Leaders. Nobody is made leader. Every adult has someone whose word they go along with
  when the band has to decide something: a great hunter, a wise elder, their own father, or
  nobody but themselves. Whoever most of the band listens to leads it, as far as a band is
  ever led: when they want to move, the others come round; when they call a hunt, people
  answer; they are expected to share, and to settle quarrels. Leading is earned the same
  way every day. A leader who turns people away hungry, or who is outshone, loses them one
  by one, and when someone else gathers a following nearly as big, the band has two voices,
  and may split along them.

  Bands keep their leaders humble, too. Where people share freely, a proud hunter who
  carries in a big kill is teased that it is a bag of bones, so that nobody grows too big.
*/

const lg = (v: number) => Math.log1p(Math.max(0, v));

/** How much `p` would go along with `q` (or with their own judgment, when q is p). */
export function voice(s: Society, b: Band, p: Person, q: Person): number {
  if (q === p) return 0.1 + lg(p.prestige) * 0.6 + p.traits[3] * 0.35 + (s.age(p) > 45 ? 0.08 : 0);
  const aq = s.age(q);
  if (aq < 18) return -1;
  /* standing, liking, kinship, and the weight of years: a band listens to its seasoned people more than its young stars */
  let v = lg(q.prestige) * 0.55 + s.op(p, q.id) * 0.6;
  if (close(s, p, q)) v += 0.15;
  v += Math.max(-0.2, Math.min(0.35, (aq - 32) / 60));
  /* people stay with the one they have been listening to, and with the one who already leads */
  if (q.id === b.respected) v += 0.25;
  if (p.follows === q.id) v += 0.15;
  if (feudOf(s, p, q)) v -= 1;
  return v;
}

/**
  Each day, every adult settles on whose word they go along with, and the band's leader is
  whoever has the biggest following. A leader is only replaced by someone with clearly more.
*/
export function chooseLeaders(s: Society, b: Band, adults: Person[]): void {
  const count = new Map<number, number>();
  for (const p of adults) {
    let best = p, bv = voice(s, b, p, p);
    for (const q of adults) { if (q === p) continue; const v = voice(s, b, p, q); if (v > bv) { bv = v; best = q; } }
    p.follows = best.id;
    if (best !== p) count.set(best.id, (count.get(best.id) ?? 0) + 1);
  }
  const ranked = [...count].filter(([id]) => s.byId.get(id)?.band === b.id).sort((x, y) => y[1] - x[1] || (s.byId.get(y[0])!.prestige - s.byId.get(x[0])!.prestige));
  const cur = b.respected && s.byId.get(b.respected)?.band === b.id ? b.respected : 0;
  const curN = cur ? count.get(cur) ?? 0 : 0;
  const [top, topN] = ranked[0] ?? [0, 0];
  const had = b.respected;
  /* a leader is replaced only by someone with a clearly bigger following, and not in their first days */
  const settled = s.time - b.ledSince > DAY_SECONDS * 10;
  if (!top || topN < 2) { if (!curN) b.respected = 0; }
  else if (!cur || curN === 0 || (top !== cur && topN >= curN + Math.max(2, Math.ceil(curN * 0.3)) && (settled || curN < 2))) b.respected = top;
  if (b.respected !== had) b.ledSince = s.time;
  b.followers = b.respected ? count.get(b.respected) ?? 0 : 0;
  const lead = s.byId.get(b.respected);
  if (lead && had && had !== b.respected && b.followers >= 3) {
    const old = s.byId.get(had);
    if (old && old.band === b.id && old.traits[3] > 0.5) {
      s.rel(old, lead.id).op = Math.max(-1, s.op(old, lead.id) - 0.25 * old.traits[3]);
      grievance(s, old, lead, 0.45 * old.traits[3], `won the band's ear away from ${old.sex === "f" ? "her" : "him"}`);
    }
    s.stats.social.leaders++;
    for (const id of b.members) { const q = s.byId.get(id); if (q && q.follows === lead.id) s.remember(q, Mem.NiceTalk, lead.id, 0.05); }
    s.bubble(lead, Bubble.Star, 3);
    s.event("leader", Bubble.Star, `${lead.name} has become the one the ${b.name} listen to. ${b.followers} of them look to ${lead.sex === "f" ? "her" : "him"} now${old && old.band === b.id ? `, more than to ${old.name}` : old ? "" : ""}.`, lead.x, lead.y, [lead.id], b.id);
  }
  /* a second voice: someone else with a following nearly as big */
  const second = ranked.find(([id]) => id !== b.respected);
  const had2 = b.contender;
  b.contender = second && second[1] >= 3 && second[1] >= b.followers * 0.6 ? second[0] : 0;
  const c = s.byId.get(b.contender);
  if (c && lead && b.contender !== had2 && s.op(c, lead.id) < 0.15) {
    s.stats.social.contests++;
    s.event("contest", Bubble.Star, `Two voices in the ${b.name}: ${b.followers} look to ${lead.name}, and ${second![1]} to ${c.name}, who does not always agree with ${lead.sex === "f" ? "her" : "him"}.`, c.x, c.y, [c.id, lead.id], b.id);
  }
}
/** How many adults of the band listen to this person. */
export function followersOf(s: Society, p: Person): number {
  let n = 0;
  for (const id of s.band(p).members) { const q = s.byId.get(id); if (q && q !== p && q.follows === p.id) n++; }
  return n;
}

/**
  Taking a proud hunter down a peg. Where a people share freely, a hunter who is ambitious
  and not much given to kindness, carrying in a big kill, is told it is hardly worth eating.
  It halves the standing the kill would have brought. They eat it all the same.
*/
export function mock(s: Society, p: Person, c: Carcass): void {
  if (c.mocked || c.by !== p.id || MEAT[c.sp] < 60) return;
  c.mocked = true;
  const b = s.band(p), cult = s.culture(p);
  if (cult.sharing < 0.68 || p.traits[3] < 0.6 || p.traits[1] > 0.5 || p.prestige < 0.8 || !s.rng.chance(0.3)) return;
  /* once taken down a peg, they are left alone for a while */
  if (p.mem.some(m => m.k === Mem.Mocked && s.time - m.t < DAY_SECONDS * 40)) return;
  let wag: Person | null = null, wv = -1;
  for (const q of s.near(b.x, b.y, 7)) { if (q === p || q.band !== p.band || s.age(q) < 25 || close(s, q, p)) continue; const v = q.traits[5] + q.traits[6] * 0.5 + (s.age(q) > 45 ? 0.4 : 0) + s.rng.next() * 0.3; if (v > wv) { wv = v; wag = q; } }
  if (!wag) return;
  p.prestige = Math.max(0, p.prestige - MEAT[c.sp] / 240);
  s.remember(p, Mem.Mocked, wag.id, -0.15);
  s.rel(p, wag.id).op = Math.max(-1, s.op(p, wag.id) - 0.04);
  s.stats.social.mocked++;
  s.bubble(wag, Bubble.Sun, 2.5);
  const what = SPECIES_SHORT[c.sp] === "horses" ? "horse" : SPECIES_SHORT[c.sp];
  s.event("mocked", Bubble.Sun, `When ${p.name} carried in the ${what}, ${wag.name} called it a bag of bones and the others laughed, as the ${b.name} do, so that no hunter grows too proud. They ate it all the same.`, p.x, p.y, [p.id, wag.id], b.id);
}

/** Whether someone is leading a band now, and for how long, in days. */
export function leads(s: Society, p: Person): number {
  const b = s.band(p);
  return b.respected === p.id ? (s.time - b.ledSince) / DAY_SECONDS : -1;
}
