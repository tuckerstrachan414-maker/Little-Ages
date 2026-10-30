import type { ChronicleEvent } from "../shared/people.ts";
import { Known, type TechDefLite, type TechGroup, type TechPanelData, type TechNodeDetail } from "../shared/tech.ts";
import { BRANCH_NAMES, ERA_NAMES } from "../sim/tech/defs.ts";
import { drawBubble } from "../render/sprites/people.ts";
import { frameURL } from "./hud.ts";
import { dateText, type History } from "./history.ts";
import type { Dock } from "./dock.ts";
import { el, esc } from "./dom.ts";

/*
  The tree of knowledge: every way of doing things anyone could ever work out, from keeping
  a fire to leaving the planet, laid out with the branches of life as rows and the ages as
  columns. Pick whose knowledge to look at: the whole world, one people, or one village.
  What they know is lit in their color, what is within their reach is outlined, and the rest
  is grey. Nothing here is a ladder anyone climbs: it only records what people have done.
  Click a node for who worked it out, when and where, and who knows it now.
*/

export interface TechCallbacks { ask: (g: TechGroup) => void; askNode: (id: number, g: TechGroup) => void; show: (e: ChronicleEvent) => void; fly: (x: number, y: number) => void; }
interface Box { id: number; x: number; y: number; w: number; h: number; }

const NODE_W = 132, NODE_H = 20, GAP = 5, COL_W = 160, ROW_PAD = 10, LEFT = 118, TOP = 34, GUT = 14;
const GREY = "#ddd3b8", GREY_INK = "#8a7a5c", INK = "#2b2418", PAPER = "#f2e6c8";

export class TechPanel {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement; private ctx: CanvasRenderingContext2D;
  private card: HTMLElement; private select: HTMLSelectElement; private ageEl: HTMLElement; private tip: HTMLElement; private filter: HTMLInputElement;
  private defs: TechDefLite[] = [];
  private data: TechPanelData | null = null;
  private detail: TechNodeDetail | null = null;
  group: TechGroup = { kind: "world", id: 0 };
  private boxes: Box[] = []; private byId = new Map<number, Box>();
  private cols: number[] = []; private rows: number[] = []; private W = 0; private H = 0;
  private z = 1; private ox = 0; private oy = 0; private fitted = false;
  private hover = -1; selected = -1;
  private lastAsk = 0; private drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
  private needsDraw = true; private q = "";
  private readonly hist: History; private readonly cb: TechCallbacks; private readonly dock: Dock;

  constructor(dock: Dock, hist: History, cb: TechCallbacks) {
    this.dock = dock; this.hist = hist; this.cb = cb;
    this.el = el("div", "paper"); this.el.id = "hud-tech";
    this.el.style.borderImageSource = `url(${frameURL()})`;
    this.el.innerHTML = `<div class="th"><h3>What is known</h3><select class="tg" aria-label="Whose knowledge"></select><span class="age"></span><input class="tq" type="search" placeholder="Find a way of doing things" aria-label="Find"><span class="hint muted">DRAG TO PAN / WHEEL TO ZOOM / CLICK A NODE / ARROWS AND ENTER TO WALK THE TREE</span></div><div class="tb"><canvas aria-label="The tree of knowledge" tabindex="0"></canvas><div class="tip" hidden></div><div class="tn-card" hidden></div></div>`;
    this.canvas = this.el.querySelector("canvas")!; this.ctx = this.canvas.getContext("2d")!;
    this.card = this.el.querySelector(".tn-card")!; this.select = this.el.querySelector(".tg")!; this.ageEl = this.el.querySelector(".age")!; this.tip = this.el.querySelector(".tip")!; this.filter = this.el.querySelector(".tq")!;
    this.select.onchange = () => { const [kind, id] = this.select.value.split(":"); this.group = { kind: kind as TechGroup["kind"], id: +id }; this.fitted = false; this.lastAsk = 0; this.cb.ask(this.group); if (this.selected >= 0) this.cb.askNode(this.selected, this.group); };
    this.filter.oninput = () => { this.q = this.filter.value.trim().toLowerCase(); this.needsDraw = true; };
    this.bind();
    dock.add("tech", this.el, { slot: "float", slide: "drop", label: "TECH", group: "drop", open: false, order: 3, onChange: on => { if (on) { this.lastAsk = 0; this.resize(); this.needsDraw = true; this.cb.ask(this.group); } } });
    new ResizeObserver(() => { this.resize(); this.needsDraw = true; }).observe(this.el);
  }

  /** The tree itself, once. */
  setTree(defs: TechDefLite[]): void { this.defs = defs; this.layout(); this.needsDraw = true; }
  set(data: TechPanelData): void {
    this.data = data;
    const cur = `${this.group.kind}:${this.group.id}`;
    const opts = data.groups.map(g => `<option value="${g.kind}:${g.id}"${`${g.kind}:${g.id}` === cur ? " selected" : ""}>${g.kind === "settlement" ? "The village of " : ""}${esc(g.name)}</option>`).join("");
    if (this.select.innerHTML !== opts) this.select.innerHTML = opts;
    this.ageEl.textContent = data.group.kind === "world" ? `The furthest people: ${ERA_NAMES[data.group.age]}` : `${ERA_NAMES[data.group.age]}`;
    if (!this.fitted) { this.fit(); this.fitted = true; }
    this.needsDraw = true;
  }
  setNode(d: TechNodeDetail): void { if (d.id !== this.selected) return; this.detail = d; this.renderCard(); }
  /** Opens the panel on a node (from search). */
  open(id: number): void { this.dock.set("tech", true); this.selectNode(id); this.center(id); }

  /** While open, asks the simulation for the latest every couple of seconds, and redraws when something changed. */
  tick(now: number): void {
    if (!this.dock.isOpen("tech")) return;
    if (now - this.lastAsk > 2000) { this.lastAsk = now; this.cb.ask(this.group); if (this.selected >= 0) this.cb.askNode(this.selected, this.group); }
    if (this.needsDraw) { this.needsDraw = false; this.draw(); }
  }

  /* ---------------- layout ---------------- */
  private layout(): void {
    const cells = new Map<string, TechDefLite[]>();
    for (const d of this.defs) { const k = `${d.branch},${d.era}`; let l = cells.get(k); if (!l) { l = []; cells.set(k, l); } l.push(d); }
    for (const l of cells.values()) l.sort((a, b) => a.id - b.id);
    const nB = BRANCH_NAMES.length, nE = ERA_NAMES.length;
    this.rows = []; let y = TOP;
    for (let b = 0; b < nB; b++) { this.rows.push(y); let n = 1; for (let e = 0; e < nE; e++) n = Math.max(n, cells.get(`${b},${e}`)?.length ?? 0); y += n * (NODE_H + GAP) + ROW_PAD * 2; }
    this.rows.push(y); this.H = y;
    this.cols = []; for (let e = 0; e <= nE; e++) this.cols.push(LEFT + e * COL_W); this.W = LEFT + nE * COL_W;
    this.boxes = []; this.byId.clear();
    for (const [k, l] of cells) {
      const [b, e] = k.split(",").map(Number);
      l.forEach((d, i) => { const box = { id: d.id, x: this.cols[e] + GUT, y: this.rows[b] + ROW_PAD + i * (NODE_H + GAP), w: NODE_W, h: NODE_H }; this.boxes.push(box); this.byId.set(d.id, box); });
    }
  }
  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1), r = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`; }
  }
  /** Fits the view to what is known and within reach, with an age of margin. */
  private fit(): void {
    const d = this.data; if (!d || !this.boxes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    for (const b of this.boxes) if (d.nodes[b.id] >= Known.Reach) { any = true; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    if (!any) { x0 = 0; y0 = 0; x1 = this.cols[2]; y1 = this.H; }
    x0 = Math.max(0, x0 - LEFT - 20); y0 = Math.max(0, y0 - TOP - 10); x1 = Math.min(this.W, x1 + COL_W); y1 = Math.min(this.H, y1 + 20);
    const vw = this.canvas.clientWidth || 800, vh = this.canvas.clientHeight || 500;
    this.z = Math.max(0.45, Math.min(1.6, Math.min(vw / (x1 - x0), vh / (y1 - y0))));
    this.ox = (vw - (x1 - x0) * this.z) / 2 - x0 * this.z; this.oy = Math.min(10, (vh - (y1 - y0) * this.z) / 2) - y0 * this.z;
    this.clampView();
  }
  private center(id: number): void {
    const b = this.byId.get(id); if (!b) return;
    const vw = this.canvas.clientWidth || 800, vh = this.canvas.clientHeight || 500;
    this.z = Math.max(this.z, 1); this.ox = vw / 2 - (b.x + b.w / 2) * this.z; this.oy = vh / 2 - (b.y + b.h / 2) * this.z; this.clampView(); this.needsDraw = true;
  }
  private clampView(): void {
    const vw = this.canvas.clientWidth || 800, vh = this.canvas.clientHeight || 500;
    this.ox = Math.min(40, Math.max(vw - this.W * this.z - 40, this.ox)); this.oy = Math.min(40, Math.max(vh - this.H * this.z - 40, this.oy));
  }

  /* ---------------- drawing ---------------- */
  private draw(): void {
    const c = this.ctx, d = this.data, dpr = Math.min(2, window.devicePixelRatio || 1), vw = this.canvas.width / dpr, vh = this.canvas.height / dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = PAPER; c.fillRect(0, 0, vw, vh);
    c.setTransform(this.z * dpr, 0, 0, this.z * dpr, this.ox * dpr, this.oy * dpr);
    const z = this.z, color = d?.group.color ?? INK;
    /* the ages across the top, the branches down the side; ages beyond this build hatched */
    c.font = `600 ${11}px "Silkscreen", "Pixelify Sans", monospace`; c.textBaseline = "middle";
    for (let e = 0; e < ERA_NAMES.length; e++) {
      const x = this.cols[e], w = COL_W, inactive = !this.defs.some(t => t.era === e && t.active);
      if (inactive) { c.fillStyle = "rgba(43,36,24,.045)"; c.fillRect(x, TOP, w, this.H - TOP); }
      c.fillStyle = e % 2 ? "rgba(43,36,24,.03)" : "transparent"; c.fillRect(x, TOP, w, this.H - TOP);
      c.fillStyle = inactive ? GREY_INK : INK; c.textAlign = "center"; c.fillText(ERA_NAMES[e].toUpperCase(), x + w / 2, TOP - 16);
    }
    c.textAlign = "left"; c.font = `600 10px "Silkscreen", "Pixelify Sans", monospace`;
    for (let b = 0; b < BRANCH_NAMES.length; b++) {
      c.fillStyle = "rgba(43,36,24,.12)"; c.fillRect(0, this.rows[b], this.W, 1);
      c.fillStyle = INK; const words = BRANCH_NAMES[b].split(" and ").map(w => w.toUpperCase());
      words.forEach((w, i) => c.fillText(i ? "& " + w : w, 8, this.rows[b] + ROW_PAD + 10 + i * 12));
    }
    c.fillStyle = "rgba(43,36,24,.12)"; c.fillRect(0, this.rows[BRANCH_NAMES.length], this.W, 1);
    /* the lines between a node and what it builds on */
    const state = (id: number) => d?.nodes[id] ?? 0;
    c.lineWidth = 1.2;
    for (const t of this.defs) {
      const to = this.byId.get(t.id)!;
      for (const n of [...t.needs, ...t.any]) {
        const from = this.byId.get(n); if (!from) continue;
        if (!t.active && !this.defs[n].active && state(n) === 0 && z < 0.8) continue;
        const lit = state(t.id) >= Known.Known && state(n) >= Known.Known;
        c.strokeStyle = lit ? color : state(t.id) >= Known.Reach ? "rgba(43,36,24,.5)" : "rgba(43,36,24,.16)";
        c.beginPath();
        const x0 = from.x + from.w, y0 = from.y + from.h / 2, x1 = to.x, y1 = to.y + to.h / 2;
        if (from.x < to.x) { const mx = x0 + (x1 - x0) / 2; c.moveTo(x0, y0); c.lineTo(mx, y0); c.lineTo(mx, y1); c.lineTo(x1, y1); }
        else { /* a need in the same age: a short loop out the right side and back in */ const yy = Math.min(y0, y1) - 6; c.moveTo(x0, y0); c.lineTo(x0 + 6, y0); c.lineTo(x0 + 6, yy); c.lineTo(x1 - 6, yy); c.lineTo(x1 - 6, y1); c.lineTo(x1, y1); }
        c.stroke();
      }
    }
    /* the nodes */
    c.font = `500 ${11}px "Pixelify Sans", "Silkscreen", monospace`; c.textAlign = "left";
    const q = this.q;
    for (const t of this.defs) {
      const b = this.byId.get(t.id)!, st = state(t.id), matches = q && (t.name.toLowerCase().includes(q) || t.how.toLowerCase().includes(q));
      const dim = q ? !matches : false;
      const known = st >= Known.Known, reach = st === Known.Reach, lost = st === Known.Lost;
      let fill = GREY, ink = GREY_INK;
      if (known) { fill = color; ink = lum(color) > 0.55 ? INK : PAPER; }
      else if (reach) { fill = PAPER; ink = INK; }
      else if (lost) { fill = "#c9bfa7"; ink = INK; }
      if (t.start && !known) { fill = "#e8d9b4"; ink = GREY_INK; }
      c.globalAlpha = dim ? 0.3 : 1;
      /* the world view: stripes in the colors of the peoples that know it */
      if (known && d?.colors && d.colors[t.id].length > 1) { const cs = d.colors[t.id], sw = b.w / cs.length; cs.forEach((cc, i) => { c.fillStyle = cc; c.fillRect(b.x + i * sw, b.y, Math.ceil(sw), b.h); }); ink = INK; c.fillStyle = "rgba(242,230,200,.75)"; c.fillRect(b.x + 18, b.y + 3, b.w - 21, b.h - 6); }
      else { c.fillStyle = fill; c.fillRect(b.x, b.y, b.w, b.h); }
      c.strokeStyle = reach ? color : t.id === this.selected ? "#e3ad2f" : t.id === this.hover ? INK : known ? "rgba(43,36,24,.35)" : "rgba(43,36,24,.18)"; c.lineWidth = reach || t.id === this.selected ? 2 : 1;
      c.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      if (!t.active && !known) { c.strokeStyle = "rgba(43,36,24,.08)"; c.lineWidth = 1; for (let k = -b.h; k < b.w; k += 6) { c.beginPath(); c.moveTo(b.x + k, b.y + b.h); c.lineTo(b.x + k + b.h, b.y); c.stroke(); } }
      if (z >= 0.6) drawBubble(c, b.x + 10, b.y + b.h - 3, t.icon, 1);
      c.fillStyle = ink;
      const label = fitText(c, t.name, b.w - 26);
      c.fillText(label, b.x + 20, b.y + b.h / 2 + 0.5);
      if (lost) { c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); c.moveTo(b.x + 20, b.y + b.h / 2); c.lineTo(b.x + 20 + c.measureText(label).width, b.y + b.h / 2); c.stroke(); }
      /* refinement ticks at the right edge */
      if (known && d && d.refine[t.id] > 0.5) { const n = d.refine[t.id] < 1 ? 1 : d.refine[t.id] < 3 ? 2 : d.refine[t.id] < 7 ? 3 : 4; c.fillStyle = ink; for (let k = 0; k < n; k++) c.fillRect(b.x + b.w - 5 - k * 3, b.y + 4, 1, b.h - 8); }
      c.globalAlpha = 1;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- input ---------------- */
  private toWorld(e: PointerEvent | WheelEvent): [number, number] { const r = this.canvas.getBoundingClientRect(); return [(e.clientX - r.left - this.ox) / this.z, (e.clientY - r.top - this.oy) / this.z]; }
  private hit(x: number, y: number): number { for (const b of this.boxes) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id; return -1; }
  private bind(): void {
    const cv = this.canvas;
    cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, moved: false }; });
    cv.addEventListener("pointermove", e => {
      if (this.drag) { const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; if (Math.hypot(dx, dy) > 4) this.drag.moved = true; if (this.drag.moved) { this.ox = this.drag.ox + dx; this.oy = this.drag.oy + dy; this.clampView(); this.needsDraw = true; } return; }
      const [x, y] = this.toWorld(e), h = this.hit(x, y);
      if (h !== this.hover) { this.hover = h; this.needsDraw = true; this.showTip(h, e); }
    });
    const up = (e: PointerEvent) => { if (this.drag && !this.drag.moved) { const [x, y] = this.toWorld(e), h = this.hit(x, y); if (h >= 0) this.selectNode(h); } this.drag = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", () => { this.drag = null; });
    cv.addEventListener("pointerleave", () => { this.hover = -1; this.tip.hidden = true; this.needsDraw = true; });
    cv.addEventListener("wheel", e => { e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015), nz = Math.max(0.4, Math.min(2.2, this.z * f)); this.ox = mx - (mx - this.ox) * (nz / this.z); this.oy = my - (my - this.oy) * (nz / this.z); this.z = nz; this.clampView(); this.needsDraw = true; }, { passive: false });
    cv.addEventListener("dblclick", () => { this.fit(); this.needsDraw = true; });
    /* the keyboard walks the tree: arrows step to the nearest node that way, Enter opens its card, Escape (handled by the page) closes the card, then the panel */
    cv.addEventListener("keydown", e => {
      const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (e.key === "Enter" || e.key === " ") { const id = this.selected >= 0 ? this.selected : this.hover; if (id >= 0) { this.selectNode(id); this.center(id); } e.preventDefault(); return; }
      const dir = dirs[e.key]; if (!dir) return;
      e.preventDefault();
      const next = this.step(this.selected >= 0 ? this.selected : this.hover >= 0 ? this.hover : this.firstKnown(), dir);
      if (next >= 0) { this.selected = next; this.detail = null; this.card.hidden = false; this.card.innerHTML = `<p class="muted">Looking...</p>`; this.cb.askNode(next, this.group); this.center(next); this.needsDraw = true; }
    });
    this.card.addEventListener("click", e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ix],[data-ev],[data-fly],[data-close]"); if (!b) return;
      if (b.dataset.ix) { this.selectNode(+b.dataset.ix); this.center(+b.dataset.ix); }
      else if (b.dataset.ev) { const ev = this.hist.byId(+b.dataset.ev); if (ev) { this.dock.set("tech", false); this.cb.show(ev); } }
      else if (b.dataset.fly) { const [x, y] = b.dataset.fly.split(",").map(Number); this.dock.set("tech", false); this.cb.fly(x, y); }
      else if (b.dataset.close !== undefined) { this.selected = -1; this.detail = null; this.card.hidden = true; this.needsDraw = true; }
    });
  }
  private showTip(id: number, e: PointerEvent): void {
    if (id < 0) { this.tip.hidden = true; return; }
    const t = this.defs[id], st = this.data?.nodes[id] ?? 0, n = this.data?.knowers[id] ?? 0;
    const word = st === Known.Known ? `${n} ${n === 1 ? "person knows" : "people know"} it` : st === Known.Reach ? "within reach" : st === Known.Lost ? "known once, lost" : t.active ? "not yet thought of" : "beyond this age";
    this.tip.innerHTML = `<b>${esc(cap(t.name))}</b> ${esc(word)}`; this.tip.hidden = false;
    const r = this.canvas.getBoundingClientRect(); this.tip.style.left = `${Math.min(r.width - 200, e.clientX - r.left + 12)}px`; this.tip.style.top = `${e.clientY - r.top + 14}px`;
  }
  selectNode(id: number): void { this.selected = id; this.detail = null; this.card.hidden = false; this.card.innerHTML = `<p class="muted">Looking...</p>`; this.cb.askNode(id, this.group); this.needsDraw = true; }
  /** The nearest node from `from` in a direction: mostly that way, and not too far aside. */
  private step(from: number, [dx, dy]: [number, number]): number {
    const a = this.byId.get(from); if (!a) return this.firstKnown();
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    let best = -1, bd = Infinity;
    for (const b of this.boxes) {
      if (b.id === from) continue;
      const vx = b.x + b.w / 2 - ax, vy = b.y + b.h / 2 - ay, along = vx * dx + vy * dy, aside = Math.abs(vx * dy) + Math.abs(vy * dx);
      if (along <= 0 || aside > along * 1.5 + 30) continue;
      const d = along + aside * 2; if (d < bd) { bd = d; best = b.id; }
    }
    return best;
  }
  /** Somewhere to start walking from: the first known node of the group, else the first node of all. */
  private firstKnown(): number {
    const d = this.data; if (d) for (const b of this.boxes) if (d.nodes[b.id] >= Known.Known) return b.id;
    return this.boxes.length ? this.boxes[0].id : -1;
  }

  private renderCard(): void {
    const d = this.detail; if (!d) return;
    const first = d.first ? this.hist.events.find(e => e.kind === "discover" && e.who[0] === d.first!.who && Math.abs(e.t - d.first!.t) < 1) : null;
    const link = (n: { id: number; name: string; known: boolean }) => `<button type="button" class="lnk${n.known ? " on" : ""}" data-ix="${n.id}">${esc(n.name)}</button>`;
    const mastery = (m: number) => m < 0.34 ? "still learning" : m < 0.67 ? "good at it" : "a master";
    const firstLine = d.first ? `First worked out by ${esc(d.first.name)} of the ${esc(d.first.bandName)} (${esc(d.first.people)}), ${dateText(d.first.t).toLowerCase()}.${d.times > 1 ? ` Worked out ${d.times} times in all.` : ""} ${first ? `<button type="button" class="lnk" data-ev="${first.id}">Fly there</button>` : `<button type="button" class="lnk" data-fly="${d.first.x},${d.first.y}">Fly there</button>`}` : "";
    const here = d.firstHere && d.first && d.firstHere.who !== d.first.who ? `<p>Here, first by ${esc(d.firstHere.name)} of the ${esc(d.firstHere.bandName)}, ${dateText(d.firstHere.t).toLowerCase()}.</p>` : "";
    this.card.innerHTML = `<button type="button" class="x" data-close aria-label="Close">×</button>
      <h4>${esc(cap(d.name))}</h4><p class="how">${esc(cap(d.how))}. <span class="muted">${esc(BRANCH_NAMES[d.branch])}, ${esc(ERA_NAMES[d.era])}.</span></p>
      <p class="st">${esc(d.status)}</p>${first || d.first ? `<p>${firstLine}</p>` : ""}${here}
      ${d.answers.length ? `<p class="muted">Answers: ${esc(d.answers.join(", "))}.</p>` : ""}
      ${d.needs.length || d.any.length ? `<p>Builds on ${d.needs.map(link).join(", ")}${d.any.length ? `${d.needs.length ? " and " : ""}any of ${d.any.map(link).join(", ")}` : ""}.</p>` : ""}
      ${d.unlocks.length ? `<p>Leads to ${d.unlocks.map(link).join(", ")}.</p>` : ""}
      ${d.knowers.length ? `<p>Known best by ${d.knowers.map(k => `${esc(k.name)} of the ${esc(k.band)} (${mastery(k.m)})`).join(", ")}${d.nKnowers > d.knowers.length ? ` and ${d.nKnowers - d.knowers.length} more` : ""}.</p>` : ""}
      ${d.refine && d.refine.level > 0 ? `<p>Refined to level ${d.refine.level.toFixed(1)} from ${d.refine.uses.toLocaleString()} times done${d.refine.best ? `; the best at it is ${esc(d.refine.best.name)}` : ""}.</p><div class="rbar" title="Refinement, on a scale that slows as it climbs"><i style="width:${Math.min(100, Math.log2(1 + d.refine.level) / Math.log2(31) * 100).toFixed(0)}%"></i></div>` : ""}`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function lum(hex: string): number { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
function fitText(c: CanvasRenderingContext2D, s: string, w: number): string {
  if (c.measureText(s).width <= w) return s;
  let t = s; while (t.length > 2 && c.measureText(t + "…").width > w) t = t.slice(0, -1);
  return t + "…";
}
