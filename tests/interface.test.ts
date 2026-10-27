import { describe, it, expect, beforeAll } from "vitest";
import { generateWorld } from "../src/sim/world/gen.ts";
import { Wildlife } from "../src/sim/wildlife.ts";
import { Ecology } from "../src/sim/ecology.ts";
import { settle } from "../src/sim/settle.ts";
import { Society } from "../src/sim/people/society.ts";
import { weigh } from "../src/sim/people/chronicle.ts";
import { Bond, RIVAL_OP, bondEdges, fold, score, searchWorld } from "../src/sim/people/search.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, Species, type WorldData } from "../src/shared/types.ts";
import type { ChronicleEvent } from "../src/shared/people.ts";
import { History, YEAR_SECONDS, SEASON_SECONDS, dateText, categoryOf } from "../src/ui/history.ts";
import { MIN_SPAN, liveWindow, nearest, pan, pickMarks, tOf, ticks, xOf, zoom } from "../src/ui/timeline.ts";
import { Director } from "../src/ui/director.ts";

/* ---------- a small world, lived in for a few years ---------- */

const SEED = 7;
let s: Society;
beforeAll(() => {
  const world: WorldData = generateWorld("medium", SEED, () => {});
  const eco = new Ecology(world, SEED), wild = new Wildlife(world, SEED, eco);
  settle(wild, eco, 4, () => {});
  const t0 = (DAYS_PER_SEASON + 0.32) * DAY_SECONDS;
  s = new Society(world, eco, wild, SEED, { start: "bands", bands: 12 }, t0);
  let time = t0, lastDay = -1;
  const end = t0 + 4 * 40 * DAY_SECONDS;
  while (time < end) {
    time += 2;
    const season = Math.floor(time / DAY_SECONDS / DAYS_PER_SEASON) % 4, day = Math.floor(time / DAY_SECONDS);
    wild.update(2, season, day);
    if (day !== lastDay) { lastDay = day; eco.daily(season); }
    s.update(2, time, season);
  }
}, 240000);

const ev = (o: Partial<ChronicleEvent> & { id: number; t: number }): ChronicleEvent =>
  ({ kind: "birth", icon: 7, text: "x", x: 0, y: 0, who: [], band: 1, sig: 0.2, title: "t", ...o });

describe("how much an event matters", () => {
  it("is always between 0 and 1, with a headline", () => {
    expect(s.events.length).toBeGreaterThan(50);
    for (const e of s.events) { expect(e.sig).toBeGreaterThanOrEqual(0); expect(e.sig).toBeLessThanOrEqual(1); expect(e.title.length).toBeGreaterThan(2); }
  });
  it("weighs a band ending and a band splitting above births, couples and deaths in general", () => {
    const stub = (): Parameters<typeof weigh>[0] => ({ seen: new Map(), archive: new Map(), bandById: new Map() }) as unknown as Parameters<typeof weigh>[0];
    const w = (kind: string, hint = 0) => { const x = stub(); x.seen.set(kind, 30); return weigh(x, kind, [], 1, hint).sig; };
    expect(w("band-end")).toBeGreaterThan(w("split"));
    expect(w("split")).toBeGreaterThan(w("couple"));
    expect(w("couple")).toBeGreaterThan(w("birth"));
    expect(w("kill", Species.Mammoth)).toBeGreaterThan(w("kill", Species.Aurochs));
    expect(w("kill", Species.Bear)).toBeGreaterThan(w("kill", Species.Aurochs));
    expect(w("contact", 1)).toBeGreaterThan(w("contact", 0));
  });
  it("counts the first of anything for more than the hundredth", () => {
    const x = { seen: new Map<string, number>(), archive: new Map(), bandById: new Map() } as unknown as Parameters<typeof weigh>[0];
    const first = weigh(x, "birth", [], 1, 0).sig;
    for (let i = 0; i < 98; i++) weigh(x, "birth", [], 1, 0);
    expect(first).toBeGreaterThan(weigh(x, "birth", [], 1, 0).sig + 0.1);
  });
  it("makes the death of the one a band listens to weigh more than an ordinary death", () => {
    const x = { seen: new Map<string, number>([["death", 50]]), archive: new Map(), bandById: new Map() } as unknown as Parameters<typeof weigh>[0];
    const mk = (id: number, respected: number) => {
      x.archive.set(id, { id, born: 0, died: 20 * YEAR_SECONDS, children: [], cause: "old age" } as never);
      x.bandById.set(1, { id: 1, respected, members: [1, 2, 3, 4, 5, 6] } as never);
      return weigh(x, "death", [id], 1, 0).sig;
    };
    expect(mk(5, 5)).toBeGreaterThan(mk(6, 5) + 0.3);
  });
  it("gives every event the kind that decides which journal group it is in", () => {
    for (const e of s.events) expect(["life", "loss", "hunt", "bands", "ties", "meet"]).toContain(categoryOf(e.kind));
  });
});

describe("finding things by name", () => {
  it("ignores case, accents and apostrophes", () => {
    expect(fold("Ka’élo")).toBe("kaelo");
    expect(score("Kaelo Mura", fold("MUR"))).toBe(60);
    expect(score("Kaelo", fold("kaelo"))).toBe(100);
    expect(score("Kaelo", fold("zz"))).toBe(0);
  });
  it("finds a living person from the start of their name, with their band", () => {
    const p = s.people.find(q => q.name.length > 4)!;
    const hits = searchWorld(s, p.name.slice(0, 4).toUpperCase());
    const hit = hits.find(h => h.kind === "person" && h.id === p.id);
    expect(hit).toBeTruthy();
    expect(hit!.sub).toContain(s.band(p).name);
    expect(hit!.look?.id).toBe(p.id);
  });
  it("finds the dead too, where they died", () => {
    const a = [...s.archive.values()][0];
    expect(a).toBeTruthy();
    const hit = searchWorld(s, a.name).find(h => h.kind === "dead" && h.id === a.id);
    expect(hit).toBeTruthy();
    expect([hit!.x, hit!.y]).toEqual([a.x, a.y]);
    expect(hit!.sub).toContain("died");
  });
  it("finds bands, the camps they sit in, and whole peoples", () => {
    const b = s.bands[0];
    expect(searchWorld(s, b.name).some(h => h.kind === "band" && h.id === b.id)).toBe(true);
    expect(searchWorld(s, b.siteName).some(h => h.kind === "place" && h.id === b.id)).toBe(true);
    const lang = s.cultures[b.culture].lang.name;
    expect(searchWorld(s, lang).some(h => h.kind === "people")).toBe(true);
  });
  it("offers the people the bands listen to when nothing is typed", () => {
    const hits = searchWorld(s, "");
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(s.bandById.get(s.byId.get(h.id)!.band)!.respected).toBe(h.id);
  });
  it("keeps a few of each kind so a common name cannot bury everything", () => {
    const hits = searchWorld(s, "a", 3);
    for (const k of ["person", "dead", "band", "people", "place"]) expect(hits.filter(h => h.kind === k).length).toBeLessThanOrEqual(3);
  });
});

describe("relationship threads", () => {
  const everywhere = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
  it("joins only the living, never a person to themselves, and nothing very far apart", () => {
    const e = bondEdges(s, everywhere, 5000);
    expect(e.length / 3).toBeGreaterThan(20);
    for (let i = 0; i < e.length; i += 3) {
      const a = s.byId.get(e[i]), b = s.byId.get(e[i + 1]);
      expect(a && b).toBeTruthy();
      expect(a!.id).not.toBe(b!.id);
      expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeLessThanOrEqual(20.001);
    }
  });
  it("has couples whose partners point at each other, and parents of their children", () => {
    const e = bondEdges(s, everywhere, 5000);
    let couples = 0, kin = 0;
    for (let i = 0; i < e.length; i += 3) {
      const a = s.byId.get(e[i])!, b = s.byId.get(e[i + 1])!;
      if (e[i + 2] === Bond.Couple) { couples++; expect(a.partner).toBe(b.id); expect(b.partner).toBe(a.id); }
      if (e[i + 2] === Bond.Kin) { kin++; expect(b.mother === a.id || b.father === a.id).toBe(true); }
    }
    expect(couples).toBeGreaterThan(0); expect(kin).toBeGreaterThan(0);
  });
  it("only draws friends who like each other and rivals who dislike each other", () => {
    const e = bondEdges(s, everywhere, 5000);
    for (let i = 0; i < e.length; i += 3) {
      const a = s.byId.get(e[i])!, b = s.byId.get(e[i + 1])!, k = e[i + 2];
      if (k === Bond.Friend) { expect(a.rel.get(b.id)!.op).toBeGreaterThan(0.5); expect(b.rel.get(a.id)!.op).toBeGreaterThan(0.35); }
      if (k === Bond.Rival) { expect(a.rel.get(b.id)!.op).toBeLessThan(RIVAL_OP); expect(b.rel.get(a.id)!.op).toBeLessThan(RIVAL_OP / 2); }
    }
    expect(e.length / 3 - [...e].filter((_, i) => i % 3 === 2 && e[i] === Bond.Friend).length).toBeGreaterThan(0);
  });
  it("draws a rivalry, and only a mutual one, when two people truly cannot stand each other", () => {
    /* two people of one band, close together, who are not partners or parent and child (those are drawn as family) */
    const apart = (q: (typeof s.people)[number], o: (typeof s.people)[number]) => o !== q && o.band === q.band && Math.hypot(o.x - q.x, o.y - q.y) < 15
      && o.id !== q.partner && o.id !== q.mother && o.id !== q.father && q.id !== o.mother && q.id !== o.father;
    const a = s.people.find(q => s.people.some(o => apart(q, o)))!;
    const b = s.people.find(o => apart(a, o))!;
    const ra = s.rel(a, b.id), rb = s.rel(b, a.id), keep = [ra.op, rb.op, ra.fam, rb.fam];
    const rival = () => { const e = bondEdges(s, everywhere, 5000); for (let i = 0; i < e.length; i += 3) if (e[i + 2] === Bond.Rival && [e[i], e[i + 1]].sort().join() === [a.id, b.id].sort().join()) return true; return false; };
    ra.op = -0.6; rb.op = -0.5; ra.fam = rb.fam = 0.6;
    expect(rival()).toBe(true);
    rb.op = 0.3;
    expect(rival()).toBe(false);
    [ra.op, rb.op, ra.fam, rb.fam] = keep;
  });
  it("leaves out people outside the view, and keeps the strongest when there are too many", () => {
    const some = s.people[0];
    const tight = bondEdges(s, { x0: some.x - 2, y0: some.y - 2, x1: some.x + 2, y1: some.y + 2 }, 5000);
    const all = bondEdges(s, everywhere, 5000);
    expect(tight.length).toBeLessThan(all.length);
    const capped = bondEdges(s, everywhere, 10);
    expect(capped.length).toBe(30);
    /* the two at the heart of a feud come first, then couples */
    expect(capped[2]).toBe([...all].some((v, i) => i % 3 === 2 && v === Bond.Feud) ? Bond.Feud : Bond.Couple);
  });
});

/* ---------- the page's side: the log, the ribbon's arithmetic and the Spotlight ---------- */

describe("the history log", () => {
  const make = () => {
    const h = new History();
    h.add([ev({ id: 1, t: 100, kind: "birth", who: [5], text: "Ama had a son" }), ev({ id: 2, t: 300, kind: "death", sig: 0.7, who: [5, 6], band: 2, text: "Old Tuk died" }), ev({ id: 3, t: 500, kind: "kill", sig: 0.5, band: 2, text: "A mammoth fell" }), ev({ id: 4, t: 900, kind: "birth", sig: 0.1, text: "Rin had a daughter" })]);
    return h;
  };
  it("keeps events in order and ignores one it has seen", () => {
    const h = make();
    h.add([ev({ id: 2, t: 300 })]);
    expect(h.events.map(e => e.id)).toEqual([1, 2, 3, 4]);
    expect(h.origin).toBe(100);
  });
  it("finds the events in a stretch of time, and the one before or after a moment", () => {
    const h = make();
    expect(h.between(200, 600).map(e => e.id)).toEqual([2, 3]);
    expect(h.step(300, -1, 0)?.id).toBe(1);
    expect(h.step(300, 1, 0.4)?.id).toBe(3);
    expect(h.step(900, 1, 0)).toBeUndefined();
    expect(h.step(100, -1, 0)).toBeUndefined();
  });
  it("filters newest first by kind group, weight, person, band and words", () => {
    const h = make();
    expect(h.filter({}).map(e => e.id)).toEqual([4, 3, 2, 1]);
    expect(h.filter({ hide: new Set(["life" as const]) }).map(e => e.id)).toEqual([3, 2]);
    expect(h.filter({ minSig: 0.5 }).map(e => e.id)).toEqual([3, 2]);
    expect(h.filter({ who: 5 }).map(e => e.id)).toEqual([2, 1]);
    expect(h.filter({ band: 2 }).map(e => e.id)).toEqual([3, 2]);
    expect(h.filter({ text: "mammoth" }).map(e => e.id)).toEqual([3]);
    expect(h.filter({ text: "a son" }).map(e => e.id)).toEqual([1]);
    expect(h.filter({}, 2).length).toBe(2);
  });
  it("keeps one head count a day and looks it up", () => {
    const h = new History();
    for (let d = 0; d < 5; d++) { h.sample(d * DAY_SECONDS + 1, 100 + d); h.sample(d * DAY_SECONDS + 20, 999); }
    expect(h.pop.length).toBe(5);
    expect(h.popAt(2 * DAY_SECONDS + 1)).toBe(102);
    expect(h.popAt(-5)).toBe(100);
  });
  it("lets go of the least notable old events when it grows very long, and never the recent ones", () => {
    const h = new History();
    const many: ChronicleEvent[] = [];
    for (let i = 1; i <= 24100; i++) many.push(ev({ id: i, t: i, sig: i % 50 === 0 ? 0.9 : 0.1 }));
    h.add(many);
    expect(h.events.length).toBeLessThan(24000);
    expect(h.events.length).toBeGreaterThan(17000);
    expect(h.events.slice(-3000).map(e => e.id)).toEqual(many.slice(-3000).map(e => e.id));
    expect(h.events.filter(e => e.sig === 0.9).length).toBe(many.filter(e => e.sig === 0.9).length);
  });
  it("writes dates the way the clock does", () => {
    expect(dateText(0)).toBe("Spring, year 1");
    expect(dateText(SEASON_SECONDS + 5)).toBe("Summer, year 1");
    expect(dateText(YEAR_SECONDS * 2 + SEASON_SECONDS * 3)).toBe("Winter, year 3");
  });
});

describe("the ribbon's arithmetic", () => {
  const W = 1000;
  it("maps time to pixels and back", () => {
    const w = { t0: 100, t1: 1100 };
    expect(xOf(w, 600, W)).toBeCloseTo(500);
    expect(tOf(w, xOf(w, 777, W), W)).toBeCloseTo(777);
  });
  it("zooms around a moment so it stays under the pointer, within limits", () => {
    const w = { t0: 0, t1: 10000 }, anchor = 2500;
    const z = zoom(w, anchor, 2, 1e6);
    expect(z.t1 - z.t0).toBeCloseTo(5000);
    expect(xOf(z, anchor, W)).toBeCloseTo(xOf(w, anchor, W));
    expect(zoom(w, anchor, 1e9, 1e6).t1 - zoom(w, anchor, 1e9, 1e6).t0).toBeCloseTo(MIN_SPAN);
    expect(zoom(w, anchor, 1e-9, 20000).t1 - zoom(w, anchor, 1e-9, 20000).t0).toBeCloseTo(20000);
  });
  it("slides without leaving history", () => {
    const w = { t0: 500, t1: 1500 };
    expect(pan(w, -9999, 0, 4000)).toEqual({ t0: 0, t1: 1000 });
    expect(pan(w, 9999, 0, 4000)).toEqual({ t0: 3000, t1: 4000 });
    expect(pan(w, 100, 0, 4000)).toEqual({ t0: 600, t1: 1600 });
  });
  it("follows the present, and shows all of a young history rather than empty past", () => {
    const young = liveWindow(1000, 800, 5 * YEAR_SECONDS);
    expect(young.t0).toBe(800);
    expect(young.t1).toBeGreaterThan(1000);
    const old = liveWindow(10 * YEAR_SECONDS, 0, 2 * YEAR_SECONDS);
    expect(old.t1 - old.t0).toBeCloseTo(2 * YEAR_SECONDS);
    expect(old.t1).toBeGreaterThan(10 * YEAR_SECONDS);
  });
  it("shows the heaviest events when crowded and never two closer than the gap", () => {
    const h = new History();
    const evs: ChronicleEvent[] = [];
    for (let i = 0; i < 200; i++) evs.push(ev({ id: i + 1, t: i * 5, sig: i === 100 ? 0.95 : 0.1 + (i % 7) / 20 }));
    h.add(evs);
    const w = { t0: 0, t1: 1000 };
    const marks = pickMarks(h, w, 400, 20, 0);
    expect(marks.length).toBeLessThanOrEqual(21);
    expect(marks.some(m => m.e.id === 101 && m.big)).toBe(true);
    for (let i = 1; i < marks.length; i++) expect(marks[i].x - marks[i - 1].x).toBeGreaterThanOrEqual(20);
    expect(marks.every(m => m.x >= 0 && m.x <= 400)).toBe(true);
    /* zoomed in there is room for more */
    expect(pickMarks(h, { t0: 450, t1: 550 }, 400, 20, 0).length).toBeGreaterThan(8);
    /* and a weight floor drops the light ones */
    expect(pickMarks(h, w, 400, 20, 0.9).map(m => m.e.id)).toEqual([101]);
  });
  it("is stable: adding a light event later does not move a heavy one", () => {
    const h = new History();
    h.add([ev({ id: 1, t: 100, sig: 0.9 }), ev({ id: 2, t: 110, sig: 0.3 })]);
    const w = { t0: 0, t1: 1000 };
    const before = pickMarks(h, w, 500, 20, 0).map(m => m.e.id);
    h.add([ev({ id: 3, t: 120, sig: 0.2 })]);
    expect(pickMarks(h, w, 500, 20, 0).map(m => m.e.id)).toEqual(before);
  });
  it("finds the banner nearest a pointer, within reach", () => {
    const marks = [{ e: ev({ id: 1, t: 0 }), x: 100, big: false }, { e: ev({ id: 2, t: 0 }), x: 130, big: true }];
    expect(nearest(marks, 118, 20)?.e.id).toBe(2);
    expect(nearest(marks, 111, 20)?.e.id).toBe(1);
    expect(nearest(marks, 300, 20)).toBeUndefined();
  });
  it("labels the years when they fit, the seasons when closer, and the days when closer still", () => {
    const labels = (w: { t0: number; t1: number }) => ticks(w, W).filter(t => t.label).map(t => t.label);
    expect(labels({ t0: 0, t1: 8 * YEAR_SECONDS }).every(l => /^Year \d+$/.test(l))).toBe(true);
    expect(labels({ t0: 0, t1: 2 * YEAR_SECONDS }).some(l => /Summer|Winter|Autumn/.test(l))).toBe(true);
    expect(labels({ t0: 0, t1: 12 * DAY_SECONDS }).every(l => /^d\d+$/.test(l))).toBe(true);
    expect(labels({ t0: 0, t1: 500 * YEAR_SECONDS }).every(l => /^Y\d+$/.test(l))).toBe(true);
    expect(ticks({ t0: 0, t1: 8 * YEAR_SECONDS }, W).filter(t => !t.label).length).toBeGreaterThan(0);
  });
});

describe("the Spotlight's eye", () => {
  it("ignores small events and picks the heaviest fresh one", () => {
    const d = new Director();
    d.offer(ev({ id: 1, t: 0, sig: 0.2 }), 0);
    d.offer(ev({ id: 2, t: 0, sig: 0.6, band: 2 }), 0);
    d.offer(ev({ id: 3, t: 0, sig: 0.9, band: 3 }), 0);
    expect(d.waiting).toBe(2);
    expect(d.next(1000)?.id).toBe(3);
    expect(d.next(1000)?.id).toBe(2);
    expect(d.next(1000)).toBeNull();
  });
  it("lets old events go stale", () => {
    const d = new Director();
    d.offer(ev({ id: 1, t: 0, sig: 0.9 }), 0);
    expect(d.next(d.fresh + 1)).toBeNull();
  });
  it("prefers a band it has not just visited, but still goes back when it is all there is", () => {
    const d = new Director();
    d.noteVisit(1, 0);
    d.offer(ev({ id: 1, t: 0, sig: 0.8, band: 1 }), 1000);
    d.offer(ev({ id: 2, t: 0, sig: 0.6, band: 2 }), 1000);
    expect(d.next(2000)?.id).toBe(2);
    expect(d.next(2000)?.id).toBe(1);
  });
  it("lets a fresh event beat an older one of equal weight", () => {
    const d = new Director();
    d.offer(ev({ id: 1, t: 0, sig: 0.7, band: 1 }), 0);
    d.offer(ev({ id: 2, t: 0, sig: 0.7, band: 2 }), 40_000);
    expect(d.next(41_000)?.id).toBe(2);
  });
});
