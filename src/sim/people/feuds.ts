import { DAY_SECONDS } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { Goal, Mem, Place, St, step, type Person } from "./person.ts";
import { homeOf, type Band } from "./band.ts";
import { abandon } from "./doing.ts";
import type { Society } from "./society.ts";

/*
  Feuds. Most quarrels blow over. Some do not: a family turned away hungry by a full hearth,
  a partner lost to someone else, a child who starved after the asking was refused. When a
  wrong goes deep enough for someone of a stubborn, hot temper, it hardens into a feud, and
  a feud is never between two people only. Their partners, parents, children and brothers
  and sisters take sides, and slowly come to dislike the other family too.

  Feuding people avoid each other, will not share food or hunt together, and when they meet
  by the fire tempers can boil over into a fight. A respected go-between (the one the band
  listens to, or a kind elder) can talk each side round, and time cools anything, but a
  hot feud can also drive a family out to live with another band, or split a band in two.
  When one side dies, the feud can pass to their children. Grudges outlive people.
*/

export interface Feud {
  id: number;
  /** the two at the heart of it: `a` holds the grudge against `b` */
  a: number; b: number;
  /** 0..1: how bitter it is now */
  heat: number;
  since: number;
  /** the last time something new fed it */
  last: number;
  /** what started it, said of `b` ("turned her away while her children went hungry") */
  cause: string;
  /** the band it began in */
  band: number;
  fights: number; lastFight: number;
  /** passed down from a parent who died with it unsettled */
  inherited: boolean;
  /** the last time a go-between tried */
  mediated: number;
  /** settled by a go-between, rather than left to cool */
  settled?: boolean;
}

/** Partner, parent, child, brother or sister. */
export function close(s: Society, x: Person, y: { id: number; mother: number; father: number }): boolean {
  return x.id === y.id || x.partner === y.id || s.kin(x, y, 1);
}
/** Which side of a feud someone is on: 1 with `a`, 2 with `b`, 0 neither. */
export function sideOf(s: Society, f: Feud, p: Person): 0 | 1 | 2 {
  if (p.id === f.a) return 1;
  if (p.id === f.b) return 2;
  const A = s.byId.get(f.a) ?? s.archive.get(f.a), B = s.byId.get(f.b) ?? s.archive.get(f.b);
  const inA = !!A && close(s, p, A), inB = !!B && close(s, p, B);
  return inA && !inB ? 1 : inB && !inA ? 2 : 0;
}
/** The feud that sets two people against each other, if there is one. */
export function feudOf(s: Society, p: Person, q: Person): Feud | null {
  for (const f of s.feuds) {
    if (f.heat < 0.1) continue;
    const a = sideOf(s, f, p); if (!a) continue;
    const b = sideOf(s, f, q); if (b && b !== a) return f;
  }
  return null;
}
export const feudsWith = (s: Society, p: Person) => s.feuds.filter(f => f.heat >= 0.1 && sideOf(s, f, p) !== 0);
/** A feud between the two themselves (or their partners), not only their families. */
export function feudBetween(s: Society, p: Person, q: Person): Feud | null {
  const own = (x: Person, id: number) => x.id === id || x.partner === id;
  for (const f of s.feuds) if (f.heat >= 0.1 && ((own(p, f.a) && own(q, f.b)) || (own(p, f.b) && own(q, f.a)))) return f;
  return null;
}

/**
  A wrong done to someone. It adds to the grudge they hold against whoever did it (less if
  they are fond of them), and a grudge fades over weeks. Wrongs that come one after
  another, or one grave enough, harden into a feud in someone of a stubborn, hot temper;
  if there is a feud already, they feed it.
*/
export function grievance(s: Society, victim: Person, offender: Person, severity: number, cause: string): void {
  if (victim === offender || victim.partner === offender.id || s.age(victim) < 14 || s.age(offender) < 14) return;
  /* parents and children forgive what they would not from anyone else */
  if (victim.mother === offender.id || victim.father === offender.id || offender.mother === victim.id || offender.father === victim.id) return;
  const old = feudOf(s, victim, offender);
  if (old) { old.heat = Math.min(1, old.heat + severity * 0.5); old.last = s.time; return; }
  const r = s.rel(victim, offender.id);
  r.grudge += severity * (1 - Math.max(0, r.op) * 0.5);
  if (r.grudge < GRUDGE) return;
  const t = victim.traits;
  if (!s.rng.chance((0.35 + t[6] * 0.6) * (1.1 - t[1] * 0.5))) { r.grudge *= 0.7; return; }
  startFeud(s, victim, offender, 0.4 + Math.min(0.5, r.grudge * 0.4), cause, false);
  r.grudge = 0;
}
/** How much held against someone hardens into a feud. */
export const GRUDGE = 0.55;
/** Grudges fade: a little each day. */
export function fadeGrudges(p: Person): void { for (const r of p.rel.values()) if (r.grudge) { r.grudge *= 0.97; if (r.grudge < 0.02) r.grudge = 0; } }

function startFeud(s: Society, a: Person, b: Person, heat: number, cause: string, inherited: boolean): Feud {
  const f: Feud = { id: s.nextFeud++, a: a.id, b: b.id, heat: Math.min(1, heat), since: s.time, last: s.time, cause, band: a.band, fights: 0, lastFight: -1e9, inherited, mediated: -1e9 };
  s.feuds.push(f);
  s.stats.social.feuds++;
  s.remember(a, Mem.Feud, b.id, -0.5); s.remember(b, Mem.Feud, a.id, -0.35);
  s.rel(b, a.id).op = Math.min(s.op(b, a.id), -0.2);
  s.bubble(a, Bubble.Angry, 3);
  if (!inherited) {
    const ba = s.bandById.get(a.band);
    const her = a.sex === "f" ? "her" : "his";
    s.event("feud", Bubble.Angry, `Bad blood in the ${ba?.name ?? "band"}: ${a.name} will not forgive ${b.name}, who ${cause}. ${a.name}'s family and ${b.name}'s have taken sides${a.partner ? `, ${her} partner with ${a.sex === "f" ? "her" : "him"}` : ""}.`, a.x, a.y, [a.id, b.id], a.band);
  }
  return f;
}

/* ---------------- each day ---------------- */

export function feudDay(s: Society): void {
  for (const f of s.feuds) {
    const a = s.byId.get(f.a), b = s.byId.get(f.b);
    if (!a || !b) { f.heat = 0; continue; }
    const apart = a.band !== b.band ? (Math.hypot(a.x - b.x, a.y - b.y) > 40 ? 0.04 : 0.02) : 0;
    /* time cools everything, slowly; something new in the last few days keeps it hot */
    const fresh = s.time - f.last < DAY_SECONDS * 3 ? 0.005 : 0.022;
    f.heat = Math.max(0, f.heat - fresh - apart - (1 - Math.max(a.traits[6], b.traits[6])) * 0.01);
    /* the two at its heart keep the grudge while it is hot */
    if (f.heat > 0.3) { const ra = s.rel(a, b.id); ra.op = Math.min(ra.op, -0.3); }
    /* families take sides: kin of each come to dislike the other, a little more each day */
    if (f.heat > 0.25) for (const [side, other] of [[a, b], [b, a]] as [Person, Person][]) {
      for (const q of kinOf(s, side)) {
        if (q === other || close(s, q, other) || s.age(q) < 8) continue;
        const r = s.rel(q, other.id); r.op = Math.max(-0.75, r.op - 0.015 * f.heat);
        const r2 = s.rel(other, q.id); r2.op = Math.max(-0.6, r2.op - 0.008 * f.heat);
      }
    }
    if (f.heat < 0.05) {
      if (!f.settled && s.time - f.since > DAY_SECONDS * 6) {
        s.remember(a, Mem.Peace, b.id, 0.15); s.remember(b, Mem.Peace, a.id, 0.15);
        s.rel(a, b.id).op = Math.max(s.op(a, b.id), -0.15); s.rel(b, a.id).op = Math.max(s.op(b, a.id), -0.15);
        s.stats.social.cooled++;
        if (a.band === b.band) s.event("peace", Bubble.Peace, `${a.name} and ${b.name} of the ${s.band(a).name} have let their feud go at last.`, a.x, a.y, [a.id, b.id], a.band);
      }
      f.heat = 0;
    }
  }
  s.feuds = s.feuds.filter(f => f.heat > 0);
}
/** Close kin of someone in the same band. */
function kinOf(s: Society, p: Person): Person[] {
  const out: Person[] = [p];
  const ids = [p.partner, p.mother, p.father, ...p.children];
  for (const id of ids) { const q = s.byId.get(id); if (q) out.push(q); }
  for (const q of s.band(p).members.map(id => s.byId.get(id))) if (q && q !== p && !out.includes(q) && ((p.mother && q.mother === p.mother) || (p.father && q.father === p.father))) out.push(q);
  return out;
}

/** Someone with a feud died. If it was still hot, it can pass to their grown child or partner. */
export function feudsOnDeath(s: Society, dead: Person, cause: string): void {
  for (const f of s.feuds) {
    if (f.a !== dead.id && f.b !== dead.id) continue;
    const other = s.byId.get(f.a === dead.id ? f.b : f.a);
    if (!other || f.heat < 0.35) { f.heat = 0; continue; }
    const heirs = [...dead.children.map(id => s.byId.get(id)), s.byId.get(dead.partner)].filter((q): q is Person => !!q && s.age(q) >= 15 && !close(s, q, other));
    const heir = heirs.sort((x, y) => (y.band === other.band ? 1 : 0) - (x.band === other.band ? 1 : 0) || y.traits[6] - x.traits[6])[0];
    if (!heir || !s.rng.chance(0.4 + heir.traits[6] * 0.5)) { f.heat = 0; continue; }
    if (f.a === dead.id) f.a = heir.id; else f.b = heir.id;
    f.heat *= 0.8; f.inherited = true; f.last = s.time;
    s.rel(heir, other.id).op = Math.min(s.op(heir, other.id), -0.45);
    s.remember(heir, Mem.Feud, other.id, -0.4);
    s.stats.social.inherited++;
    const word = dead.partner === heir.id ? (heir.sex === "f" ? "widow" : "widower") : heir.sex === "f" ? "daughter" : "son";
    s.event("feud", Bubble.Angry, `${dead.name} died with the feud against ${other.name} unsettled, and it lives on: ${dead.name}'s ${word} ${heir.name} has taken it up.`, heir.x, heir.y, [heir.id, other.id], heir.band, 1);
  }
  /* a family that was turned away before someone of theirs starved does not forget who did it */
  if (cause !== "hunger") return;
  const mourners = [s.byId.get(dead.mother), s.byId.get(dead.father), s.byId.get(dead.partner), ...dead.children.map(id => s.byId.get(id))].filter((q): q is Person => !!q && s.age(q) >= 15);
  const asked = [dead, ...mourners];
  for (const m of asked) for (const mem of m.mem) {
    if (mem.k !== Mem.Refused || s.time - mem.t > DAY_SECONDS * 8) continue;
    const refuser = s.byId.get(mem.who); if (!refuser) continue;
    for (const q of mourners) {
      if (close(s, q, refuser)) continue;
      s.rel(q, refuser.id).op = Math.max(-1, s.op(q, refuser.id) - 0.35);
      grievance(s, q, refuser, 0.9, `turned the family away before ${dead.name} starved`);
    }
    return;
  }
}

/* ---------------- fights ---------------- */

/** Feuding people who come face to face may come to blows. Called when someone looks around. */
export function maybeFight(s: Society, p: Person): void {
  if (!s.feuds.length || p.goal === Goal.Fight || p.goal === Goal.Sleep || p.goal === Goal.Sick || p.goal === Goal.Flee || p.carrier || p.injury > 0.3) return;
  for (const f of s.feuds) {
    if (f.heat < 0.6 || s.time - f.lastFight < DAY_SECONDS * 6) continue;
    const side = sideOf(s, f, p); if (!side) continue;
    for (const q of s.near(p.x, p.y, 2.5)) {
      if (q === p || sideOf(s, f, q) === side || !sideOf(s, f, q) || s.age(q) < 15 || q.goal === Goal.Sleep || q.goal === Goal.Sick || q.carrier || q.goal === Goal.Fight) continue;
      /* only one of the two at its heart starts it, and only a hot temper */
      if (p.id !== f.a && p.id !== f.b && q.id !== f.a && q.id !== f.b) continue;
      const temper = p.traits[6];
      if (!s.rng.chance(f.heat * temper * temper * 0.025)) return;
      f.lastFight = s.time; f.fights++;
      for (const [x, y] of [[p, q], [q, p]]) {
        abandon(s, x);
        x.plan = [step(St.Fight, x.x, x.y, y.id, 3.5)]; x.goal = Goal.Fight; x.whyAt = s.time;
        x.why = `${x.name} is fighting ${y.name}. The feud between their families boiled over.`;
        s.bubble(x, Bubble.Angry, 3.5);
      }
      return;
    }
  }
}
/** The end of a fight: bruises, sometimes worse; the camp thinks less of both; it can inflame a feud or clear the air. */
export function endFight(s: Society, p: Person, q: Person): void {
  const f = feudOf(s, p, q);
  s.stats.social.fights++;
  const hurt: Person[] = [];
  for (const [x, y] of [[p, q], [q, p]]) {
    const strong = (y.looks.build + 1) / 2 * 0.5 + 0.5, sev = s.rng.next() < 0.08 ? s.rng.range(0.35, 0.6) : s.rng.range(0, 0.18);
    x.injury = Math.min(1, x.injury + sev * strong); x.health = Math.max(0.05, x.health - sev * strong * 0.4);
    if (sev * strong > 0.25) hurt.push(x);
    s.remember(x, Mem.Fight, y.id, -0.4);
    s.rel(x, y.id).op = Math.max(-1, s.op(x, y.id) - 0.15);
  }
  /* nobody likes trouble by the fire */
  for (const o of s.near(p.x, p.y, 7)) if (o !== p && o !== q && o.band === p.band && s.age(o) >= 12) { s.rel(o, p.id).op -= 0.02; s.rel(o, q.id).op -= 0.02; }
  if (f) { if (s.rng.chance(0.3)) f.heat = Math.max(0.1, f.heat - 0.25); else f.heat = Math.min(1, f.heat + 0.12); f.last = s.time; }
  const b = s.band(p);
  s.event("fight", Bubble.Angry, `${p.name} and ${q.name} came to blows by the fire of the ${b.name}.${hurt.length ? ` ${hurt.map(h => h.name).join(" and ")} ${hurt.length > 1 ? "were" : "was"} hurt.` : " Others pulled them apart."}`, p.x, p.y, [p.id, q.id], b.id, hurt.length ? 1 : 0);
}

/* ---------------- making peace ---------------- */

/**
  A feud in the band that this person could help settle: they are respected or kind, belong
  to neither side, and both sides think well enough of them to listen.
*/
export function peaceToMake(s: Society, p: Person): { f: Feud; a: Person; b: Person } | null {
  const band = s.band(p), age = s.age(p);
  const leader = band.respected === p.id;
  if (!leader && !(age > 38 && p.traits[1] > 0.5 && p.prestige > 0.5)) return null;
  for (const f of s.feuds) {
    if (f.heat < 0.2 || s.time - f.mediated < DAY_SECONDS) continue;
    const a = s.byId.get(f.a), b = s.byId.get(f.b);
    if (!a || !b || a.band !== p.band || b.band !== p.band || sideOf(s, f, p)) continue;
    if (s.op(a, p.id) < 0 || s.op(b, p.id) < 0) continue;
    if (Math.hypot(a.x - band.x, a.y - band.y) > 8 || Math.hypot(b.x - band.x, b.y - band.y) > 8) continue;
    return { f, a, b };
  }
  return null;
}
/** A go-between talks one side round: how far depends on how much they think of the go-between. Called when that talk ends. */
export function talkRound(s: Society, go: Person, q: Person, otherId: number): void {
  const f = s.feuds.find(k => (k.a === q.id && k.b === otherId) || (k.b === q.id && k.a === otherId));
  if (!f) return;
  f.mediated = s.time;
  const sway = (0.5 + s.op(q, go.id)) * (0.6 + Math.min(1, go.prestige) * 0.6) * (1.1 - q.traits[6] * 0.6);
  f.heat = Math.max(0, f.heat - 0.2 * sway);
  const r = s.rel(q, otherId); r.op = Math.min(0.3, r.op + 0.12 * sway);
  s.rel(q, go.id).op = Math.min(1, s.op(q, go.id) + 0.03);
  if (f.heat < 0.25) {
    const a = s.byId.get(f.a), b = s.byId.get(f.b);
    f.heat = 0; f.settled = true;
    if (!a || !b) return;
    s.stats.social.peace++;
    go.prestige += 0.15;
    s.remember(a, Mem.Peace, b.id, 0.3); s.remember(b, Mem.Peace, a.id, 0.3);
    s.rel(a, b.id).op = Math.max(s.op(a, b.id), 0); s.rel(b, a.id).op = Math.max(s.op(b, a.id), 0);
    s.bubble(a, Bubble.Peace, 3); s.bubble(b, Bubble.Peace, 3); s.bubble(go, Bubble.Peace, 3);
    s.event("peace", Bubble.Peace, `${go.name} talked ${a.name} and ${b.name} of the ${s.band(go).name} into making peace, ending the feud that began when ${b.name} ${f.cause}.`, go.x, go.y, [go.id, a.id, b.id], go.band, 1);
  }
}

/* ---------------- what feuds do to a band ---------------- */

/**
  A feud that will not cool can drive a family out. The side with fewer friends in the band
  goes to live with another band of their people that they know and can walk to.
*/
export function feudLeave(s: Society, b: Band): void {
  for (const f of s.feuds) {
    if (f.heat < 0.6 || s.time - f.since < DAY_SECONDS * 5) continue;
    const a = s.byId.get(f.a), c = s.byId.get(f.b);
    if (!a || !c || a.band !== b.id || c.band !== b.id) continue;
    /* who has more of the band behind them */
    let forA = 0, forC = 0;
    for (const id of b.members) { const q = s.byId.get(id); if (!q || q === a || q === c || s.age(q) < 15) continue; const d = s.op(q, a.id) - s.op(q, c.id); if (d > 0.05) forA++; else if (d < -0.05) forC++; }
    const goer = forA < forC ? a : forC < forA ? c : (a.prestige < c.prestige ? a : c);
    if (!s.rng.chance(0.12 * f.heat)) continue;
    let best: Band | null = null, bv = 0;
    for (const pl of goer.places) {
      if (pl.k !== Place.Camp || pl.ref === b.id) continue;
      const o = s.bandById.get(pl.ref); if (!o || o.moving) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y); if (d > 120 || !s.walkable(b.x, b.y, o.x, o.y)) continue;
      const ties = o.members.reduce((t, id) => t + Math.max(0, s.op(goer, id)), 0);
      const v = (o.culture === b.culture ? 1 : 0.35) * (1 + ties * 0.3) * (1 - d / 200) * (feudIn(s, o, goer) ? 0.2 : 1);
      if (v > bv) { bv = v; best = o; }
    }
    if (!best || bv < 0.4) continue;
    const head = homeOf(goer, s.byId, s.time);
    const fam = b.members.map(id => s.byId.get(id)!).filter(q => q && homeOf(q, s.byId, s.time) === head);
    if (fam.length >= b.members.length - 2) continue;
    for (const o of fam) { s.moveTo(o, best); s.remember(o, Mem.Moved, best.id, -0.15); }
    const other = goer === a ? c : a;
    f.heat *= 0.7; f.last = s.time;
    s.stats.social.driven++;
    s.event("leave", Bubble.Home, `The feud with ${other.name} grew too bitter: ${goer.name}'s family left the ${b.name} to live with the ${best.name}.`, b.x, b.y, fam.map(o => o.id), best.id, 1);
    s.layoutHomes(b); s.layoutHomes(best);
    return;
  }
}
function feudIn(s: Society, o: Band, p: Person): boolean {
  for (const f of s.feuds) { const side = sideOf(s, f, p); if (!side) continue; const other = s.byId.get(side === 1 ? f.b : f.a); if (other && other.band === o.id) return true; }
  return false;
}

/** Children growing up take on their parents' strongest dislikes, a little at a time. */
export function handDown(s: Society, child: Person): void {
  for (const pid of [child.mother, child.father]) {
    const par = s.byId.get(pid); if (!par) continue;
    for (const [id, r] of par.rel) {
      if (r.op > -0.4 || id === child.id || !s.byId.has(id)) continue;
      const q = s.byId.get(id)!; if (close(s, child, q)) continue;
      const cr = s.rel(child, id), want = r.op * 0.6;
      if (cr.op > want) cr.op = Math.max(want, cr.op - 0.1);
    }
  }
}
