import type { BandDetail, Feuding, Kin, PersonDetail, VillageDetail } from "../shared/protocol.ts";
import type { CampSnap, ChronicleEvent, Look, VillageSnap } from "../shared/people.ts";
import { Anim, Bubble } from "../shared/people.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASON_NAMES } from "../shared/types.ts";
import { personSprite } from "../render/sprites/people.ts";
import { CREATURE_SCALE } from "../render/scale.ts";
import { frameURL } from "./hud.ts";
import { Idea } from "../sim/tech/tree.ts";
import type { Camera } from "../render/camera.ts";
import type { Dock } from "./dock.ts";
import { el, esc, eventIcon } from "./dom.ts";
import type { JournalFocus } from "./journal.ts";

/*
  The people interface. Click anyone to pin a paper tag to them: a thread follows them as
  they walk, and the tag says who they are, what they are doing and why, how they feel,
  who their family is and what is on their mind. Hide the tag and a small chip keeps their
  name by them, so you can keep following without the card. Kin threads run to their
  family, friends and rivals on the map. Click a camp for its band. The news feed in the
  corner tells of births, deaths, couples, hunts and bands on the move; click a line to go there.
*/


/** A little portrait of someone, standing, facing us. */
export function portrait(look: Look, size = 30, dead = false): HTMLCanvasElement {
  const c = el("canvas"); c.width = size; c.height = size; c.className = "portrait" + (dead ? " dead" : "");
  const x = c.getContext("2d")!; x.imageSmoothingEnabled = false;
  x.fillStyle = dead ? "#cfc2a2" : "#e3d4ae"; x.fillRect(0, 0, size, size);
  const d = personSprite(look, Anim.Idle, 0, "front", 0, 0);
  /* head and shoulders, as large as fits */
  const k = Math.max(1, Math.floor(size / 14));
  const head = look.stage === "toddler" ? 14 : look.stage === "child" ? 13 : look.stage === "teen" ? 10 : 9;
  const w = d.c.width * k, h = d.c.height * k;
  x.drawImage(d.c, Math.round(size / 2 - w / 2), Math.round(size * 0.12 - head * k), w, h);
  if (dead) { x.fillStyle = "rgba(60,50,40,.25)"; x.fillRect(0, 0, size, size); }
  return c;
}
function when(t: number, now: number): string {
  const d = (now - t) / DAY_SECONDS;
  if (d < 1) return "today"; if (d < 2) return "yesterday"; if (d < DAYS_PER_SEASON) return `${Math.floor(d)} days ago`;
  if (d < DAYS_PER_YEAR) { const n = Math.floor(d / DAYS_PER_SEASON); return n === 1 ? "a season ago" : `${n} seasons ago`; }
  const n = Math.floor(d / DAYS_PER_YEAR); return n === 1 ? "a year ago" : `${n} years ago`;
}
export function dateOf(t: number): string {
  const day = Math.floor(t / DAY_SECONDS), y = Math.floor(day / DAYS_PER_YEAR) + 1, s = Math.floor(day / DAYS_PER_SEASON) % 4;
  return `${SEASON_NAMES[s]}, year ${y}`;
}
/** What a village's pits hold, in days of its people's food. */
const pitWords = (d: number) => d < 0.05 ? "standing empty" : d < 0.5 ? "with a little food put by" : `holding ${Math.round(d)} ${Math.round(d) === 1 ? "day" : "days"} of food`;
/** "half a day", "1 day", "3 days" of food */
const daysText = (d: number) => d < 0.3 ? "hardly any" : d < 0.75 ? "half a day's" : d < 1.5 ? "a day's" : `${Math.round(d)} days'`;
const bars = (rows: [string, number, string][]) => rows.map(([n, v, col]) => `<div class="need"><span>${n}</span><span class="segs" style="--c:${col}">${Array.from({ length: 8 }, (_, i) => `<i class="${i < Math.round(Math.max(0, Math.min(1, v)) * 8) ? "on" : ""}"></i>`).join("")}</span></div>`).join("");

export interface PeopleUICallbacks {
  pin: (person: number, band: number, village?: number) => void;
  fly: (x: number, y: number, z?: number) => void;
  follow: (on: boolean) => void;
  /** open the journal on this person's or band's story */
  journal: (focus: JournalFocus) => void;
  /** a news line was chosen */
  news: (e: ChronicleEvent) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class PeopleUI {
  private news: HTMLElement;
  private list: HTMLElement;
  private tag: HTMLElement | null = null;
  private chip: HTMLButtonElement;
  private svg: SVGSVGElement;
  private tab: "now" | "family" | "mind" = "now";
  private person: PersonDetail | null = null;
  private band: BandDetail | null = null;
  private village: VillageDetail | null = null;
  private villages: VillageSnap[] = [];
  private pinnedId = 0;
  private pinnedBand = 0;
  private pinnedVillage = 0;
  private threads = true;
  following = false;
  /** whether the pinned card is showing; hidden, it leaves a chip with the name instead */
  private tagOpen = true;
  private events: ChronicleEvent[] = [];
  private camps: CampSnap[] = [];
  private time = 0;
  /** a ring on the map where an event happened, until the given moment (performance.now) */
  private ping: { x: number; y: number; until: number } | null = null;
  /** pixels at the bottom of the screen the history ribbon covers */
  inset = 0;
  private renderedKey = "";
  private readonly cb: PeopleUICallbacks;
  private readonly root: HTMLElement;
  private readonly dock: Dock;

  constructor(root: HTMLElement, dock: Dock, cb: PeopleUICallbacks) {
    this.root = root; this.dock = dock; this.cb = cb;
    this.news = el("div", "paper"); this.news.id = "hud-news";
    this.news.style.borderImageSource = `url(${frameURL()})`;
    this.news.innerHTML = `<h3>News <small>from all the bands</small></h3><ol aria-live="polite"></ol>`;
    this.list = el("div", "paper"); this.list.id = "hud-bands";
    this.list.style.borderImageSource = `url(${frameURL()})`;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.id = "threads"; this.svg.setAttribute("aria-hidden", "true");
    this.chip = el("button", "paper chip off"); this.chip.type = "button"; this.chip.id = "hud-chip";
    this.chip.title = "Show the card";
    this.chip.onclick = () => this.showTag();
    root.append(this.svg, this.chip);
    /* an arrow at the screen's edge for kin out of view: a press flies there */
    this.svg.addEventListener("pointerdown", e => {
      const g = (e.target as Element).closest<SVGElement>("[data-fly]");
      if (!g) return;
      e.preventDefault(); e.stopPropagation();
      this.cb.fly(+g.dataset.x!, +g.dataset.y!, 12); this.cb.pin(+g.dataset.fly!, 0);
    });
    /* on a phone the news would cover half the map, so it starts folded away */
    dock.add("news", this.news, { slot: "bottom-start", slide: "left", label: "NEWS", order: 4, open: window.innerWidth > 520 });
    dock.add("bands", this.list, { slot: "float", slide: "drop", label: "PEOPLE", group: "drop", open: false, order: 1, onChange: on => { if (on) this.renderList(this.camps); } });
  }

  /* ---------------- news ---------------- */
  addEvents(evs: ChronicleEvent[], now: number): void {
    this.time = now;
    if (!evs.length) return;
    this.events.push(...evs);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    this.renderNews();
  }
  private renderNews(): void {
    const ol = this.news.querySelector("ol")!;
    ol.innerHTML = "";
    for (const e of this.events.slice(-7).reverse()) {
      const li = el("li"); const b = el("button", "ev"); b.type = "button";
      b.append(eventIcon(e.icon || Bubble.Sun));
      const span = el("span", "", `${esc(e.text)} <em>${when(e.t, this.time)}</em>`); b.append(span);
      b.onclick = () => this.cb.news(e);
      li.append(b); ol.append(li);
    }
  }

  /* ---------------- band list ---------------- */
  renderList(camps: CampSnap[]): void {
    this.camps = camps;
    if (!this.dock.isOpen("bands")) return;
    const total = camps.reduce((a, c) => a + c.pop, 0);
    this.list.innerHTML = `<h3>${camps.length} bands, ${total} people</h3>`;
    const ul = el("ul");
    for (const c of camps.slice().sort((a, d) => d.pop - a.pop)) {
      const b = el("button", "", `<i style="background:${c.color}"></i><b>${esc(c.name)}</b><span>${c.pop}</span>`); b.type = "button";
      b.onclick = () => { this.cb.fly(c.x, c.y, 10); this.cb.pin(0, c.id); };
      const li = el("li"); li.append(b); ul.append(li);
    }
    this.list.append(ul);
  }

  /* ---------------- the pinned tag ---------------- */
  get pinned(): { person: number; band: number; village: number } { return { person: this.pinnedId, band: this.pinnedBand, village: this.pinnedVillage }; }
  pin(person: number, band: number, village = 0): void {
    this.pinnedId = person; this.pinnedBand = band; this.pinnedVillage = village; this.person = null; this.band = null; this.village = null; this.renderedKey = "";
    if (!person && !band && !village) { this.tag?.remove(); this.tag = null; this.svg.innerHTML = ""; this.following = false; this.cb.follow(false); this.tagOpen = true; this.chip.classList.add("off"); return; }
    /* pinning someone always opens their card again, even if it was hidden */
    this.tagOpen = true;
    if (!this.tag) { this.tag = el("div", "paper tag"); this.tag.style.borderImageSource = `url(${frameURL()})`; this.root.append(this.tag); }
    this.tag.classList.remove("collapsed");
    this.tag.innerHTML = `<p class="muted">Looking...</p>`;
  }
  /** Slide the card away, keeping the pin, the marker and any following. A chip with the name stays by them. */
  hideTag(): void {
    if (!this.tag) return;
    this.tagOpen = false; this.tag.classList.add("collapsed");
  }
  showTag(): void {
    this.tagOpen = true; this.tag?.classList.remove("collapsed");
  }
  setPerson(d: PersonDetail | null, id: number): void {
    if (id !== this.pinnedId) return;
    if (!d) { this.pin(0, 0); return; }
    this.person = d; this.render();
  }
  setBand(d: BandDetail | null, id: number): void {
    if (id !== this.pinnedBand) return;
    if (!d) { this.pin(0, 0); return; }
    this.band = d; this.render();
  }
  setVillage(d: VillageDetail | null, id: number): void {
    if (id !== this.pinnedVillage) return;
    if (!d) { this.pin(0, 0); return; }
    this.village = d; this.render();
  }
  /** Villages and gatherings on the map, for keeping a village's card beside it. */
  setVillages(v: VillageSnap[]): void { this.villages = v; }

  /** The buttons every card carries: hide it to a chip, or unpin it. */
  private chrome(): string {
    return `<div class="tools"><button class="hide" type="button" aria-label="Hide the card and keep following">HIDE</button><button class="x" type="button" aria-label="Unpin">×</button></div>`;
  }
  private bindChrome(t: HTMLElement): void {
    t.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.cb.pin(0, 0);
    t.querySelector<HTMLButtonElement>(".hide")!.onclick = () => this.hideTag();
  }

  private render(): void {
    const t = this.tag; if (!t) return;
    if (this.person) this.renderPerson(t, this.person); else if (this.band) this.renderBand(t, this.band); else if (this.village) this.renderVillage(t, this.village);
  }

  private renderPerson(t: HTMLElement, d: PersonDetail): void {
    /* rebuild only what changed, so buttons stay put under the pointer */
    const key = `${d.id}|${this.tab}|${d.stage}|${d.partner?.id}|${d.children.length}|${d.memories.length}|${d.look.wear}|${d.friends.map(f => f.id).join()}|${d.rivals.map(f => f.id).join()}|${d.feuds.map(f => f.id).join()}|${d.follows?.id}|${d.followers}|${d.owes.map(o => o.id).join()}`;
    const ageText = d.age < 1 ? `${Math.max(1, Math.round(d.age * 12))} months` : `${Math.floor(d.age)}`;
    const role = d.respected ? `the one the ${d.band.name} listen to` : d.feuds.some(f => f.own && f.heat > 0.4) ? "in a feud" : d.pregnant ? "expecting a child" : "";
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      t.innerHTML = `${this.chrome()}
        <div class="row head"><span class="pic"></span><div><div class="nm"></div><div class="sub"></div></div></div>
        <div class="tabs" role="tablist">${(["now", "family", "mind"] as const).map(k => `<button type="button" role="tab" data-tab="${k}" aria-selected="${this.tab === k}">${k === "now" ? "NOW" : k === "family" ? "FAMILY" : "MIND"}</button>`).join("")}</div>
        <div class="body"></div>
        <div class="chips"><button type="button" data-chip="follow" aria-pressed="${this.following}">Follow</button><button type="button" data-chip="threads" aria-pressed="${this.threads}">Kin threads</button><button type="button" data-act="journal">Journal</button></div>`;
      t.querySelector(".pic")!.append(portrait(d.look, 40));
      this.bindChrome(t);
      t.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(b => b.onclick = () => { this.tab = b.dataset.tab as "now"; this.renderedKey = ""; this.render(); });
      t.querySelectorAll<HTMLButtonElement>("[data-chip]").forEach(b => b.onclick = () => {
        if (b.dataset.chip === "follow") { this.following = !this.following; this.cb.follow(this.following); }
        else { this.threads = !this.threads; if (!this.threads) this.svg.innerHTML = ""; }
        b.setAttribute("aria-pressed", String(b.dataset.chip === "follow" ? this.following : this.threads));
      });
      t.querySelector<HTMLButtonElement>("[data-act=journal]")!.onclick = () => this.cb.journal({ who: d.id, name: d.name, note: "their story" });
      const body = t.querySelector(".body")!;
      if (this.tab === "family") body.append(this.familyView(d));
      else if (this.tab === "mind") body.append(this.mindView(d));
      else body.innerHTML = `<p class="doing"></p><p class="why"></p><div class="needs"></div><p class="mood"></p><p class="hearth"></p>`;
    }
    t.querySelector(".nm")!.textContent = `${d.name}, ${ageText}`;
    t.querySelector(".sub")!.textContent = `${d.sex === "f" ? "Woman" : "Man"} of the ${d.band.name}${role ? `, ${role}` : ""}`.replace(/^(Woman|Man) of/, (_m, w) => (d.age < 16 ? (d.sex === "f" ? "Girl" : "Boy") : w) + " of");
    if (this.tab === "now") {
      const n = d.needs;
      t.querySelector(".doing")!.textContent = d.doing + (d.carrying ? `, carrying ${d.carrying}` : "");
      t.querySelector(".why")!.innerHTML = `<strong>Why?</strong> ${esc(d.why.replace(/^\S+ is /, "").replace(/^./, c => c.toUpperCase()))}`;
      t.querySelector(".needs")!.innerHTML = bars([["FOOD", n.food, "#c97a3a"], ["WATER", n.water, "#4f8fb8"], ["REST", n.rest, "#7a6ab0"], ["WARMTH", n.warmth, "#d0653a"], ["COMPANY", n.company, "#5e8f3e"], ["HEALTH", n.health, "#b04050"]]);
      t.querySelector(".mood")!.innerHTML = `<b>${d.moodWord}</b>${d.feelings.length ? ` &middot; ${d.feelings.map(esc).join(", ")}` : ""}`;
      t.querySelector(".hearth")!.innerHTML = d.age < 2 ? "" : `<b>Hearth</b> ${esc(daysText(d.hearth))} food &middot; <b>the band's pot</b> ${esc(daysText(d.pot))} food${d.pit >= 0 ? ` &middot; <b>the family's pit</b> ${esc(daysText(d.pit))} food` : ""}<br><b>Home</b> ${esc(d.home)}`;
    }
  }

  private kinRow(list: (Kin | null)[], label?: string): HTMLElement {
    const row = el("div", "kin");
    for (const k of list) {
      if (!k) continue;
      const b = el("button", "k" + (k.alive ? "" : " dead")); b.type = "button";
      if (k.look) b.append(portrait(k.look, 28, !k.alive)); else b.append(el("span", "nopic", "†"));
      b.append(el("span", "kn", `<b>${esc(k.name)}</b><small>${esc(label ?? k.rel)}${k.alive ? `, ${k.age}` : `, died ${esc(k.died ?? "")}`}${k.band ? ` (${esc(k.band)})` : ""}</small>`));
      if (k.alive) b.onclick = () => this.cb.pin(k.id, 0); else b.disabled = true;
      row.append(b);
    }
    return row;
  }
  private familyView(d: PersonDetail): HTMLElement {
    const box = el("div", "family");
    box.append(el("p", "looks", esc(d.looks)));
    const sec = (title: string, list: (Kin | null)[]) => { const l = list.filter(Boolean); if (!l.length) return; box.append(el("h4", "", title)); box.append(this.kinRow(l)); };
    sec("Parents", [d.mother, d.father]);
    sec(d.partner ? (d.sex === "f" ? "Husband" : "Wife") : "Partner", [d.partner]);
    sec("Children", d.children);
    sec("Brothers and sisters", d.siblings);
    if (!d.mother && !d.father && !d.partner && !d.children.length && !d.siblings.length) box.append(el("p", "muted", "No family living."));
    return box;
  }
  private mindView(d: PersonDetail): HTMLElement {
    const box = el("div", "mind");
    box.append(el("p", "traits", d.traits.map(t => `<span class="trait">${esc(t.word)}</span>`).join(" ")));
    /* whose word they go along with, who goes along with theirs, and how they share */
    if (d.age >= 16) {
      const she = d.sex === "f" ? "she" : "he", her = d.sex === "f" ? "her" : "him";
      const p = el("p", "voice");
      const lead = d.leads >= 0 ? `Leads the ${esc(d.band.name)}${d.leads >= 10 ? ` (for ${Math.floor(d.leads / 10)} season${d.leads >= 20 ? "s" : ""})` : ""}. ` : "";
      p.innerHTML = `${lead}${d.follows ? `${d.leads >= 0 ? "Takes counsel from" : "Listens to"} <button type="button" class="lnk" data-pin="${d.follows.id}">${esc(d.follows.name)}</button>. ` : `Goes by ${d.sex === "f" ? "her" : "his"} own judgment. `}${d.followers ? `${d.followers} of the band listen to ${her}. ` : ""}${d.shareRate > 0.75 ? `Shares nearly everything ${she} brings in.` : d.shareRate > 0.5 ? `Shares most of what ${she} brings in.` : d.shareRate > 0.3 ? `Keeps much of what ${she} brings in for ${d.sex === "f" ? "her" : "his"} own.` : `Keeps most of what ${she} brings in for ${d.sex === "f" ? "her" : "his"} own.`}`;
      p.querySelectorAll<HTMLButtonElement>("[data-pin]").forEach(b => b.onclick = () => this.cb.pin(+b.dataset.pin!, 0));
      box.append(p);
      if (d.owes.length) {
        const o = el("p", "owes");
        o.innerHTML = d.owes.map(x => x.amt > 0 ? `Owes <button type="button" class="lnk" data-pin="${x.id}">${esc(x.name)}</button> for food in a hungry time.` : `<button type="button" class="lnk" data-pin="${x.id}">${esc(x.name)}</button> owes ${her} for food.`).join(" ");
        o.querySelectorAll<HTMLButtonElement>("[data-pin]").forEach(b => b.onclick = () => this.cb.pin(+b.dataset.pin!, 0));
        box.append(o);
      }
    }
    if (d.feuds.length) { box.append(el("h4", "", "Bad blood")); box.append(this.feudRows(d.feuds)); }
    box.append(el("div", "needs", bars(d.skills.map(s => [s.name.toUpperCase(), s.v, "#8a6a3a"] as [string, number, string]))));
    const fresh = d.knows.filter(k => !k.start), old = d.knows.filter(k => k.start);
    if (fresh.length || old.length) {
      box.append(el("h4", "", "Knows how"));
      const ul = el("ul", "knows");
      /* how well, in three pips: just learning, getting it, a master */
      const pips = (m: number) => `<span class="pips" title="${m < 0.34 ? "still learning" : m < 0.67 ? "good at it" : "a master of it"}">${[0, 1, 2].map(i => `<i class="${m > i / 3 + 0.01 ? "on" : ""}"></i>`).join("")}</span>`;
      for (const k of fresh) ul.append(el("li", "new", `<b>${esc(k.name)}</b>${k.how ? ` <small>${esc(k.how)}</small>` : ""}${pips(k.m)}`));
      if (old.length) ul.append(el("li", "old", `The old ways: ${old.map(k => esc(k.name)).join(", ")}`));
      box.append(ul);
    }
    if (d.friends.length) { box.append(el("h4", "", "Friends")); box.append(this.kinRow(d.friends)); }
    if (d.rivals.length) { box.append(el("h4", "", "Can't stand")); box.append(this.kinRow(d.rivals)); }
    if (d.memories.length) { box.append(el("h4", "", "Remembers")); box.append(el("ul", "mem", d.memories.map(m => `<li class="${m.v < 0 ? "bad" : "good"}">${esc(m.text)} <em>${m.ago < 1 ? "today" : m.ago < 2 ? "yesterday" : `${Math.floor(m.ago)} days ago`}</em></li>`).join(""))); }
    return box;
  }

  /** Each feud: the other side, and what it is about. */
  private feudRows(list: Feuding[]): HTMLElement {
    const box = el("div", "feuds");
    for (const f of list) {
      const b = el("button", "fd"); b.type = "button";
      if (f.look) b.append(portrait(f.look, 28));
      const heat = f.heat > 0.7 ? "bitter" : f.heat > 0.4 ? "hot" : "cooling";
      b.append(el("span", "kn", `<b>${esc(f.name)}</b><small>${f.own ? "" : "family feud, "}${heat}${f.inherited ? ", handed down" : ""}: ${esc(f.cause)}</small>`));
      b.onclick = () => this.cb.pin(f.id, 0);
      box.append(b);
    }
    return box;
  }

  private renderBand(t: HTMLElement, d: BandDetail): void {
    const key = `b${d.id}|${d.pop}|${d.events.length}|${d.respected?.id}|${d.contender?.id}|${d.feuds.map(f => f.a.id + "-" + f.b.id).join()}|${d.hearths.length}|${d.ideas.map(i => i.id + ":" + i.n).join()}|${d.works.map(w => w.text).join()}|${d.homes}|${d.needs}`;
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      t.innerHTML = `${this.chrome()}
        <div class="nm">The ${esc(d.name)}</div><div class="sub">A band of the ${esc(d.people)} people, ${d.village ? `living in the village of ${esc(d.village)}` : `camped at ${esc(d.camp)}`}</div>
        <p class="stats"></p><p class="voices"></p>${d.needs ? `<p class="needs-b"><b>Short of:</b> ${esc(d.needs)}.</p>` : ""}${d.homes ? `<h4>Homes and stores</h4><p class="homes"></p>` : ""}<div class="needs"></div><h4>Hearths</h4><div class="hearths"></div><p class="sharing"></p>${d.feuds.length ? `<h4>Bad blood</h4><ul class="mem feuds-b"></ul>` : ""}<h4>Know-how</h4><ul class="mem ideas-b"></ul>${d.works.length ? `<h4>Weirs and plots</h4><ul class="mem works-b"></ul>` : ""}<h4>People</h4><div class="members"></div><div class="chips"><button type="button" data-act="journal">Journal</button></div>${d.events.length ? `<h4>Lately</h4><ul class="mem">${d.events.map(e => `<li>${esc(e.text)} <em>${when(e.t, this.time)}</em></li>`).join("")}</ul>` : ""}`;
      this.bindChrome(t);
      t.querySelector<HTMLButtonElement>("[data-act=journal]")!.onclick = () => this.cb.journal({ band: d.id, name: `The ${d.name}`, note: "their story" });
      const m = t.querySelector(".members")!;
      for (const p of d.members) { const b = el("button", "mb" + (d.respected?.id === p.id ? " lead" : "")); b.type = "button"; b.title = `${p.name}, ${p.age}${d.respected?.id === p.id ? ", leads the band" : ""}`; b.append(portrait(p.look, 24)); b.onclick = () => this.cb.pin(p.id, 0); m.append(b); }
      /* what the band knows that the old ways did not teach, and who holds it */
      const il = t.querySelector(".ideas-b")!;
      const fresh = d.ideas.filter(i => !i.start), fire = d.ideas.find(i => i.id === Idea.MakeFire);
      for (const i of fresh) {
        const names = i.who.map(w => `<button type="button" class="lnk" data-pin="${w.id}">${esc(w.name)}</button>`);
        const who = i.n === 1 ? `only ${names[0]} knows it` : i.n <= 3 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : `${names.slice(0, 2).join(", ")} and ${i.n - 2} more`;
        il.append(el("li", i.n <= 1 ? "bad" : "good", `<b>${esc(i.name)}</b>: ${who}`));
      }
      if (!fire) il.append(el("li", "bad", "Nobody here can make fire. If the fire dies, someone has to fetch it from another band."));
      if (!fresh.length) il.append(el("li", "", "Only the old ways, as their people have always done things."));
      il.querySelectorAll<HTMLButtonElement>("[data-pin]").forEach(b => b.onclick = () => this.cb.pin(+b.dataset.pin!, 0));
      const wl = t.querySelector(".works-b");
      if (wl) for (const w of d.works) { const li = el("li", "", `<button type="button" class="lnk" data-x="${w.x}" data-y="${w.y}">${esc(w.text)}</button>`); li.querySelector("button")!.onclick = () => this.cb.fly(w.x, w.y, 16); wl.append(li); }
      const fl = t.querySelector(".feuds-b");
      if (fl) for (const f of d.feuds) {
        const li = el("li", "bad", `<button type="button" class="lnk" data-pin="${f.a.id}">${esc(f.a.name)}</button> against <button type="button" class="lnk" data-pin="${f.b.id}">${esc(f.b.name)}</button>, who ${esc(f.cause)} <em>${f.heat > 0.7 ? "bitter" : f.heat > 0.4 ? "hot" : "cooling"}</em>`);
        li.querySelectorAll<HTMLButtonElement>("[data-pin]").forEach(b => b.onclick = () => this.cb.pin(+b.dataset.pin!, 0));
        fl.append(li);
      }
    }
    const voices = t.querySelector(".voices")!;
    voices.innerHTML = d.respected ? `Led by <button type="button" class="lnk" data-pin="${d.respected.id}">${esc(d.respected.name)}</button>, whom ${d.followers} of the adults listen to${d.ledDays >= 10 ? `, for ${Math.floor(d.ledDays / 10)} season${d.ledDays >= 20 ? "s" : ""} now` : ""}.${d.contender ? ` A second voice: <button type="button" class="lnk" data-pin="${d.contender.id}">${esc(d.contender.name)}</button>, with ${d.contender.followers}.` : ""}` : "Nobody leads the band: each goes by their own judgment.";
    voices.querySelectorAll<HTMLButtonElement>("[data-pin]").forEach(b => b.onclick = () => this.cb.pin(+b.dataset.pin!, 0));
    t.querySelector(".stats")!.innerHTML = `<b>${d.pop}</b> people: ${d.adults} adults, ${d.children} children, ${d.couples} couples.${d.moving ? " <b>On the move.</b>" : ""} ${d.moves ? `Moved camp ${d.moves === 1 ? "once" : `${d.moves} times`}.` : "Has never moved camp."} Brought in ${d.yesterday.brought} and ate ${d.yesterday.eaten} yesterday.${d.dried >= 1 ? ` ${d.dried} days of dried meat and fish put by.` : ""}${d.fire <= 0 ? " <b>The fire is out.</b>" : ""}`;
    t.querySelector(".needs")!.innerHTML = bars([["ALL FOOD", Math.min(1, d.days / 4), "#c97a3a"], ["THE POT", Math.min(1, d.pot / 4), "#b5683a"], ["FIRE", d.fire, "#d0653a"]]);
    const homes = t.querySelector(".homes"); if (homes) homes.textContent = `${d.homes}.${d.stay ? ` ${d.stay}` : ""}`;
    t.querySelector(".hearths")!.innerHTML = `<div class="needs">${bars(d.hearths.slice(0, 8).map(h => [`${h.name.slice(0, 9).toUpperCase()} ${h.people}`, Math.min(1, h.days / 4), "#8a6a3a"] as [string, number, string]))}</div>${d.hearths.length > 8 ? `<p class="muted">and ${d.hearths.length - 8} more</p>` : ""}`;
    t.querySelector(".sharing")!.textContent = d.yesterday.brought > 0 ? `Yesterday ${Math.round(d.sharedYesterday * 100)}% of the food brought in went into the pot; the rest stayed at the hearths of those who brought it.` : "";
  }

  private renderVillage(t: HTMLElement, d: VillageDetail): void {
    const key = `v${d.id}|${d.pop}|${d.events.length}|${d.bands.map(b => b.id + ":" + (b.leader?.id ?? 0)).join()}|${d.huts}|${d.building}|${d.ruins}|${d.pits}|${d.fields.map(f => f.crop + f.n).join()}|${d.listened?.id}|${d.abandoned}|${d.empty}`;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    const founder = d.founder.alive ? `<button type="button" class="lnk" data-pin="${d.founder.id}">${esc(d.founder.name)}</button>` : esc(d.founder.name);
    const state = d.abandoned ? `Nobody has lived here since ${dateOf(d.abandoned)}.` : d.empty ? `Its people are away; the huts wait for them.` : `<b>${d.pop}</b> people live here${d.peak > d.pop + 3 ? ` (once ${d.peak})` : ""}.`;
    const fields = d.fields.map(f => `${f.n} ${f.n === 1 ? "field" : "fields"} of ${esc(f.crop)}${f.tame >= 0.25 ? `, the seed grown ${f.tame >= 0.5 ? "tame" : "plump"} from years of sowing` : ""}`);
    const built = [`${d.huts} ${d.huts === 1 ? "hut" : "huts"}${d.building ? `, ${d.building} going up` : ""}${d.ruins ? `, ${d.ruins} fallen in` : ""}`, d.pits ? `${d.pits} storage ${d.pits === 1 ? "pit" : "pits"} ${pitWords(d.pitDays)}` : "", ...fields, d.weirs ? `${d.weirs} fish ${d.weirs === 1 ? "weir" : "weirs"}` : ""].filter(Boolean);
    t.innerHTML = `${this.chrome()}
      <div class="nm">${esc(d.name)}</div><div class="sub">"${esc(d.gloss)}": a village of the ${esc(d.people)}, named ${esc(d.why)}</div>
      <p class="stats">${state} It began in ${dateOf(d.founded)}, when ${esc(d.story)}; ${founder} raised the first hut.</p>
      ${d.bands.length ? `<h4>${d.bands.length === 1 ? "The band" : "The bands"} living here</h4><ul class="mem vbands">${d.bands.map(b => `<li><i class="sw" style="background:${b.color}"></i><button type="button" class="lnk" data-band="${b.id}">The ${esc(b.name)}</button>, ${b.pop} people${b.leader ? `, led by <button type="button" class="lnk" data-pin="${b.leader.id}">${esc(b.leader.name)}</button>` : ""}</li>`).join("")}</ul>${d.bands.length > 1 && d.listened ? `<p class="voices">Of all the grown-ups here, the most listen to <button type="button" class="lnk" data-pin="${d.listened.id}">${esc(d.listened.name)}</button> (${d.listened.n}).</p>` : ""}` : ""}
      <h4>What they have built and put by</h4><ul class="mem">${built.map(x => `<li>${x}</li>`).join("")}</ul>
      <div class="chips"><button type="button" data-act="journal">Journal</button></div>
      ${d.events.length ? `<h4>Lately</h4><ul class="mem">${d.events.map(e => `<li>${esc(e.text)} <em>${when(e.t, this.time)}</em></li>`).join("")}</ul>` : ""}`;
    this.bindChrome(t);
    t.querySelectorAll<HTMLButtonElement>("[data-pin]").forEach(b => b.onclick = () => this.cb.pin(+b.dataset.pin!, 0));
    t.querySelectorAll<HTMLButtonElement>("[data-band]").forEach(b => b.onclick = () => this.cb.pin(0, +b.dataset.band!));
    t.querySelector<HTMLButtonElement>("[data-act=journal]")!.onclick = () => this.cb.journal({ band: d.bands[0]?.id ?? 0, name: d.name, note: "the village's story" });
  }

  /** Put a ring on the map where something happened, for a few seconds. */
  setPing(x: number, y: number): void { this.ping = { x, y, until: performance.now() + 7000 }; }

  /** Every frame: keep the tag beside its person or camp, or the chip when the card is hidden, and draw the threads. */
  frame(cam: Camera, pos: Map<number, [number, number]>, camps: CampSnap[], dpr: number): void {
    let wx = 0, wy = 0, have = false;
    if (this.pinnedId) { const p = pos.get(this.pinnedId); if (p) { [wx, wy] = p; have = true; } }
    else if (this.pinnedBand) { const c = camps.find(k => k.id === this.pinnedBand); if (c) { wx = c.x; wy = c.y; have = true; } }
    else if (this.pinnedVillage) { const v = this.villages.find(k => k.id === this.pinnedVillage); if (v) { wx = v.x; wy = v.y; have = true; } }
    const W = window.innerWidth, H = window.innerHeight, mobile = W < 640, floor = H - this.inset;
    const t = this.tag;
    this.chip.classList.toggle("off", !have || this.tagOpen);
    let s = this.pingMarkup(cam, dpr);
    if (!have || !t) { this.svg.innerHTML = s; return; }
    t.classList.toggle("docked", mobile);
    const [sx0, sy0] = cam.toScreen(wx, wy), px = sx0 / dpr, py = sy0 / dpr;
    const headY = py - (cam.z >= 8 ? 17 * CREATURE_SCALE * cam.z / 8 : 6) / dpr;
    if (this.tagOpen) {
      if (!mobile) {
        const tw = t.offsetWidth, th = t.offsetHeight;
        let tx = px + 46, ty = headY - th - 34;
        if (tx + tw > W - 12) tx = px - tw - 46;
        tx = clamp(tx, 12, W - tw - 12); ty = clamp(ty, 64, Math.max(64, floor - th - 12));
        t.style.left = `${Math.round(tx)}px`; t.style.top = `${Math.round(ty)}px`;
        const ax = tx + tw / 2, ay = ty + th - 2, mx = (ax + px) / 2, my = Math.max(ay, headY) + 24;
        if (px > -20 && px < W + 20 && py > -20 && py < H + 20) s += `<path d="M${ax},${ay} Q${mx},${my} ${px},${headY}" fill="none" stroke="#2b2418" stroke-width="4" stroke-linecap="round"/><path d="M${ax},${ay} Q${mx},${my} ${px},${headY}" fill="none" stroke="#f2e6c8" stroke-width="2" stroke-linecap="round"/>`;
      }
    } else {
      this.placeChip(px, headY, W, floor);
    }
    /* threads to family (green), partner (rose), friends (blue) and rivals (red, dashed) */
    const d = this.person;
    if (this.threads && d && px > -40 && px < W + 40) {
      const rel: [Kin | null, string, string][] = [[d.partner, "#e07a8a", ""], [d.mother, "#7fbf5a", ""], [d.father, "#7fbf5a", ""], ...d.children.map(k => [k, "#7fbf5a", ""] as [Kin, string, string]), ...d.siblings.map(k => [k, "#a4cf6a", ""] as [Kin, string, string]), ...d.friends.map(k => [k, "#7fb3e6", ""] as [Kin, string, string]), ...d.rivals.map(k => [k, "#e0584a", ' stroke-dasharray="5 4"'] as [Kin, string, string])];
      const labels: { x: number; y: number; w: number; text: string }[] = [];
      const away: { k: Kin; col: string; qx: number; qy: number; tiles: number; wx: number; wy: number }[] = [];
      for (const [k, col, dash] of rel) {
        if (!k || !k.alive) continue;
        const q = pos.get(k.id); if (!q) continue;
        const [qx0, qy0] = cam.toScreen(q[0], q[1]), qx = qx0 / dpr, qy = qy0 / dpr - (cam.z >= 8 ? 8 * CREATURE_SCALE * cam.z / 8 : 3) / dpr;
        if (qx < -40 || qx > W + 40 || qy < -40 || qy > floor - 6) { away.push({ k, col, qx, qy, tiles: Math.round(Math.hypot(q[0] - wx, q[1] - wy)), wx: q[0], wy: q[1] }); continue; }
        s += `<line x1="${px}" y1="${headY}" x2="${qx}" y2="${qy}" stroke="#14110c" stroke-width="4" stroke-opacity=".5"${dash}/><line x1="${px}" y1="${headY}" x2="${qx}" y2="${qy}" stroke="${col}" stroke-width="2"${dash}/>`;
        s += `<rect x="${qx - 3}" y="${qy - 3}" width="6" height="6" fill="${col}" stroke="#14110c" stroke-width="1.5"/>`;
        /* a name by each end, for anyone not standing right beside the pinned person */
        const text = `${k.rel}: ${k.name}`;
        if (cam.z >= 4 && Math.hypot(qx - px, qy - headY) > 16 && labels.length < 8) labels.push({ x: qx, y: qy - 9, w: text.length * 6.6 + 6, text });
      }
      /* names that would overprint each other stack upward instead, so every one stays readable */
      const placed: typeof labels = [];
      for (const l of labels) {
        for (let k = 0; k < 10; k++) { const hit = placed.find(o => Math.abs(o.x - l.x) < (o.w + l.w) / 2 && Math.abs(o.y - l.y) < 12); if (!hit) break; l.y = hit.y - 12; }
        placed.push(l);
        /* a name that would land under the toolbar or the ribbon is left out; the arrow at the edge covers anyone out of sight */
        if (l.y < 74 || l.y > floor - 8) continue;
        const x = Math.max(l.w / 2 + 4, Math.min(W - l.w / 2 - 4, l.x)), y = l.y;
        s += `<text class="rel-label" x="${x}" y="${y}" text-anchor="middle">${esc(l.text)}</text>`;
      }
      s += this.awayMarkup(away, W, floor);
    }
    this.svg.innerHTML = s;
  }

  /** The expanding ring over the spot an event happened. */
  private pingMarkup(cam: Camera, dpr: number): string {
    const p = this.ping; if (!p) return "";
    const now = performance.now();
    if (now > p.until) { this.ping = null; return ""; }
    const [sx, sy] = cam.toScreen(p.x, p.y), x = sx / dpr, y = sy / dpr;
    const k = ((now % 1400) / 1400), fade = Math.min(1, (p.until - now) / 1500);
    let s = "";
    for (const o of [0, 0.5]) { const f = (k + o) % 1; s += `<circle cx="${x}" cy="${y}" r="${10 + f * 34}" fill="none" stroke="#14110c" stroke-width="5" stroke-opacity="${(1 - f) * 0.35 * fade}"/><circle cx="${x}" cy="${y}" r="${10 + f * 34}" fill="none" stroke="#f6d77a" stroke-width="2.5" stroke-opacity="${(1 - f) * 0.95 * fade}"/>`; }
    return s;
  }

  /** Arrows on the screen's edge toward kin who are out of view, each saying who and how far. A press flies there. */
  private awayMarkup(away: { k: Kin; col: string; qx: number; qy: number; tiles: number; wx: number; wy: number }[], W: number, floor: number): string {
    const L = 16, R = W - 16, T = 74, B = Math.max(T + 40, floor - 16), cx = (L + R) / 2, cy = (T + B) / 2;
    const taken: [number, number][] = [];
    let s = "", n = 0;
    for (const a of away.sort((p, q) => p.tiles - q.tiles)) {
      if (n >= 6) break;
      const dx = a.qx - cx, dy = a.qy - cy;
      const sc = Math.min(dx ? (dx > 0 ? (R - cx) / dx : (L - cx) / dx) : Infinity, dy ? (dy > 0 ? (B - cy) / dy : (T - cy) / dy) : Infinity);
      if (!isFinite(sc)) continue;
      const ax = cx + dx * sc, ay = cy + dy * sc, deg = Math.atan2(dy, dx) * 180 / Math.PI;
      /* two arrows pointing the same way would sit on each other; the nearer person gets it */
      if (taken.some(([x, y]) => Math.hypot(x - ax, y - ay) < 22)) continue;
      taken.push([ax, ay]); n++;
      const text = `${a.k.name} \u00b7 ${a.tiles}`, onRight = ax > cx, w = text.length * 6.4 + 10;
      s += `<g class="away" data-fly="${a.k.id}" data-x="${a.wx}" data-y="${a.wy}"><title>${esc(a.k.rel)}: ${esc(a.k.name)}, ${a.tiles} tiles away. Click to go there.</title>`
        + `<rect x="${onRight ? ax - w - 12 : ax + 12}" y="${ay - 9}" width="${w}" height="18" rx="2" fill="#f2e6c8" stroke="#2b2418" stroke-width="2"/>`
        + `<text class="away-label" x="${onRight ? ax - 12 - w / 2 : ax + 12 + w / 2}" y="${ay + 4}" text-anchor="middle">${esc(text)}</text>`
        + `<polygon points="9,0 -6,-7 -6,7" transform="translate(${ax},${ay}) rotate(${deg})" fill="${a.col}" stroke="#14110c" stroke-width="2" stroke-linejoin="round"/></g>`;
    }
    return s;
  }

  /** The name chip beside the pinned person, kept on screen. */
  private placeChip(px: number, headY: number, W: number, H: number): void {
    const name = this.person ? this.person.name : this.band ? `The ${this.band.name}` : this.village ? this.village.name : "";
    if (this.chip.dataset.name !== name) { this.chip.dataset.name = name; this.chip.innerHTML = `<b></b><span>SHOW</span>`; this.chip.querySelector("b")!.textContent = name; }
    const cw = this.chip.offsetWidth, ch = this.chip.offsetHeight;
    this.chip.style.left = `${Math.round(clamp(px + 16, 8, W - cw - 8))}px`;
    this.chip.style.top = `${Math.round(clamp(headY - ch - 12, 64, H - ch - 12))}px`;
    this.chip.classList.toggle("following", this.following);
  }

  setTime(t: number): void { this.time = t; }
}
