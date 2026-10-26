import type { BandDetail, Kin, PersonDetail } from "../shared/protocol.ts";
import type { CampSnap, ChronicleEvent, Look } from "../shared/people.ts";
import { Anim, Bubble } from "../shared/people.ts";
import { DAY_SECONDS, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASON_NAMES } from "../shared/types.ts";
import { personSprite, drawBubble } from "../render/sprites/people.ts";
import { frameURL } from "./hud.ts";
import type { Camera } from "../render/camera.ts";

/*
  The people interface. Click anyone to pin a paper tag to them: a thread follows them as
  they walk, and the tag says who they are, what they are doing and why, how they feel,
  who their family is and what is on their mind. Kin threads run to their family, friends
  and rivals on the map. Click a camp for its band. The news feed in the corner tells of
  births, deaths, couples, hunts and bands on the move; click a line to go there.
*/

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

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
function icon(b: number): HTMLCanvasElement {
  const c = el("canvas"); c.width = 15; c.height = 12; c.className = "ev-icon";
  drawBubble(c.getContext("2d")!, 7, 11, b, 1);
  return c;
}
function when(t: number, now: number): string {
  const d = (now - t) / DAY_SECONDS;
  if (d < 1) return "today"; if (d < 2) return "yesterday"; if (d < DAYS_PER_SEASON) return `${Math.floor(d)} days ago`;
  if (d < DAYS_PER_YEAR) return `${Math.floor(d / DAYS_PER_SEASON)} seasons ago`;
  return `${Math.floor(d / DAYS_PER_YEAR)} years ago`;
}
export function dateOf(t: number): string {
  const day = Math.floor(t / DAY_SECONDS), y = Math.floor(day / DAYS_PER_YEAR) + 1, s = Math.floor(day / DAYS_PER_SEASON) % 4;
  return `${SEASON_NAMES[s]}, year ${y}`;
}
const bars = (rows: [string, number, string][]) => rows.map(([n, v, col]) => `<div class="need"><span>${n}</span><span class="segs" style="--c:${col}">${Array.from({ length: 8 }, (_, i) => `<i class="${i < Math.round(Math.max(0, Math.min(1, v)) * 8) ? "on" : ""}"></i>`).join("")}</span></div>`).join("");

export interface PeopleUICallbacks {
  pin: (person: number, band: number) => void;
  fly: (x: number, y: number, z?: number) => void;
  follow: (on: boolean) => void;
}

export class PeopleUI {
  private news: HTMLElement;
  private list: HTMLElement;
  private tag: HTMLElement | null = null;
  private svg: SVGSVGElement;
  private tab: "now" | "family" | "mind" = "now";
  private person: PersonDetail | null = null;
  private band: BandDetail | null = null;
  private pinnedId = 0;
  private pinnedBand = 0;
  private threads = true;
  following = false;
  private events: ChronicleEvent[] = [];
  private time = 0;
  private renderedKey = "";
  private readonly cb: PeopleUICallbacks;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement, cb: PeopleUICallbacks) {
    this.root = root; this.cb = cb;
    this.news = el("div", "ui paper"); this.news.id = "hud-news";
    this.news.style.borderImageSource = `url(${frameURL()})`;
    this.news.innerHTML = `<h3>News <small>from all the bands</small></h3><ol aria-live="polite"></ol>`;
    this.list = el("div", "ui paper"); this.list.id = "hud-bands"; this.list.hidden = true;
    this.list.style.borderImageSource = `url(${frameURL()})`;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.id = "threads"; this.svg.setAttribute("aria-hidden", "true");
    root.append(this.svg, this.news, this.list);
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
      b.append(icon(e.icon || Bubble.Sun));
      const span = el("span", "", `${esc(e.text)} <em>${when(e.t, this.time)}</em>`); b.append(span);
      b.onclick = () => { this.cb.fly(e.x, e.y, 12); if (e.who[0]) this.cb.pin(e.who[0], 0); };
      li.append(b); ol.append(li);
    }
  }

  /* ---------------- band list ---------------- */
  toggleList(camps: CampSnap[]): void { this.list.hidden = !this.list.hidden; if (!this.list.hidden) this.renderList(camps); }
  renderList(camps: CampSnap[]): void {
    if (this.list.hidden) return;
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
  get pinned(): { person: number; band: number } { return { person: this.pinnedId, band: this.pinnedBand }; }
  pin(person: number, band: number): void {
    this.pinnedId = person; this.pinnedBand = band; this.person = null; this.band = null; this.renderedKey = "";
    if (!person && !band) { this.tag?.remove(); this.tag = null; this.svg.innerHTML = ""; this.following = false; this.cb.follow(false); return; }
    if (!this.tag) { this.tag = el("div", "tag paper"); this.tag.style.borderImageSource = `url(${frameURL()})`; this.root.append(this.tag); }
    this.tag.innerHTML = `<p class="muted">Looking...</p>`;
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

  private render(): void {
    const t = this.tag; if (!t) return;
    if (this.person) this.renderPerson(t, this.person); else if (this.band) this.renderBand(t, this.band);
  }

  private renderPerson(t: HTMLElement, d: PersonDetail): void {
    /* rebuild only what changed, so buttons stay put under the pointer */
    const key = `${d.id}|${this.tab}|${d.stage}|${d.partner?.id}|${d.children.length}|${d.memories.length}|${d.look.wear}|${d.friends.map(f => f.id).join()}|${d.rivals.map(f => f.id).join()}`;
    const ageText = d.age < 1 ? `${Math.max(1, Math.round(d.age * 12))} months` : `${Math.floor(d.age)}`;
    const role = d.respected ? `the one the ${d.band.name} listen to` : d.pregnant ? "expecting a child" : "";
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      t.innerHTML = `<button class="x" type="button" aria-label="Unpin">×</button>
        <div class="row head"><span class="pic"></span><div><div class="nm"></div><div class="sub"></div></div></div>
        <div class="tabs" role="tablist">${(["now", "family", "mind"] as const).map(k => `<button type="button" role="tab" data-tab="${k}" aria-selected="${this.tab === k}">${k === "now" ? "NOW" : k === "family" ? "FAMILY" : "MIND"}</button>`).join("")}</div>
        <div class="body"></div>
        <div class="chips"><button type="button" data-chip="follow" aria-pressed="${this.following}">Follow</button><button type="button" data-chip="threads" aria-pressed="${this.threads}">Kin threads</button></div>`;
      t.querySelector(".pic")!.append(portrait(d.look, 40));
      t.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.cb.pin(0, 0);
      t.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(b => b.onclick = () => { this.tab = b.dataset.tab as "now"; this.renderedKey = ""; this.render(); });
      t.querySelectorAll<HTMLButtonElement>("[data-chip]").forEach(b => b.onclick = () => {
        if (b.dataset.chip === "follow") { this.following = !this.following; this.cb.follow(this.following); }
        else { this.threads = !this.threads; if (!this.threads) this.svg.innerHTML = ""; }
        b.setAttribute("aria-pressed", String(b.dataset.chip === "follow" ? this.following : this.threads));
      });
      const body = t.querySelector(".body")!;
      if (this.tab === "family") body.append(this.familyView(d));
      else if (this.tab === "mind") body.append(this.mindView(d));
      else body.innerHTML = `<p class="doing"></p><p class="why"></p><div class="needs"></div><p class="mood"></p>`;
    }
    t.querySelector(".nm")!.textContent = `${d.name}, ${ageText}`;
    t.querySelector(".sub")!.textContent = `${d.sex === "f" ? "Woman" : "Man"} of the ${d.band.name}${role ? `, ${role}` : ""}`.replace(/^(Woman|Man) of/, (_m, w) => (d.age < 16 ? (d.sex === "f" ? "Girl" : "Boy") : w) + " of");
    if (this.tab === "now") {
      const n = d.needs;
      t.querySelector(".doing")!.textContent = d.doing + (d.carrying ? `, carrying ${d.carrying}` : "");
      t.querySelector(".why")!.innerHTML = `<strong>Why?</strong> ${esc(d.why.replace(/^\S+ is /, "").replace(/^./, c => c.toUpperCase()))}`;
      t.querySelector(".needs")!.innerHTML = bars([["FOOD", n.food, "#c97a3a"], ["WATER", n.water, "#4f8fb8"], ["REST", n.rest, "#7a6ab0"], ["WARMTH", n.warmth, "#d0653a"], ["COMPANY", n.company, "#5e8f3e"], ["HEALTH", n.health, "#b04050"]]);
      t.querySelector(".mood")!.innerHTML = `<b>${d.moodWord}</b>${d.feelings.length ? ` &middot; ${d.feelings.map(esc).join(", ")}` : ""}`;
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
    box.append(el("div", "needs", bars(d.skills.map(s => [s.name.toUpperCase(), s.v, "#8a6a3a"] as [string, number, string]))));
    if (d.knows.length) box.append(el("p", "knows", `<b>Knows</b> ${d.knows.map(esc).join(", ")}`));
    if (d.friends.length) { box.append(el("h4", "", "Friends")); box.append(this.kinRow(d.friends)); }
    if (d.rivals.length) { box.append(el("h4", "", "Can't stand")); box.append(this.kinRow(d.rivals)); }
    if (d.memories.length) { box.append(el("h4", "", "Remembers")); box.append(el("ul", "mem", d.memories.map(m => `<li class="${m.v < 0 ? "bad" : "good"}">${esc(m.text)} <em>${m.ago < 1 ? "today" : m.ago < 2 ? "yesterday" : `${Math.floor(m.ago)} days ago`}</em></li>`).join(""))); }
    return box;
  }

  private renderBand(t: HTMLElement, d: BandDetail): void {
    const key = `b${d.id}|${d.pop}|${d.events.length}|${d.respected?.id}`;
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      t.innerHTML = `<button class="x" type="button" aria-label="Unpin">×</button>
        <div class="nm">The ${esc(d.name)}</div><div class="sub">A band of the ${esc(d.people)} people, camped at ${esc(d.camp)}</div>
        <p class="stats"></p><div class="needs"></div><h4>People</h4><div class="members"></div>${d.events.length ? `<h4>Lately</h4><ul class="mem">${d.events.map(e => `<li>${esc(e.text)} <em>${when(e.t, this.time)}</em></li>`).join("")}</ul>` : ""}`;
      t.querySelector<HTMLButtonElement>(".x")!.onclick = () => this.cb.pin(0, 0);
      const m = t.querySelector(".members")!;
      for (const p of d.members) { const b = el("button", "mb"); b.type = "button"; b.title = `${p.name}, ${p.age}`; b.append(portrait(p.look, 24)); b.onclick = () => this.cb.pin(p.id, 0); m.append(b); }
    }
    t.querySelector(".stats")!.innerHTML = `<b>${d.pop}</b> people: ${d.adults} adults, ${d.children} children, ${d.couples} couples.${d.respected ? ` Most listened to: <b>${esc(d.respected.name)}</b>.` : ""}${d.moving ? " <b>On the move.</b>" : ""} Moved camp ${d.moves} times. Brought in ${d.yesterday.brought} and ate ${d.yesterday.eaten} yesterday.`;
    t.querySelector(".needs")!.innerHTML = bars([["FOOD STORE", Math.min(1, d.days / 4), "#c97a3a"], ["FIRE", d.fire, "#d0653a"]]);
  }

  /** Every frame: keep the tag beside its person or camp, and draw the threads. */
  frame(cam: Camera, pos: Map<number, [number, number]>, camps: CampSnap[], dpr: number): void {
    const t = this.tag; if (!t) return;
    let wx = 0, wy = 0, have = false;
    if (this.pinnedId) { const p = pos.get(this.pinnedId); if (p) { [wx, wy] = p; have = true; } }
    else if (this.pinnedBand) { const c = camps.find(k => k.id === this.pinnedBand); if (c) { wx = c.x; wy = c.y; have = true; } }
    const W = window.innerWidth, H = window.innerHeight, mobile = W < 640;
    t.classList.toggle("docked", mobile);
    if (!have) { this.svg.innerHTML = ""; return; }
    const [sx0, sy0] = cam.toScreen(wx, wy), px = sx0 / dpr, py = sy0 / dpr;
    const headY = py - (cam.z >= 8 ? 17 * cam.z / 8 : 6) / dpr;
    let s = "";
    if (!mobile) {
      const tw = t.offsetWidth, th = t.offsetHeight;
      let tx = px + 46, ty = headY - th - 34;
      if (tx + tw > W - 12) tx = px - tw - 46;
      tx = Math.max(12, Math.min(W - tw - 12, tx)); ty = Math.max(64, Math.min(H - th - 12, ty));
      t.style.left = `${Math.round(tx)}px`; t.style.top = `${Math.round(ty)}px`;
      const ax = tx + tw / 2, ay = ty + th - 2, mx = (ax + px) / 2, my = Math.max(ay, headY) + 24;
      if (px > -20 && px < W + 20 && py > -20 && py < H + 20) s += `<path d="M${ax},${ay} Q${mx},${my} ${px},${headY}" fill="none" stroke="#2b2418" stroke-width="4" stroke-linecap="round"/><path d="M${ax},${ay} Q${mx},${my} ${px},${headY}" fill="none" stroke="#f2e6c8" stroke-width="2" stroke-linecap="round"/>`;
    }
    /* threads to family (green), partner (rose), friends (blue) and rivals (red, dashed) */
    const d = this.person;
    if (this.threads && d && px > -40 && px < W + 40) {
      const rel: [Kin | null, string, string][] = [[d.partner, "#e07a8a", ""], [d.mother, "#7fbf5a", ""], [d.father, "#7fbf5a", ""], ...d.children.map(k => [k, "#7fbf5a", ""] as [Kin, string, string]), ...d.siblings.map(k => [k, "#a4cf6a", ""] as [Kin, string, string]), ...d.friends.map(k => [k, "#7fb3e6", ""] as [Kin, string, string]), ...d.rivals.map(k => [k, "#e0584a", ' stroke-dasharray="5 4"'] as [Kin, string, string])];
      for (const [k, col, dash] of rel) {
        if (!k || !k.alive) continue;
        const q = pos.get(k.id); if (!q) continue;
        const [qx0, qy0] = cam.toScreen(q[0], q[1]), qx = qx0 / dpr, qy = qy0 / dpr - (cam.z >= 8 ? 8 * cam.z / 8 : 3) / dpr;
        if (qx < -40 || qx > W + 40 || qy < -40 || qy > H + 40) continue;
        s += `<line x1="${px}" y1="${headY}" x2="${qx}" y2="${qy}" stroke="#14110c" stroke-width="4" stroke-opacity=".5"${dash}/><line x1="${px}" y1="${headY}" x2="${qx}" y2="${qy}" stroke="${col}" stroke-width="2"${dash}/>`;
        s += `<rect x="${qx - 3}" y="${qy - 3}" width="6" height="6" fill="${col}" stroke="#14110c" stroke-width="1.5"/>`;
        if (cam.z >= 4) s += `<text class="rel-label" x="${(px + qx) / 2}" y="${(headY + qy) / 2 - 5}" text-anchor="middle">${esc(k.rel)}: ${esc(k.name)}</text>`;
      }
    }
    this.svg.innerHTML = s;
  }
  setTime(t: number): void { this.time = t; }
}
