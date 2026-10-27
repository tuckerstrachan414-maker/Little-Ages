import type { Camera } from "../render/camera.ts";
import { CREATURE_SCALE } from "../render/scale.ts";
import { Bond } from "../sim/people/search.ts";
import { frameURL } from "./hud.ts";
import type { Dock } from "./dock.ts";
import { el } from "./dom.ts";

/*
  Relationship threads over the whole map. Switch BONDS on and every couple, parent and child,
  pair of friends and pair of rivals in view is joined by a thread: rose for couples, green
  for family, blue for friends, dashed red for rivals, a heavy dark red line for the two at the
  heart of a feud, and a fine gold line from each adult to the one whose word they go along
  with, so a band's leader sits in a star of gold. They follow people as they walk. The
  simulation works out the strongest ones in view a couple of times a second; people who are
  not in view are not worked out at all.
*/

export const BOND_STYLE: Record<number, { name: string; color: string; width: number; dash: number[] }> = {
  [Bond.Couple]: { name: "Couples", color: "#ee7f95", width: 2.5, dash: [] },
  [Bond.Kin]: { name: "Family", color: "#7fbf5a", width: 1.6, dash: [] },
  [Bond.Friend]: { name: "Friends", color: "#7fb3e6", width: 1.6, dash: [] },
  [Bond.Rival]: { name: "Rivals", color: "#e0584a", width: 1.8, dash: [5, 4] },
  [Bond.Feud]: { name: "Feuds", color: "#a8231c", width: 3.2, dash: [] },
  [Bond.Follow]: { name: "Listens to", color: "#e8bf4a", width: 1.1, dash: [2, 3] },
};
/** Drawn first to last: the fine gold lines underneath, couples and feuds on top. */
const ORDER = [Bond.Follow, Bond.Rival, Bond.Friend, Bond.Kin, Bond.Couple, Bond.Feud];
/** Below this zoom the threads are a tangle, not information. */
export const MIN_ZOOM = 3;

export class BondLayer {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private edges: Int32Array = new Int32Array(0);
  private off = new Set<number>();
  private note: HTMLElement;
  private counted: Int32Array | null = null;
  private askedAt = 0;
  private askedView = "";
  on = false;
  private readonly send: (on: boolean, view: { x0: number; y0: number; x1: number; y1: number }) => void;

  constructor(root: HTMLElement, dock: Dock, send: BondLayer["send"]) {
    this.send = send;
    this.canvas = el("canvas"); this.canvas.id = "bonds-canvas"; this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    root.prepend(this.canvas);
    this.el = el("div", "paper"); this.el.id = "hud-bonds";
    this.el.style.borderImageSource = `url(${frameURL()})`;
    this.el.innerHTML = `<h3>Bonds</h3><div class="bd-list">${[Bond.Couple, Bond.Kin, Bond.Friend, Bond.Rival, Bond.Feud, Bond.Follow].map(k => `<button type="button" data-bond="${k}" aria-pressed="true"><svg width="30" height="8" aria-hidden="true"><line x1="1" y1="4" x2="29" y2="4" stroke="${BOND_STYLE[k].color}" stroke-width="${BOND_STYLE[k].width + 0.6}" stroke-dasharray="${BOND_STYLE[k].dash.join(" ")}"/></svg>${BOND_STYLE[k].name}<b data-n="${k}"></b></button>`).join("")}</div><p class="bd-note"></p>`;
    this.note = this.el.querySelector(".bd-note")!;
    this.el.querySelectorAll<HTMLButtonElement>("[data-bond]").forEach(b => b.onclick = () => {
      const k = +b.dataset.bond!; if (this.off.has(k)) this.off.delete(k); else this.off.add(k);
      b.setAttribute("aria-pressed", String(!this.off.has(k)));
    });
    dock.add("bonds", this.el, { slot: "float", slide: "left", label: "BONDS", open: false, order: 7, onChange: on => { this.on = on; if (!on) { this.edges = new Int32Array(0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.askedView = ""; this.send(false, { x0: 0, y0: 0, x1: 0, y1: 0 }); } } });
  }

  setEdges(e: Int32Array): void { this.edges = e; }

  /** Ask the simulation about the map in view, when it has moved enough or a while has passed. */
  poll(cam: Camera, real: number): void {
    if (!this.on) return;
    const v = cam.visible(), m = 6, view = { x0: v.x0 - m, y0: v.y0 - m, x1: v.x1 + m, y1: v.y1 + m };
    const key = `${view.x0 >> 3},${view.y0 >> 3},${view.x1 >> 3},${view.y1 >> 3}`;
    if (key === this.askedView && real - this.askedAt < 2500) return;
    if (real - this.askedAt < 400) return;
    this.askedAt = real; this.askedView = key;
    this.send(true, view);
  }

  frame(cam: Camera, pos: Map<number, [number, number]>, dpr: number, pinned: number): void {
    const c = this.canvas, W = window.innerWidth, H = window.innerHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const x = this.ctx; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    if (!this.on) return;
    const close = cam.z >= MIN_ZOOM;
    this.note.textContent = close ? "" : "Zoom in to see the threads.";
    if (this.counted !== this.edges) {
      this.counted = this.edges;
      const n = [0, 0, 0, 0, 0, 0];
      for (let i = 2; i < this.edges.length; i += 3) n[this.edges[i]]++;
      this.el.querySelectorAll<HTMLElement>("[data-n]").forEach(b => { b.textContent = String(n[+b.dataset.n!]); });
    }
    if (!close) return;
    /* from the middle of each body, not the feet */
    const lift = (cam.z >= 8 ? 8 * CREATURE_SCALE * cam.z / 8 : 3) / dpr;
    const fade = Math.min(1, (cam.z - MIN_ZOOM) / 3);
    x.lineCap = "round";
    /* per bond, the segments as x1,y1,x2,y2; those touching the pinned person are drawn heavier */
    const plain: number[][] = [[], [], [], [], [], []], hot: number[][] = [[], [], [], [], [], []];
    const e = this.edges;
    for (let i = 0; i < e.length; i += 3) {
      const k = e[i + 2]; if (this.off.has(k)) continue;
      const a = pos.get(e[i]), b = pos.get(e[i + 1]); if (!a || !b) continue;
      const [ax, ay] = cam.toScreen(a[0], a[1]), [bx, by] = cam.toScreen(b[0], b[1]);
      const sx = ax / dpr, sy = ay / dpr - lift, tx = bx / dpr, ty = by / dpr - lift;
      if ((sx < -20 && tx < -20) || (sx > W + 20 && tx > W + 20) || (sy < -20 && ty < -20) || (sy > H + 20 && ty > H + 20)) continue;
      (e[i] === pinned || e[i + 1] === pinned ? hot : plain)[k].push(sx, sy, tx, ty);
    }
    /* the dark edge under every thread first, so they read on any ground, then the colors */
    for (const k of ORDER) {
      const st = BOND_STYLE[k];
      x.setLineDash(st.dash);
      for (const [segs, extra] of [[plain[k], 0], [hot[k], 1.5]] as [number[], number][]) {
        if (!segs.length) continue;
        for (const pass of [0, 1]) {
          x.globalAlpha = (pass ? 0.9 : 0.4) * fade;
          x.strokeStyle = pass ? st.color : "#14110c"; x.lineWidth = st.width + extra + (pass ? 0 : 2);
          x.beginPath();
          for (let i = 0; i < segs.length; i += 4) { x.moveTo(segs[i], segs[i + 1]); x.lineTo(segs[i + 2], segs[i + 3]); }
          x.stroke();
        }
      }
    }
    x.globalAlpha = 1; x.setLineDash([]);
  }
}
