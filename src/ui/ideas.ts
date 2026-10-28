import type { ChronicleEvent } from "../shared/people.ts";
import type { IdeaSummary } from "../sim/people/ideas.ts";
import { frameURL } from "./hud.ts";
import { dateText, type History } from "./history.ts";
import type { Dock } from "./dock.ts";
import { el, esc, eventIcon } from "./dom.ts";

/*
  What the world knows. Every way of doing things anyone has ever known: the old ways every
  people started with, and each new one as it is worked out, with who first did it and when,
  how many know it now and in how many bands, and whether it has been lost. Nothing here is
  a tech tree to climb: each line is only a record of what people in this world have done.
  Click a discovery to fly to where it happened.
*/

export interface IdeasCallbacks { ask: () => void; show: (e: ChronicleEvent) => void; }

export class IdeasPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private ideas: IdeaSummary[] = [];
  private lastAsk = 0;
  private key = "";
  private readonly hist: History;
  private readonly cb: IdeasCallbacks;
  private readonly dock: Dock;

  constructor(dock: Dock, hist: History, cb: IdeasCallbacks) {
    this.dock = dock; this.hist = hist; this.cb = cb;
    this.el = el("div", "paper"); this.el.id = "hud-ideas";
    this.el.style.borderImageSource = `url(${frameURL()})`;
    this.el.innerHTML = `<h3>What the world knows <small class="id-count"></small></h3><p class="muted id-lede">Knowledge lives only in heads. It is worked out by someone curious under pressure, passed on by showing and watching, and lost with the last who knew it.</p><div class="id-list"></div>`;
    this.list = this.el.querySelector(".id-list")!;
    this.list.addEventListener("click", e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ev]");
      const ev = b && this.hist.byId(+b.dataset.ev!);
      if (ev) { this.dock.set("ideas", false); this.cb.show(ev); }
    });
    dock.add("ideas", this.el, { slot: "float", slide: "drop", label: "IDEAS", group: "drop", open: false, order: 3, onChange: on => { if (on) { this.key = ""; this.cb.ask(); } } });
  }

  /** While open, asks the simulation for the latest every couple of seconds. */
  tick(now: number): void {
    if (!this.dock.isOpen("ideas") || now - this.lastAsk < 2000) return;
    this.lastAsk = now; this.cb.ask();
  }
  set(list: IdeaSummary[]): void { this.ideas = list; this.render(); }

  /** The event in which someone first worked an idea out, if the page still has it. */
  private firstEvent(d: IdeaSummary): ChronicleEvent | null {
    const f = d.first; if (!f) return null;
    return this.hist.events.find(e => e.kind === "discover" && e.who[0] === f.who && Math.abs(e.t - f.t) < 1) ?? null;
  }

  private render(): void {
    if (!this.dock.isOpen("ideas")) return;
    const key = this.ideas.map(d => `${d.id}:${d.knowers}:${d.bands}:${d.times}:${d.lostAt}`).join("|");
    if (key === this.key) return;
    this.key = key;
    const found = this.ideas.filter(d => !d.start && (d.first || d.times)), alive = found.filter(d => d.knowers > 0);
    this.el.querySelector(".id-count")!.textContent = `${alive.length} of ${this.ideas.filter(d => !d.start).length} new ways known`;
    this.list.replaceChildren();
    const sec = (title: string, rows: IdeaSummary[]) => {
      if (!rows.length) return;
      this.list.append(el("h4", "", esc(title)));
      const ul = el("ul");
      for (const d of rows) ul.append(this.row(d));
      this.list.append(ul);
    };
    sec("Worked out in this world", this.ideas.filter(d => !d.start && d.first).sort((a, b) => (a.first!.t - b.first!.t)));
    sec("Not yet thought of", this.ideas.filter(d => !d.start && !d.first));
    sec("The old ways, known from the start", this.ideas.filter(d => d.start));
  }

  private row(d: IdeaSummary): HTMLElement {
    const li = el("li", "idea" + (d.start ? " old" : d.knowers ? "" : d.first ? " lost" : " none"));
    const ev = this.firstEvent(d);
    const b = el(ev ? "button" : "div", "ir"); if (ev) { (b as HTMLButtonElement).type = "button"; b.dataset.ev = String(ev.id); b.title = "Go to where it was first worked out"; }
    b.append(eventIcon(d.icon));
    const needs = d.needs.length ? `Builds on ${d.needs.join(" and ")}.` : "";
    let status: string;
    if (d.start) status = `${d.knowers} people in ${d.bands} ${d.bands === 1 ? "band" : "bands"} know it.`;
    else if (!d.first) status = `Nobody has worked it out yet.${needs ? ` ${needs}` : ""}`;
    else {
      const first = `First worked out by ${d.first.name} of the ${d.first.bandName} (${d.first.people}), ${dateText(d.first.t).toLowerCase()}.`;
      const now = d.knowers ? `${d.knowers} ${d.knowers === 1 ? "person knows" : "people know"} it, in ${d.bands} ${d.bands === 1 ? "band" : "bands"}${d.peoples > 1 ? ` of ${d.peoples} peoples` : ""}.` : `Lost: nobody alive knows it${d.lostAt ? ` since ${dateText(d.lostAt).toLowerCase()}` : ""}.`;
      status = `${now} ${first}${d.times > 1 ? ` Worked out ${d.times} times in all.` : ""}`;
    }
    b.append(el("span", "", `<b>${esc(d.name)}</b><small>${esc(status)}</small>`));
    li.append(b);
    return li;
  }
}
