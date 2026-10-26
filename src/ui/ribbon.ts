import type { ChronicleEvent } from "../shared/people.ts";
import { Bubble } from "../shared/people.ts";
import { drawBubble } from "../render/sprites/people.ts";
import { dateLong, dateText, KIND_COLOR, NOTABLE, SEASON_SECONDS, YEAR_SECONDS, type History } from "./history.ts";
import { liveWindow, MIN_SPAN, nearest, pan, pickMarks, tOf, ticks, xOf, zoom, type Mark, type Window } from "./timeline.ts";
import type { Dock } from "./dock.ts";

/*
  The history ribbon: a strip along the bottom with the whole story of the world on it. Seasons
  run along the foot, the head count rises and falls above them, and every notable moment
  stands as a banner: a little speech bubble of what it was about. Heavier events are larger,
  and zooming in shows the smaller ones between. Drag along it to scrub through the past, and
  the camera hops to where each thing happened; let go to settle there and pin the people
  involved. Click a banner to go straight to it. The wheel zooms, shift-drag slides, and NOW
  brings you back to the present. Nothing here changes what happens; it is a way to look back.
*/

export interface RibbonCallbacks {
  /** Go and look at an event. `settle` is true when the player has chosen it (pin the people involved). */
  show: (e: ChronicleEvent, settle: boolean) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** spring, summer, autumn, winter */
const SEASON_COLOR = ["#5e8a4a", "#c3a038", "#a85a34", "#7f98ae"];
const PRESETS: { key: string; label: string; years: number; title: string }[] = [
  { key: "year", label: "YEAR", years: 1, title: "Show the last year" },
  { key: "five", label: "5Y", years: 5, title: "Show the last five years" },
  { key: "all", label: "ALL", years: 0, title: "Show all of history" },
];

export class Ribbon {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tip: HTMLElement;
  private readout: HTMLElement;
  private presetBtns = new Map<string, HTMLButtonElement>();
  private live = true;
  /** the span the live window keeps; 0 means all of history */
  private years = 5;
  private win: Window = { t0: 0, t1: 1 };
  private now = 0;
  /** where the gold head sits while the player looks back */
  private head: number | null = null;
  private active: ChronicleEvent | null = null;
  private hover: Mark | null = null;
  private hoverT: number | null = null;
  private marks: Mark[] = [];
  private marksKey = "";
  private drag: { mode: "scrub" | "pan"; x: number; moved: boolean; shown: number } | null = null;
  private edge = 0;
  /** an event the scrub passed over while the camera was still flying; shown when it can be */
  private pendingPreview: ChronicleEvent | null = null;
  private dirty = true;
  private lastDraw = 0;
  private lastFlight = 0;
  private w = 1;
  private dpr = 1;
  /** the strip's height in pixels: shorter on a short screen */
  private trackH = 76;
  private readonly hist: History;
  private readonly cb: RibbonCallbacks;

  constructor(root: HTMLElement, dock: Dock, hist: History, cb: RibbonCallbacks, onChange: (open: boolean) => void) {
    this.hist = hist; this.cb = cb;
    this.el = el("div", "ribbon"); this.el.id = "hud-ribbon";
    this.el.innerHTML = `
      <div class="rb-top">
        <span class="rb-title">HISTORY</span>
        <span class="rb-readout" aria-live="off"></span>
        <span class="rb-ctl">
          <button type="button" data-a="prev" title="Previous notable moment (left arrow)" aria-label="Previous notable moment">&#9664;</button>
          <button type="button" data-a="next" title="Next notable moment (right arrow)" aria-label="Next notable moment">&#9654;</button>
          <span class="rb-seg" role="group" aria-label="How much history to show">${PRESETS.map(p => `<button type="button" data-preset="${p.key}" title="${p.title}" aria-pressed="false">${p.label}</button>`).join("")}</span>
          <button type="button" data-a="now" class="rb-now" title="Back to the present (End)">NOW</button>
        </span>
      </div>
      <div class="rb-track"><canvas tabindex="0" role="img" aria-label="Timeline of the world's history. Drag to look back, scroll to zoom, arrow keys to step between moments."></canvas><div class="rb-tip" hidden></div></div>
`;
    this.canvas = this.el.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.tip = this.el.querySelector(".rb-tip")!;
    this.readout = this.el.querySelector(".rb-readout")!;
    this.el.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach(b => this.presetBtns.set(b.dataset.preset!, b));
    dock.add("history", this.el, { slot: "float", slide: "down", label: "HISTORY", order: 6, open: true, onChange });
    this.bind();
    this.setPreset("five");
    new ResizeObserver(() => { this.dirty = true; }).observe(this.el);
    const h = () => root.style.setProperty("--ribbon-h", `${this.el.offsetHeight}px`);
    new ResizeObserver(h).observe(this.el); h();
  }

  /** The window being shown right now. */
  window(): Window {
    if (this.live) return liveWindow(this.now, Math.min(this.hist.origin, this.now), this.years ? this.years * YEAR_SECONDS : Math.max(this.now - Math.min(this.hist.origin, this.now), SEASON_SECONDS) / 0.97);
    return this.win;
  }
  get height(): number { return this.el.offsetHeight; }

  /* ---------------- the player's moves ---------------- */

  setPreset(key: string): void {
    const p = PRESETS.find(q => q.key === key)!;
    this.years = p.years; this.live = true; this.head = null; this.active = null; this.hover = null;
    this.mark();
  }
  goNow(): void { this.setPreset(this.years === 0 ? "all" : this.years === 1 ? "year" : "five"); }
  private freeze(): void { if (this.live) { this.win = this.window(); this.live = false; } }
  private bounds(): [number, number] { return [Math.min(this.hist.origin, this.now) - SEASON_SECONDS * 0.5, this.now + SEASON_SECONDS * 0.5]; }
  private maxSpan(): number { const [lo, hi] = this.bounds(); return Math.max(MIN_SPAN * 2, (hi - lo) * 1.05); }
  /** Make sure a moment is in view, centering the window on it if not. */
  private reveal(t: number): void {
    const w = this.window(), span = w.t1 - w.t0;
    if (t >= w.t0 + span * 0.04 && t <= w.t1 - span * 0.04) return;
    this.freeze();
    const [lo, hi] = this.bounds();
    this.win = pan({ t0: t - span / 2, t1: t + span / 2 }, 0, lo, hi);
    if (this.win.t1 >= this.now) this.live = false;
  }
  /** Step to the next or previous notable moment and go there. */
  step(dir: -1 | 1): void {
    const from = this.active ? this.active.t : this.head ?? this.now;
    const e = this.hist.step(from, dir, NOTABLE, this.active?.id ?? 0) ?? this.hist.step(from, dir, 0, this.active?.id ?? 0);
    if (e) this.pick(e, true);
  }
  /** Go to an event and mark it on the ribbon. */
  pick(e: ChronicleEvent, settle: boolean): void {
    this.active = e; this.head = e.t; this.reveal(e.t); this.mark();
    this.cb.show(e, settle);
  }
  /** Mark an event as the one being looked at, without moving anything (the Spotlight, the news). */
  note(e: ChronicleEvent | null): void { this.active = e; this.head = e ? e.t : null; if (e) this.reveal(e.t); this.mark(); }
  mark(): void { this.dirty = true; }

  /* ---------------- pointer, wheel, keys ---------------- */

  private bind(): void {
    const c = this.canvas;
    const at = (e: PointerEvent | WheelEvent) => { const r = c.getBoundingClientRect(); return e.clientX - r.left; };
    this.el.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach(b => b.onclick = () => this.setPreset(b.dataset.preset!));
    this.el.querySelector<HTMLButtonElement>('[data-a="prev"]')!.onclick = () => this.step(-1);
    this.el.querySelector<HTMLButtonElement>('[data-a="next"]')!.onclick = () => this.step(1);
    this.el.querySelector<HTMLButtonElement>('[data-a="now"]')!.onclick = () => this.goNow();

    c.addEventListener("pointerdown", e => {
      c.setPointerCapture(e.pointerId); c.focus({ preventScroll: true });
      const x = at(e), mode = e.shiftKey || e.button === 1 || e.button === 2 ? "pan" : "scrub";
      this.drag = { mode, x, moved: false, shown: 0 };
      if (mode === "scrub") this.scrubTo(x, false);
      this.hideTip();
    });
    c.addEventListener("pointermove", e => {
      const x = at(e);
      this.hoverT = tOf(this.window(), x, this.w);
      if (this.drag) {
        if (Math.abs(x - this.drag.x) > 3) this.drag.moved = true;
        if (this.drag.mode === "pan") {
          this.freeze(); const w = this.win, dt = -(x - this.drag.x) / this.w * (w.t1 - w.t0); this.drag.x = x;
          const [lo, hi] = this.bounds(); this.win = pan(w, dt, lo, hi); this.live = false;
        } else this.scrubTo(x, false);
        /* near either end while scrubbing, the ribbon slides on by itself */
        this.edge = this.drag.mode === "scrub" ? (x < 28 ? -1 : x > this.w - 28 ? 1 : 0) : 0;
      } else {
        const m = nearest(this.marks, x, 11);
        if (m !== this.hover) { this.hover = m ?? null; c.style.cursor = m ? "pointer" : "ew-resize"; }
        if (m) this.showTip(m); else this.hideTip();
      }
      this.mark();
    });
    const end = (e: PointerEvent) => {
      const d = this.drag; this.drag = null; this.edge = 0;
      if (!d) return;
      if (d.mode === "scrub") this.scrubTo(at(e), true);
      this.mark();
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", () => { this.drag = null; this.edge = 0; });
    c.addEventListener("pointerleave", () => { this.hover = null; this.hoverT = null; this.hideTip(); this.mark(); });
    c.addEventListener("wheel", e => {
      e.preventDefault();
      const w = this.window();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.freeze(); const [lo, hi] = this.bounds(); const d = (e.deltaX || e.deltaY) / this.w * (w.t1 - w.t0);
        this.win = pan(this.win, d, lo, hi);
      } else {
        const anchor = tOf(w, at(e), this.w), f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
        this.freeze(); this.win = zoom(this.win, anchor, f, this.maxSpan());
        const [lo, hi] = this.bounds(); this.win = pan(this.win, 0, lo, hi);
      }
      this.live = this.win.t1 >= this.now - (this.win.t1 - this.win.t0) * 0.02;
      if (this.live) this.years = Math.round((this.win.t1 - this.win.t0) / YEAR_SECONDS * 100) / 100 || 0.1;
      this.mark();
    }, { passive: false });
    c.addEventListener("keydown", e => {
      if (e.key === "ArrowLeft") { this.step(-1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { this.step(1); e.preventDefault(); }
      else if (e.key === "Home") { this.setPreset("all"); e.preventDefault(); }
      else if (e.key === "End") { this.goNow(); e.preventDefault(); }
      else if (e.key === "Enter" && this.active) { this.cb.show(this.active, true); e.preventDefault(); }
      else if (e.key === "+" || e.key === "=") { this.zoomBy(1.5); e.preventDefault(); }
      else if (e.key === "-" || e.key === "_") { this.zoomBy(1 / 1.5); e.preventDefault(); }
    });
  }
  private zoomBy(f: number): void {
    const w = this.window(); this.freeze();
    this.win = zoom(this.win, this.active?.t ?? (w.t0 + w.t1) / 2, f, this.maxSpan());
    const [lo, hi] = this.bounds(); this.win = pan(this.win, 0, lo, hi);
    this.live = this.win.t1 >= this.now - (this.win.t1 - this.win.t0) * 0.02;
    this.mark();
  }

  /** Move the gold head to x; the event under it (or close) is previewed, and on release, chosen. */
  private scrubTo(x: number, release: boolean): void {
    const w = this.window();
    const t = Math.max(Math.min(this.hist.origin, this.now), Math.min(this.now, tOf(w, x, this.w)));
    this.head = t;
    /* the nearest banner within reach, wider than hover so a rough drag still lands */
    const m = nearest(this.marks, x, release ? 40 : 26) ?? nearest(this.marks, x, 60);
    if (m) {
      if (!this.active || this.active.id !== m.e.id) {
        this.active = m.e;
        const now = performance.now();
        if (release) { this.cb.show(m.e, true); }
        else if (now - this.lastFlight > 320) { this.lastFlight = now; this.cb.show(m.e, false); }
        else this.pendingPreview = m.e;
      } else if (release) this.cb.show(m.e, true);
      this.showTip(m, true);
    } else if (release) this.hideTip();
    if (release) this.pendingPreview = null;
    this.mark();
  }

  /* ---------------- the tooltip ---------------- */

  private showTip(m: Mark, pinned = false): void {
    const e = m.e;
    this.tip.hidden = false; this.tip.classList.toggle("pinned", pinned);
    this.tip.innerHTML = `<b>${esc(e.title)}</b><small>${esc(dateLong(e.t))}</small><span>${esc(e.text)}</span>`;
    const tw = this.tip.offsetWidth, left = Math.max(tw / 2 + 4, Math.min(this.w - tw / 2 - 4, m.x));
    this.tip.style.left = `${Math.round(left)}px`;
  }
  private hideTip(): void { this.tip.hidden = true; }

  /* ---------------- drawing ---------------- */

  /** Call every frame with the game clock. Redraws when something changed, and about five times a second regardless. */
  frame(now: number, real: number): void {
    this.now = now;
    if (this.edge && this.drag) {
      this.freeze(); const w = this.win, [lo, hi] = this.bounds();
      this.win = pan(w, this.edge * (w.t1 - w.t0) * 0.012, lo, hi); this.live = false;
      this.scrubTo(this.edge < 0 ? 0 : this.w, false);
      this.dirty = true;
    }
    if (this.pendingPreview && real - this.lastFlight > 320) { this.lastFlight = real; this.cb.show(this.pendingPreview, false); this.pendingPreview = null; }
    if (!this.dirty && real - this.lastDraw < 200) return;
    this.dirty = false; this.lastDraw = real;
    if (this.el.offsetParent === null && !this.el.isConnected) return;
    this.draw(real);
  }

  private syncSize(): boolean {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width)), h = window.innerHeight < 620 ? 62 : 76;
    if (w <= 1) return false;
    if (this.w !== w || this.dpr !== dpr || this.trackH !== h || this.canvas.height !== Math.round(h * dpr)) {
      this.w = w; this.dpr = dpr; this.trackH = h; this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.canvas.style.height = `${h}px`; this.marksKey = "";
    }
    return true;
  }

  private draw(real: number): void {
    if (!this.syncSize()) return;
    const ctx = this.ctx, W = this.w, H = this.trackH, BASE = H - 11, w = this.window(), span = w.t1 - w.t0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#2a221b"; ctx.fillRect(0, 0, W, H);

    /* seasons along the foot */
    const sy = H - 8, sh = 6;
    for (let s = Math.floor(w.t0 / SEASON_SECONDS); s * SEASON_SECONDS < w.t1; s++) {
      const x0 = Math.max(0, xOf(w, s * SEASON_SECONDS, W)), x1 = Math.min(W, xOf(w, (s + 1) * SEASON_SECONDS, W));
      if (x1 <= x0) continue;
      ctx.fillStyle = SEASON_COLOR[((s % 4) + 4) % 4]; ctx.fillRect(Math.round(x0), sy, Math.max(1, Math.round(x1) - Math.round(x0)), sh);
      if (x1 - x0 > 5) { ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(Math.round(x1) - 1, sy, 1, sh); }
    }
    ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(0, sy, W, 1);

    /* year, season and day marks */
    ctx.font = '9px "Silkscreen", ui-monospace, monospace'; ctx.textBaseline = "top";
    for (const t of ticks(w, W)) {
      const x = Math.round(t.x) + 0.5;
      ctx.fillStyle = t.major ? "rgba(243,234,210,.22)" : "rgba(243,234,210,.1)";
      ctx.fillRect(x - 0.5, t.major ? 12 : BASE - 6, 1, t.major ? sy - 12 : 6);
      if (t.label) { ctx.fillStyle = "#cdbd98"; ctx.fillText(t.label, x + 3, 2); }
    }

    /* the head count, rising and falling */
    const pts = this.hist.pop.filter(p => p[0] >= w.t0 - 2400 && p[0] <= w.t1 + 2400);
    if (pts.length > 1) {
      /* scaled between the lowest and highest in view, so a small change still shows */
      let max = 1, min = Infinity; for (const p of pts) { max = Math.max(max, p[1]); min = Math.min(min, p[1]); }
      const lo = Math.max(0, min - (max - min) * 0.25 - max * 0.04), top = H * 0.52, bot = BASE + 2, y = (n: number) => bot - ((n - lo) / Math.max(1, max - lo)) * (bot - top);
      ctx.beginPath(); ctx.moveTo(xOf(w, pts[0][0], W), bot);
      for (const p of pts) ctx.lineTo(xOf(w, p[0], W), y(p[1]));
      ctx.lineTo(xOf(w, pts[pts.length - 1][0], W), bot); ctx.closePath();
      ctx.fillStyle = "rgba(246,215,122,.12)"; ctx.fill();
      ctx.beginPath(); pts.forEach((p, i) => { const px = xOf(w, p[0], W), py = y(p[1]); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.strokeStyle = "rgba(246,215,122,.55)"; ctx.lineWidth = 1; ctx.stroke();
    }

    /* banners; the choice is cached until the window, the width or the history changes */
    const minSig = Math.max(0, Math.min(0.5, 0.1 * Math.log2(Math.max(1e-9, span) / (SEASON_SECONDS / 2))));
    const key = `${this.hist.version}|${Math.round(w.t0)}|${Math.round(w.t1)}|${W}`;
    if (key !== this.marksKey) { this.marksKey = key; this.marks = pickMarks(this.hist, w, W, 22, minSig); }
    /* the smaller events, as ticks on the baseline */
    const shown = new Set(this.marks.map(m => m.e.id));
    let drawn = 0;
    for (let i = this.hist.lowerBound(w.t0); i < this.hist.events.length && drawn < 4000; i++) {
      const e = this.hist.events[i]; if (e.t > w.t1) break;
      if (shown.has(e.id)) continue;
      ctx.fillStyle = KIND_COLOR[e.kind] ?? "#ccc"; ctx.globalAlpha = 0.55 + 0.4 * e.sig;
      ctx.fillRect(Math.round(xOf(w, e.t, W)), BASE - 1, 1, 2 + Math.round(e.sig * 4)); drawn++;
    }
    ctx.globalAlpha = 1;
    for (const m of this.marks) {
      const e = m.e, col = KIND_COLOR[e.kind] ?? "#ccc", big = m.big;
      const x = Math.round(m.x), top = big ? 14 : 26;
      ctx.fillStyle = col; ctx.fillRect(x, top + (big ? 22 : 11), 1, BASE - top - (big ? 22 : 11));
      ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(x + 1, top + (big ? 22 : 11), 1, BASE - top - (big ? 22 : 11));
      const hot = this.hover?.e.id === e.id || this.active?.id === e.id;
      if (hot) { ctx.fillStyle = "#f6d77a"; ctx.fillRect(x - (big ? 15 : 8), top - 2, big ? 29 : 15, 2); }
      drawBubble(ctx, x, top + (big ? 20 : 10), e.icon || Bubble.Sun, big ? 2 : 1);
      ctx.fillStyle = col; ctx.fillRect(x - 1, BASE, 3, 2); ctx.fillRect(x - 1, top + (big ? 22 : 11), 3, 2);
    }

    /* now */
    const nx = xOf(w, this.now, W);
    if (nx >= 0 && nx <= W + 2) {
      const pulse = 0.55 + 0.45 * Math.sin(real / 400);
      ctx.fillStyle = `rgba(255,248,226,${0.5 + 0.3 * pulse})`; ctx.fillRect(Math.round(Math.min(nx, W - 1)), 12, 1, sy - 12);
      ctx.fillStyle = "#fff8e2"; ctx.fillRect(Math.round(Math.min(nx, W - 1)) - 2, sy - 2, 5, 2);
    }
    /* the gold head, where the player is looking */
    if (this.head !== null) {
      const hx = Math.round(xOf(w, this.head, W));
      if (hx >= -2 && hx <= W + 2) {
        ctx.fillStyle = "#f6d77a"; ctx.fillRect(hx, 4, 2, sy - 4);
        ctx.beginPath(); ctx.moveTo(hx - 4, 0); ctx.lineTo(hx + 6, 0); ctx.lineTo(hx + 1, 6); ctx.closePath(); ctx.fill();
      }
    }
    /* the pointer's own faint guide */
    if (this.hoverT !== null && !this.drag) { const px = Math.round(xOf(w, this.hoverT, W)); ctx.fillStyle = "rgba(246,215,122,.35)"; ctx.fillRect(px, 6, 1, sy - 6); }

    /* the words above: the date under the pointer or the head while looking back, otherwise today's */
    const looking = this.drag ? this.head : this.hoverT ?? this.head;
    const t = Math.max(0, looking ?? this.now), people = looking === null ? this.hist.pop[this.hist.pop.length - 1]?.[1] ?? 0 : this.hist.popAt(t);
    this.readout.classList.toggle("past", looking !== null);
    this.readout.innerHTML = `<b>${esc(dateText(t))}</b><small>${people ? `${people} people` : ""}</small>`;
    const n = this.hist.events.length;
    this.canvas.setAttribute("aria-label", `Timeline of the world's history, ${n} moments so far. Drag to look back, scroll to zoom, arrow keys to step between moments.`);
    for (const [k, b] of this.presetBtns) {
      const p = PRESETS.find(q => q.key === k)!;
      b.setAttribute("aria-pressed", String(this.live && p.years === this.years));
    }
    this.el.querySelector(".rb-now")!.classList.toggle("lit", !this.live || this.head !== null);
  }
}
