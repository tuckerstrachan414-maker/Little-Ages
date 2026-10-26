import type { ChronicleEvent } from "../shared/people.ts";

/*
  The Spotlight's eye. It watches events as they happen and, whenever the camera is free, picks
  the one most worth seeing: the heaviest, the freshest, and not a band it has only just visited.
  It never invents anything; it only chooses among things people actually did.
*/

export interface Pick { e: ChronicleEvent; at: number; }

export class Director {
  private queue: Pick[] = [];
  private visited = new Map<number, number>();
  /** events below this weight are never worth a trip */
  minSig = 0.45;
  /** how long, in real milliseconds, an event stays worth seeing */
  fresh = 70_000;
  /** how long, in real milliseconds, before a band is worth visiting again */
  revisit = 30_000;

  offer(e: ChronicleEvent, now: number): void {
    if (e.sig >= this.minSig) this.queue.push({ e, at: now });
    if (this.queue.length > 60) this.queue.splice(0, this.queue.length - 60);
  }
  /** The best event to look at now, taken off the queue, or null. */
  next(now: number): ChronicleEvent | null {
    this.queue = this.queue.filter(p => now - p.at < this.fresh);
    let best = -1, bs = 0;
    this.queue.forEach((p, i) => {
      const age = (now - p.at) / this.fresh, seen = now - (this.visited.get(p.e.band) ?? -1e9);
      const s = p.e.sig * (1 - 0.6 * age) * (seen < this.revisit ? 0.4 : 1);
      if (s > bs) { bs = s; best = i; }
    });
    if (best < 0) return null;
    const [p] = this.queue.splice(best, 1);
    this.visited.set(p.e.band, now);
    return p.e;
  }
  /** Looking at a band for another reason (a click, a search) counts as a visit. */
  noteVisit(band: number, now: number): void { this.visited.set(band, now); }
  get waiting(): number { return this.queue.length; }
  clear(): void { this.queue = []; this.visited.clear(); }
}
