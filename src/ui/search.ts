import type { ChronicleEvent } from "../shared/people.ts";
import { Bubble } from "../shared/people.ts";
import type { SearchItem, SearchKind } from "../sim/people/search.ts";
import { fold } from "../sim/people/search.ts";
import { frameURL } from "./hud.ts";
import { dateText, type History } from "./history.ts";
import { portrait } from "./people.ts";
import type { Dock } from "./dock.ts";
import { el, esc, eventIcon } from "./dom.ts";

/*
  Search. Type any part of a name and find the living and the dead, bands and the camps they
  have made, whole peoples, and moments in the history. Up and down move through the results,
  Enter goes there. Press / (or Ctrl+K) from anywhere to start typing.
*/

export interface SearchCallbacks {
  /** ask the simulation; the answer comes back through `results` with the same seq */
  ask: (q: string, seq: number) => void;
  go: (item: SearchItem) => void;
  show: (e: ChronicleEvent, settle: boolean) => void;
}

type Row = { item: SearchItem } | { event: ChronicleEvent };
const HEADINGS: Record<SearchKind | "event" | "suggest", string> = { person: "People", dead: "Remembered", band: "Bands", people: "Peoples", village: "Villages", place: "Places", idea: "Know-how", event: "Moments", suggest: "Worth a look" };
const ORDER: (SearchKind | "event")[] = ["person", "dead", "village", "band", "people", "place", "idea", "event"];

export class SearchBox {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private out: HTMLElement;
  private rows: Row[] = [];
  private active = 0;
  private seq = 0;
  private timer = 0;
  private items: SearchItem[] = [];
  private q = "";
  private readonly dock: Dock;
  private readonly hist: History;
  private readonly cb: SearchCallbacks;

  constructor(dock: Dock, hist: History, cb: SearchCallbacks) {
    this.dock = dock; this.hist = hist; this.cb = cb;
    this.el = el("div", "paper"); this.el.id = "hud-search";
    this.el.style.borderImageSource = `url(${frameURL()})`;
    this.el.innerHTML = `<input type="search" id="search-q" placeholder="Find a person, band, camp, know-how or moment" aria-label="Search" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="search-out"><div id="search-out" role="listbox" aria-label="Results"></div>`;
    this.input = this.el.querySelector("input")!;
    this.out = this.el.querySelector("#search-out")!;
    this.input.addEventListener("input", () => this.type());
    this.input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { this.move(1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { this.move(-1); e.preventDefault(); }
      else if (e.key === "Enter") { this.choose(this.active); e.preventDefault(); }
      else if (e.key === "Escape") { this.close(); e.stopPropagation(); }
    });
    this.out.addEventListener("click", e => { const r = (e.target as HTMLElement).closest<HTMLElement>("[data-row]"); if (r) this.choose(+r.dataset.row!); });
    this.out.addEventListener("pointermove", e => { const r = (e.target as HTMLElement).closest<HTMLElement>("[data-row]"); if (r && +r.dataset.row! !== this.active) this.setActive(+r.dataset.row!); });
    dock.add("search", this.el, { slot: "float", slide: "drop", label: "FIND", group: "drop", open: false, order: 0, onChange: on => { if (on) { this.input.value = ""; this.q = ""; this.ask(""); this.focusSoon(); } } });
  }

  /** The panel is still sliding into view when it opens, and a hidden box cannot take the cursor, so ask once it is there. */
  private focusSoon(): void { window.setTimeout(() => { this.input.focus(); this.input.select(); }, 40); }
  open(): void { if (this.dock.isOpen("search")) this.focusSoon(); else this.dock.set("search", true); }
  close(): void { this.dock.set("search", false); this.input.blur(); }

  private type(): void {
    clearTimeout(this.timer);
    const q = this.input.value;
    this.timer = window.setTimeout(() => this.ask(q), 80);
  }
  private ask(q: string): void {
    this.q = q; this.seq++;
    this.cb.ask(q, this.seq);
    /* moments are on the page already, so they show at once while the simulation answers */
    this.render();
  }
  /** The simulation's answer to the latest question. */
  results(seq: number, items: SearchItem[]): void {
    if (seq !== this.seq) return;
    this.items = items; this.render();
  }

  private render(): void {
    const q = fold(this.q.trim());
    this.rows = [];
    const html: string[] = [];
    const rowHtml = (row: Row, i: number): string => {
      if ("item" in row) {
        const it = row.item;
        return `<div class="sr" role="option" data-row="${i}" aria-selected="false"><span class="pic" data-pic="${i}"></span><span class="tx"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span></div>`;
      }
      const e = row.event;
      return `<div class="sr" role="option" data-row="${i}" aria-selected="false"><span class="pic" data-ev="${i}"></span><span class="tx"><b>${esc(e.title)}</b><small>${esc(dateText(e.t))}. ${esc(e.text)}</small></span></div>`;
    };
    const section = (title: string, rows: Row[]) => {
      if (!rows.length) return;
      html.push(`<h4>${title}</h4>`);
      for (const r of rows) { this.rows.push(r); html.push(rowHtml(r, this.rows.length - 1)); }
    };
    if (!q) {
      section(HEADINGS.suggest, this.items.map(item => ({ item })));
      const recent = this.hist.filter({ minSig: 0.5 }, 4);
      section("Lately", recent.map(event => ({ event })));
    } else {
      for (const k of ORDER) {
        if (k === "event") section(HEADINGS.event, this.hist.filter({ text: this.q }, 4).map(event => ({ event })));
        else section(HEADINGS[k], this.items.filter(i => i.kind === k).map(item => ({ item })));
      }
    }
    if (!this.rows.length) html.push(`<p class="muted">${q ? "No one by that name. Try fewer letters." : "Nobody to suggest yet."}</p>`);
    this.out.innerHTML = html.join("");
    this.rows.forEach((r, i) => {
      if ("item" in r) {
        const slot = this.out.querySelector(`[data-pic="${i}"]`)!;
        if (r.item.look) slot.append(portrait(r.item.look, 28));
        else if (r.item.icon !== undefined) slot.append(eventIcon(r.item.icon));
        else slot.textContent = r.item.kind === "dead" ? "†" : r.item.kind === "band" ? "∴" : r.item.kind === "people" ? "✦" : "◆";
      } else this.out.querySelector(`[data-ev="${i}"]`)!.append(eventIcon(r.event.icon || Bubble.Sun));
    });
    this.active = Math.min(this.active, Math.max(0, this.rows.length - 1));
    this.setActive(this.active);
  }

  private setActive(i: number): void {
    this.active = i;
    this.out.querySelectorAll<HTMLElement>("[data-row]").forEach(r => {
      const on = +r.dataset.row! === i; r.classList.toggle("on", on); r.setAttribute("aria-selected", String(on));
      if (on) r.scrollIntoView({ block: "nearest" });
    });
  }
  private move(d: number): void { if (this.rows.length) this.setActive((this.active + d + this.rows.length) % this.rows.length); }

  private choose(i: number): void {
    const r = this.rows[i]; if (!r) return;
    this.close();
    if ("item" in r) this.cb.go(r.item); else this.cb.show(r.event, true);
  }
}
