import type { ChronicleEvent } from "../shared/people.ts";
import { DAY_SECONDS, SEASON_NAMES } from "../shared/types.ts";
import { SEASON_SECONDS, YEAR_SECONDS, dayOfSeason, seasonOf, yearOf, type History } from "./history.ts";

/* The arithmetic of the history ribbon: which stretch of time is showing, where things sit in it, and which events are shown. */

export interface Window { t0: number; t1: number; }

export const xOf = (w: Window, t: number, width: number) => (t - w.t0) / (w.t1 - w.t0) * width;
export const tOf = (w: Window, x: number, width: number) => w.t0 + x / width * (w.t1 - w.t0);

/** The closest the ribbon zooms in (a few days) and out (the whole of history, plus a margin). */
export const MIN_SPAN = DAY_SECONDS * 4;

/** Zoom around a moment so that moment stays under the pointer. factor > 1 zooms in. */
export function zoom(w: Window, anchor: number, factor: number, maxSpan: number): Window {
  const span = w.t1 - w.t0, next = Math.max(MIN_SPAN, Math.min(maxSpan, span / factor)), k = (anchor - w.t0) / span;
  return { t0: anchor - k * next, t1: anchor + (1 - k) * next };
}
/** Slide the window, never past `lo` or `hi` (the ends of history). */
export function pan(w: Window, dt: number, lo: number, hi: number): Window {
  const span = w.t1 - w.t0;
  let t0 = w.t0 + dt;
  t0 = Math.max(lo, Math.min(Math.max(lo, hi - span), t0));
  return { t0, t1: t0 + span };
}
/** The window that follows the present: `span` long, ending just past now, never before the start of history. */
export function liveWindow(now: number, origin: number, span: number): Window {
  const t1 = now + span * 0.03, t0 = Math.max(Math.min(origin, now), t1 - span);
  return { t0, t1: Math.max(t1, t0 + Math.max(MIN_SPAN, SEASON_SECONDS)) };
}

export interface Mark { e: ChronicleEvent; x: number; big: boolean; }

/**
  The events to show as banners. Heaviest first, each takes its place only if the room is free, so
  zooming in reveals smaller events between the big ones. Marks keep their place as time passes,
  because weight, not position, decides.
*/
export function pickMarks(h: History, w: Window, width: number, minGap: number, minSig: number): Mark[] {
  const cand = h.between(w.t0, w.t1).filter(e => e.sig >= minSig).sort((a, b) => b.sig - a.sig || b.t - a.t);
  const taken: number[] = [], out: Mark[] = [];
  for (const e of cand) {
    const x = xOf(w, e.t, width);
    /* a sorted list of taken columns; a binary search says whether this one is crowded */
    let lo = 0, hi = taken.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (taken[m] < x) lo = m + 1; else hi = m; }
    if ((lo > 0 && x - taken[lo - 1] < minGap) || (lo < taken.length && taken[lo] - x < minGap)) continue;
    taken.splice(lo, 0, x);
    out.push({ e, x, big: e.sig >= 0.6 });
  }
  return out.sort((a, b) => a.x - b.x);
}

/** The mark nearest to x within reach, or undefined. */
export function nearest(marks: Mark[], x: number, reach: number): Mark | undefined {
  let best: Mark | undefined, bd = reach;
  for (const m of marks) { const d = Math.abs(m.x - x); if (d <= bd) { bd = d; best = m; } }
  return best;
}

export interface Tick { t: number; x: number; label: string; major: boolean; }

/** Year, season and day marks along the ribbon, as many as there is room to label. */
export function ticks(w: Window, width: number): Tick[] {
  const span = w.t1 - w.t0, px = (secs: number) => secs / span * width;
  const out: Tick[] = [];
  const units = [DAY_SECONDS, SEASON_SECONDS, YEAR_SECONDS, YEAR_SECONDS * 10, YEAR_SECONDS * 100];
  /* the finest unit with room for a label gets labels; one finer gets plain ticks */
  let major = units.findIndex(u => px(u) >= 52);
  if (major < 0) major = units.length - 1;
  const minor = major > 0 ? major - 1 : -1;
  const each = (u: number, isMajor: boolean) => {
    if (u < 0 || px(units[u]) < 5) return;
    const step = units[u];
    for (let t = Math.ceil(w.t0 / step) * step; t < w.t1; t += step) {
      if (isMajor) out.push({ t, x: xOf(w, t, width), label: labelFor(t, units[u]), major: true });
      else if (t % units[major] !== 0) out.push({ t, x: xOf(w, t, width), label: "", major: false });
    }
  };
  each(minor, false); each(major, true);
  return out;
}
function labelFor(t: number, unit: number): string {
  if (unit >= YEAR_SECONDS * 10) return `Y${yearOf(t)}`;
  if (unit >= YEAR_SECONDS) return `Year ${yearOf(t)}`;
  if (unit >= SEASON_SECONDS) return `${SEASON_NAMES[seasonOf(t)]}${seasonOf(t) === 0 ? ` Y${yearOf(t)}` : ""}`;
  return `d${dayOfSeason(t)}`;
}
