import type { ChronicleEvent } from "../shared/people.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASON_NAMES } from "../shared/types.ts";

/*
  Everything that has happened in this world, kept on the page as it arrives: the events with
  their weight, and a head count for every day. The ribbon, the journal and the Spotlight
  all read from here. When the log grows very long the least important old events are let go,
  so a world that has run for ages stays light.
*/

/** An event this heavy or more is notable: it gets a banner on the ribbon, is stepped to, and fills the journal's notable list. */
export const NOTABLE = 0.45;
export const SEASON_SECONDS = DAYS_PER_SEASON * DAY_SECONDS;
export const YEAR_SECONDS = DAYS_PER_YEAR * DAY_SECONDS;

/** Year number (the first year is 1) and season index of a moment. */
export const yearOf = (t: number) => Math.floor(t / YEAR_SECONDS) + 1;
export const seasonOf = (t: number) => Math.floor(t / SEASON_SECONDS) % 4;
export const dayOfSeason = (t: number) => Math.floor(t / DAY_SECONDS) % DAYS_PER_SEASON + 1;
/** "Spring, year 3" */
export const dateText = (t: number) => `${SEASON_NAMES[seasonOf(t)]}, year ${yearOf(t)}`;
/** "Spring, day 4, year 3" */
export const dateLong = (t: number) => `${SEASON_NAMES[seasonOf(t)]}, day ${dayOfSeason(t)}, year ${yearOf(t)}`;

/** The groups the journal and the ribbon sort events into. */
export const CATEGORIES = [
  { key: "life", label: "Births and couples", kinds: ["birth", "couple", "parted", "leftfor"] },
  { key: "loss", label: "Deaths and dangers", kinds: ["death", "hurt", "attack", "band-end"] },
  { key: "hunt", label: "Hunts", kinds: ["kill"] },
  { key: "bands", label: "Bands and leaders", kinds: ["move", "split", "leave", "merge", "leader", "contest"] },
  { key: "ties", label: "Friends and feuds", kinds: ["refused", "feud", "fight", "peace", "mocked", "gift"] },
  { key: "ideas", label: "Discoveries", kinds: ["discover", "spread", "lost", "fireout", "ember", "weir", "sow", "harvest"] },
  { key: "meet", label: "Meetings", kinds: ["contact"] },
  { key: "villages", label: "Villages and gatherings", kinds: ["hut", "pit", "field", "seed", "gather", "disperse", "village", "villagegrow", "abandon", "return", "well", "granary", "kiln", "pen", "upgrade", "built"] },
  { key: "land", label: "Herds and the land", kinds: ["found", "exhausted", "regrown"] },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const categoryOf = (kind: string): CategoryKey => CATEGORIES.find(c => (c.kinds as readonly string[]).includes(kind))?.key ?? "bands";

/** The color of each kind on the ribbon. */
export const KIND_COLOR: Record<string, string> = {
  birth: "#e58aa0", couple: "#e0586c", parted: "#d0884a", death: "#9aa0b8", hurt: "#c8a46a", attack: "#d8584a", "band-end": "#c0392b",
  kill: "#d08a44", move: "#7fbf5a", split: "#f0c43c", leave: "#a4cf6a", merge: "#6fc2c0", leader: "#f6d77a", contest: "#e3ad2f", contact: "#7fa8e6",
  leftfor: "#c86a8a", refused: "#b0703a", feud: "#a8231c", fight: "#d0402a", peace: "#8fbf6a", mocked: "#c9b48c", gift: "#d9b45a",
  discover: "#f2e266", spread: "#c7d96a", lost: "#8a7a9a", fireout: "#7a5a4a", ember: "#e8743a", weir: "#5aa8c8", sow: "#9ac25a", harvest: "#e8c25a",
  hut: "#c6a25c", pit: "#9a7650", field: "#b8c25a", seed: "#e0b84a", gather: "#e89a6a", disperse: "#c8a090", village: "#ffd08a", villagegrow: "#e8bc78", abandon: "#8a7a6a", return: "#d0b07a",
  found: "#b5704a", exhausted: "#7a6a5a", regrown: "#6fae5a",
  well: "#5a9ac8", granary: "#d2a860", kiln: "#c06a3a", pen: "#a8905a", upgrade: "#c8a070", built: "#b89a6a",
};

export interface Filter {
  /** categories to leave out */
  hide?: ReadonlySet<CategoryKey>;
  /** only events this notable or more */
  minSig?: number;
  /** only events this person was in, or this band's */
  who?: number;
  band?: number;
  /** words that must all appear in the text */
  text?: string;
}

const MAX_EVENTS = 24000, KEEP_EVENTS = 18000, KEEP_RECENT = 3000;

export class History {
  events: ChronicleEvent[] = [];
  /** one head count per day: [time, people] */
  pop: [number, number][] = [];
  /** the first moment recorded */
  origin = Infinity;
  /** changes whenever something is added, for anything that caches; `eventVersion` only when an event is */
  version = 0;
  eventVersion = 0;
  private lastDay = -1;
  private ids = new Set<number>();

  add(evs: ChronicleEvent[]): void {
    for (const e of evs) {
      if (this.ids.has(e.id)) continue;
      this.ids.add(e.id);
      this.events.push(e);
      if (e.t < this.origin) this.origin = e.t;
    }
    if (evs.length) { this.version++; this.eventVersion++; if (this.events.length > MAX_EVENTS) this.thin(); }
  }
  /** Notes the head count; one sample is kept per day. */
  sample(t: number, people: number): void {
    if (t < this.origin) this.origin = t;
    const day = Math.floor(t / DAY_SECONDS);
    if (day === this.lastDay) return;
    this.lastDay = day;
    this.pop.push([t, people]);
    this.version++;
  }
  /** Let go of the least notable of the old events. */
  private thin(): void {
    const cut = this.events.length - KEEP_RECENT;
    const old = this.events.slice(0, cut), recent = this.events.slice(cut);
    const drop = new Set(old.slice().sort((a, b) => a.sig - b.sig || a.t - b.t).slice(0, this.events.length - KEEP_EVENTS).map(e => e.id));
    for (const id of drop) this.ids.delete(id);
    this.events = [...old.filter(e => !drop.has(e.id)), ...recent];
  }

  /** Index of the first event at or after t. */
  lowerBound(t: number): number {
    let lo = 0, hi = this.events.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.events[m].t < t) lo = m + 1; else hi = m; }
    return lo;
  }
  /** Events in [t0, t1]. */
  between(t0: number, t1: number): ChronicleEvent[] {
    const out: ChronicleEvent[] = [];
    for (let i = this.lowerBound(t0); i < this.events.length && this.events[i].t <= t1; i++) out.push(this.events[i]);
    return out;
  }
  /** The head count nearest to t. */
  popAt(t: number): number {
    if (!this.pop.length) return 0;
    let lo = 0, hi = this.pop.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.pop[m][0] < t) lo = m + 1; else hi = m; }
    return this.pop[lo][1];
  }

  /** Newest first. */
  filter(f: Filter, limit = Infinity): ChronicleEvent[] {
    const words = (f.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const out: ChronicleEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.events[i];
      if (f.hide?.has(categoryOf(e.kind))) continue;
      if (f.minSig !== undefined && e.sig < f.minSig) continue;
      if (f.who !== undefined && !e.who.includes(f.who)) continue;
      if (f.band !== undefined && e.band !== f.band) continue;
      if (words.length) { const t = (e.text + " " + e.title).toLowerCase(); if (!words.every(w => t.includes(w))) continue; }
      out.push(e);
    }
    return out;
  }
  byId(id: number): ChronicleEvent | undefined {
    for (let k = this.events.length - 1; k >= 0; k--) if (this.events[k].id === id) return this.events[k];
    return undefined;
  }

  /**
    The nearest event of at least `minSig` to a moment, looking both ways. dir -1 finds the one before
    it, +1 the one after (neither counts an event at exactly t when `skip` is given).
  */
  step(t: number, dir: -1 | 1, minSig: number, skipId = 0): ChronicleEvent | undefined {
    if (dir < 0) { for (let i = this.lowerBound(t) - 1; i >= 0; i--) { const e = this.events[i]; if (e.sig >= minSig && e.id !== skipId && e.t < t) return e; } return undefined; }
    for (let i = this.lowerBound(t); i < this.events.length; i++) { const e = this.events[i]; if (e.sig >= minSig && e.id !== skipId && e.t > t) return e; }
    return undefined;
  }
}
