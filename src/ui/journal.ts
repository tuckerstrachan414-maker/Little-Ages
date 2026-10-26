import type { ChronicleEvent } from "../shared/people.ts";
import { Bubble } from "../shared/people.ts";
import { frameURL } from "./hud.ts";
import { CATEGORIES, NOTABLE, dayOfSeason, seasonOf, yearOf, KIND_COLOR, type CategoryKey, type Filter, type History } from "./history.ts";
import { SEASON_NAMES } from "../shared/types.ts";
import type { Dock } from "./dock.ts";
import { el, esc, eventIcon } from "./dom.ts";

/*
  The journal: everything that has happened, newest first, under the year and season it
  happened in. Filter it by kind of event or by a few words, show only the notable, or look
  at one person's or one band's own story. Click a line to fly to where it happened.
*/

export interface JournalFocus { who?: number; band?: number; name: string; note?: string; }
export interface JournalCallbacks { show: (e: ChronicleEvent, settle: boolean) => void; }

const PAGE = 80;

export class Journal {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private head: HTMLElement;
  private focus: JournalFocus | null = null;
  private hide = new Set<CategoryKey>();
  private notable = false;
  private text = "";
  private shown = PAGE;
  private seen = -1;
  private lastBuild = 0;
  private stale = true;
  private readonly hist: History;
  private readonly cb: JournalCallbacks;
  private readonly dock: Dock;

  constructor(dock: Dock, hist: History, cb: JournalCallbacks) {
    this.hist = hist; this.cb = cb; this.dock = dock;
    this.el = el("div", "paper"); this.el.id = "hud-journal";
    this.el.style.borderImageSource = `url(${frameURL()})`;
    this.el.innerHTML = `
      <h3>Journal <small class="jn-count"></small></h3>
      <div class="jn-focus" hidden></div>
      <div class="jn-bar">
        <input type="search" class="jn-text" placeholder="Search the journal" aria-label="Search the journal" autocomplete="off" spellcheck="false">
        <button type="button" class="pbtn jn-notable" aria-pressed="false" title="Only the moments that mattered most">NOTABLE</button>
      </div>
      <div class="jn-cats" role="group" aria-label="Kinds of event">${CATEGORIES.map(c => `<button type="button" data-cat="${c.key}" aria-pressed="true">${c.label}</button>`).join("")}</div>
      <div class="jn-list" tabindex="-1"></div>`;
    this.list = this.el.querySelector(".jn-list")!;
    this.head = this.el.querySelector(".jn-focus")!;
    this.el.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach(b => b.onclick = () => {
      const k = b.dataset.cat as CategoryKey;
      if (this.hide.has(k)) this.hide.delete(k); else this.hide.add(k);
      b.setAttribute("aria-pressed", String(!this.hide.has(k))); this.reset();
    });
    const nb = this.el.querySelector<HTMLButtonElement>(".jn-notable")!;
    nb.onclick = () => { this.notable = !this.notable; nb.setAttribute("aria-pressed", String(this.notable)); this.reset(); };
    let timer = 0;
    this.el.querySelector<HTMLInputElement>(".jn-text")!.onkeydown = e => { if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); this.dock.set("journal", false); } };
    this.el.querySelector<HTMLInputElement>(".jn-text")!.oninput = e => { const v = (e.target as HTMLInputElement).value; clearTimeout(timer); timer = window.setTimeout(() => { this.text = v; this.reset(); }, 120); };
    this.list.addEventListener("click", e => {
      const more = (e.target as HTMLElement).closest<HTMLElement>("[data-more]");
      if (more) { this.shown += PAGE; this.stale = true; this.build(); return; }
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      const ev = b && this.hist.byId(+b.dataset.id!);
      if (ev) this.cb.show(ev, true);
    });
    dock.add("journal", this.el, { slot: "float", slide: "drop", label: "JOURNAL", group: "drop", open: false, order: 2, onChange: on => { if (on) { this.stale = true; this.build(); } } });
  }

  /** Open the journal on one person's or one band's story, or on everything (null). */
  open(focus: JournalFocus | null): void {
    this.focus = focus; this.reset();
    this.dock.set("journal", true);
  }

  private filter(): Filter {
    return { hide: this.hide, minSig: this.notable ? NOTABLE : undefined, who: this.focus?.who, band: this.focus?.band, text: this.text };
  }
  private reset(): void { this.shown = PAGE; this.stale = true; this.build(); }

  /** New events may have arrived; the open journal catches up at most about once a second. */
  tick(real: number): void {
    if (!this.dock.isOpen("journal") || this.hist.eventVersion === this.seen || real - this.lastBuild < 1000) return;
    this.stale = true; this.build(real);
  }
  private build(real = performance.now()): void {
    if (!this.dock.isOpen("journal") || !this.stale) return;
    this.stale = false; this.lastBuild = real; this.seen = this.hist.eventVersion;
    const f = this.filter(), all = this.hist.filter(f), evs = all.slice(0, this.shown);
    this.el.querySelector(".jn-count")!.textContent = `${all.length} ${all.length === 1 ? "entry" : "entries"}`;
    this.head.hidden = !this.focus;
    if (this.focus) {
      this.head.innerHTML = `<span><b>${esc(this.focus.name)}</b>${this.focus.note ? ` <small>${esc(this.focus.note)}</small>` : ""}</span><button type="button" class="pbtn" aria-label="Show everything again">ALL</button>`;
      this.head.querySelector("button")!.onclick = () => this.open(null);
    }
    this.list.replaceChildren();
    if (!evs.length) { this.list.append(el("p", "muted", this.hist.events.length ? "Nothing matches." : "Nothing has happened yet. Give it time.")); return; }
    let group = "", ul: HTMLElement | null = null;
    for (const e of evs) {
      const g = `${SEASON_NAMES[seasonOf(e.t)]}, year ${yearOf(e.t)}`;
      if (g !== group) { group = g; this.list.append(el("h4", "", esc(g))); ul = el("ul"); this.list.append(ul); }
      const li = el("li"), b = el("button", "je"); b.type = "button"; b.dataset.id = String(e.id);
      b.style.setProperty("--k", KIND_COLOR[e.kind] ?? "#999");
      if (e.sig >= 0.6) b.classList.add("big");
      b.append(eventIcon(e.icon || Bubble.Sun));
      b.append(el("span", "", `<b>${esc(e.title)}</b>${esc(e.text)} <em>day ${dayOfSeason(e.t)}</em>`));
      li.append(b); ul!.append(li);
    }
    if (all.length > evs.length) { const m = el("button", "pbtn jn-more", `SHOW OLDER (${all.length - evs.length} MORE)`); m.type = "button"; m.dataset.more = "1"; this.list.append(m); }
  }
}
