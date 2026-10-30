import "./ui/styles.css";
import SimWorker from "./sim/worker.ts?worker&inline";
import { Renderer } from "./render/renderer.ts";
import { createScreen, hud } from "./ui/hud.ts";
import { PeopleUI } from "./ui/people.ts";
import { Dock } from "./ui/dock.ts";
import { History } from "./ui/history.ts";
import { Ribbon } from "./ui/ribbon.ts";
import { Journal } from "./ui/journal.ts";
import { SearchBox } from "./ui/search.ts";
import { Spotlight } from "./ui/spotlight.ts";
import { BondLayer } from "./ui/bonds.ts";
import { TechPanel } from "./ui/tech.ts";
import type { CampSnap, ChronicleEvent } from "./shared/people.ts";
import type { SearchItem } from "./sim/people/search.ts";
import type { FromWorker, ToWorker, DepositSnap } from "./shared/protocol.ts";
import type { MapMode } from "./shared/types.ts";

/* Boot: world creation, then the map, the simulation worker and the interface. */

const canvas = document.getElementById("world") as HTMLCanvasElement;
const app = document.getElementById("app")!;
let worker: Worker | null = null;
let renderer: Renderer | null = null;
let ui: ReturnType<typeof hud> | null = null;
let pui: PeopleUI | null = null;
let dock: Dock | null = null;
let history = new History();
let ribbon: Ribbon | null = null;
let journal: Journal | null = null;
let search: SearchBox | null = null;
let spot: Spotlight | null = null;
let bonds: BondLayer | null = null;
let tech: TechPanel | null = null;
let deposits: DepositSnap[] = [];
let camps: CampSnap[] = [];
let lastTick = { time: 0, at: 0, speed: 1 };
const life = { animals: 0, birds: 0, rabbits: 0, fish: 0, people: 0 };
/* pin a tag to a person, a band or a village; the worker then sends their details twice a second */
const pin = (person: number, band: number, village = 0) => {
  pui?.pin(person, band, village);
  if (renderer) { renderer.people.selected = person; renderer.people.selectedBand = band; renderer.people.selectedVillage = village; }
  send({ type: "inspect", person, band, village });
};
const send = (m: ToWorker) => worker?.postMessage(m);

/* ---------- going to places in history ---------- */

/** Fly to where an event happened and ring the spot. `settle` also pins whoever was in it. */
function showEvent(e: ChronicleEvent, settle: boolean, follow = false) {
  if (!renderer) return;
  const cam = renderer.cam;
  cam.flyTo(e.x, e.y, cam.z < 9 ? 12 : Math.min(cam.z, 16), settle || follow ? 900 : 600);
  pui?.setPing(e.x, e.y);
  if (!settle && !follow) return;
  /* the first person in it who is still alive, else its band, else just the spot */
  const alive = e.who.find(id => renderer!.people.pos.has(id));
  if (alive) { pin(alive, 0); if (follow && pui) pui.following = true; }
  else if (e.band && camps.some(c => c.id === e.band)) pin(0, e.band);
}
/** The same, from somewhere other than the ribbon, so the ribbon follows along. */
function lookAt(e: ChronicleEvent) { spot?.userActed(performance.now()); ribbon?.note(e); showEvent(e, true); }

function goTo(item: SearchItem) {
  if (!renderer) return;
  spot?.userActed(performance.now());
  const cam = renderer.cam;
  if (item.kind === "person") { cam.flyTo(item.x, item.y, Math.max(cam.z, 14), 900); pin(item.id, 0); }
  else if (item.kind === "dead") { cam.flyTo(item.x, item.y, Math.max(cam.z, 12), 900); pui?.setPing(item.x, item.y); pin(0, 0); journal?.open({ who: item.id, name: item.title, note: "remembered" }); }
  else if (item.kind === "village") { cam.flyTo(item.x, item.y, Math.max(cam.z, 6), 900); pin(0, 0, item.id); }
  else if (item.kind === "idea") { tech?.open(item.id); }
  else { cam.flyTo(item.x, item.y, item.kind === "people" ? 8 : 10, 900); pin(0, item.band); }
}

/** The Spotlight has nothing to show: follow someone ordinary through their day. */
function wander(): string | null {
  if (!renderer) return null;
  const adults = [...renderer.people.looks.values()].filter(l => (l.stage === "adult" || l.stage === "teen" || l.stage === "elder") && renderer!.people.pos.has(l.id));
  if (!adults.length) return null;
  const l = adults[Math.floor(Math.random() * adults.length)], p = renderer.people.pos.get(l.id)!;
  renderer.cam.flyTo(p[0], p[1], 14, 1100);
  pin(l.id, 0); if (pui) pui.following = true;
  const band = camps.find(c => c.id === l.band);
  return `Nothing much is happening. Following ${l.name}${band ? ` of the ${band.name}` : ""} through the day.`;
}
let slowedFrom = 0;
function slowForDrama(on: boolean) {
  if (on) { if (lastTick.speed > 3) { slowedFrom = lastTick.speed; ui?.setSpeed(3); } }
  else if (slowedFrom) { if (lastTick.speed === 3) ui?.setSpeed(slowedFrom); slowedFrom = 0; }
}

function start() {
  const screen = createScreen(app, choice => {
    worker?.terminate();
    worker = new SimWorker();
    worker.onerror = e => { console.error("Simulation error:", e.message, e.filename, e.lineno); screen.fail(e.message || "The simulation stopped unexpectedly."); };
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "progress") screen.progress(m.stage, m.pct);
      else if (m.type === "world") {
        screen.progress(5, 0.5);
        renderer = new Renderer(canvas, m.world);
        resize(); renderer.cam.fitWorld();
        dock = new Dock(app);
        ui = hud(m.world, dock, {
          onSpeed: s => { send({ type: "speed", speed: s }); lastTick.speed = s; },
          onMode: (mode: MapMode) => send({ type: "mode", mode }),
          onNew: () => { worker?.terminate(); worker = null; renderer = null; pui = null; dock = null; ribbon = null; journal = null; search = null; spot = null; bonds = null; tech = null; camps = []; app.className = ""; app.innerHTML = ""; start(); },
          onMinimap: (u, v) => { if (renderer) { renderer.cam.x = u * renderer.world.w; renderer.cam.y = v * renderer.world.h; renderer.cam.clamp(); } },
        });
        pui = new PeopleUI(app, dock, {
          pin,
          fly: (x, y, z) => renderer?.cam.flyTo(x, y, z ?? Math.max(renderer.cam.z, 10), 900),
          follow: on => { if (on && renderer && pui?.pinned.person) { const p = renderer.people.pos.get(pui.pinned.person); if (p) renderer.cam.flyTo(p[0], p[1], Math.max(renderer.cam.z, 12), 700); } },
          journal: f => journal?.open(f),
          news: lookAt,
        });
        history = new History();
        bonds = new BondLayer(app, dock, (on, view) => send({ type: "bonds", on, view }));
        journal = new Journal(dock, history, { show: lookAt });
        tech = new TechPanel(dock, history, { ask: g => send({ type: "tech", group: g }), askNode: (id, g) => send({ type: "technode", id, group: g }), show: lookAt, fly: (x, y) => { spot?.userActed(performance.now()); renderer?.cam.flyTo(x, y, 12, 900); pui?.setPing(x, y); } });
        search = new SearchBox(dock, history, { ask: (q, seq) => send({ type: "search", q, seq }), go: goTo, show: lookAt });
        spot = new Spotlight(dock, { show: e => { ribbon?.note(e); showEvent(e, false, true); }, wander, slow: slowForDrama, onChange: on => { if (!on) slowForDrama(false); } });
        ribbon = new Ribbon(app, dock, history, { show: (e, settle) => { spot?.userActed(performance.now()); showEvent(e, settle); } }, open => app.classList.toggle("has-ribbon", open));
        app.classList.add("has-ribbon");
        bindInput();
      } else if (m.type === "baked") {
        if (!renderer) return;
        renderer.setTerrain(m.pixels, m.season, m.mode);
        if (m.mode === "terrain") ui?.setMinimap(renderer.terrain);
        screen.close();
      } else if (m.type === "fields") {
        if (renderer) renderer.fields = m;
        life.rabbits = m.rabbitTotal; life.fish = m.fishTotal; ui?.setLife(life); ui?.setFields(m);
      } else if (m.type === "deposits") {
        deposits = m.list; ui?.setDeposits(m.list);
      } else if (m.type === "tiles") {
        renderer?.applyTiles(m.changes);
      } else if (m.type === "tick") {
        if (!renderer) return;
        const now = performance.now();
        renderer.herdsPrev = renderer.herds; renderer.herds = { n: m.herdCount, data: m.herds }; renderer.herdT = now;
        renderer.flocksPrev = renderer.flocks; renderer.flocks = { n: m.flockCount, data: m.birds };
        renderer.people.setTick(m.people, m.peopleCount, m.camps, m.looks, now);
        if (m.works) renderer.people.works = m.works;
        if (m.villages) { renderer.people.villages = m.villages; pui?.setVillages(m.villages); }
        camps = m.camps;
        lastTick = { time: m.time, at: now, speed: m.speed };
        life.animals = m.animals; life.birds = m.birdCount; life.people = m.pop; ui?.setLife(life);
        pui?.addEvents(m.events, m.time);
        history.add(m.events); history.sample(m.time, m.pop); spot?.offer(m.events, now);
        if (Math.floor(m.time / 6) !== Math.floor((m.time - 0.1 * m.speed) / 6)) pui?.renderList(camps);
      } else if (m.type === "results") search?.results(m.seq, m.items);
      else if (m.type === "bonds") bonds?.setEdges(m.edges);
      else if (m.type === "techtree") tech?.setTree(m.defs);
      else if (m.type === "tech") tech?.set(m.data);
      else if (m.type === "technode") { if (m.detail) tech?.setNode(m.detail); }
      else if (m.type === "person") pui?.setPerson(m.detail, m.id);
      else if (m.type === "band") pui?.setBand(m.detail, m.id);
      else if (m.type === "village") pui?.setVillage(m.detail, m.id);
    };
    send({ type: "generate", size: choice.size, seed: choice.seed, start: choice.start, bands: choice.bands });
  });
}

function resize() {
  if (!renderer) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener("resize", resize);

let inputBound = false;
function bindInput() {
  if (inputBound) return; inputBound = true;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener("wheel", e => { e.preventDefault(); if (!renderer) return; spot?.userActed(performance.now()); const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)); renderer.cam.zoomAt(e.clientX * dpr(), e.clientY * dpr(), f); }, { passive: false });
  const readAt = (e: PointerEvent) => { if (!renderer) return; const [wx, wy] = renderer.cam.toWorld(e.clientX * dpr(), e.clientY * dpr()); const tx = Math.floor(wx), ty = Math.floor(wy); renderer.hover = [tx, ty]; ui?.setInfo(tx, ty); };
  let downAt: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener("pointerdown", e => { spot?.userActed(performance.now()); readAt(e); canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.classList.add("dragging"); downAt = { x: e.clientX, y: e.clientY, moved: false }; if (pointers.size === 2) { downAt = null; const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
  canvas.addEventListener("pointermove", e => {
    if (!renderer) return;
    const p = pointers.get(e.pointerId);
    if (p) {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) downAt.moved = true;
      if (pointers.size === 1 && (!downAt || downAt.moved)) { renderer.cam.pan((e.clientX - p.x) * dpr(), (e.clientY - p.y) * dpr()); if (pui?.following) { pui.following = false; } }
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) renderer.cam.zoomAt((a.x + b.x) / 2 * dpr(), (a.y + b.y) / 2 * dpr(), d / pinch); pinch = d; }
    }
    if (e.pointerType === "mouse" || !p) readAt(e);
  });
  const up = (e: PointerEvent) => {
    /* a click (not a drag) pins a tag to whoever is under the pointer, or a camp */
    if (downAt && !downAt.moved && renderer && e.type === "pointerup") {
      const [wx, wy] = renderer.cam.toWorld(e.clientX * dpr(), e.clientY * dpr());
      const hit = renderer.people.pick(wx, wy, renderer.cam.z, e.clientX * dpr(), e.clientY * dpr());
      if (hit.person || hit.band || hit.village) pin(hit.person, hit.band, hit.village); else if (pui?.pinned.person || pui?.pinned.band || pui?.pinned.village) pin(0, 0);
    }
    downAt = null;
    pointers.delete(e.pointerId); if (!pointers.size) canvas.classList.remove("dragging"); pinch = 0;
  };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { if (renderer) renderer.hover = null; });
  const held = new Set<string>();
  window.addEventListener("keydown", e => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    held.add(e.key.toLowerCase());
    if (e.key === "Escape") { if (tech && dock?.isOpen("tech") && tech.selected >= 0) { tech.closeCard(); return; } const open = ["search", "journal", "tech", "bands", "modes"].find(k => dock?.isOpen(k)); if (open) dock!.set(open, false); else pin(0, 0); }
    if ((e.key === "/" || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) && search) { e.preventDefault(); search.open(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "j") dock?.toggle("journal");
    if (k === "i") dock?.toggle("tech");
    if (k === "l") spot?.toggle();
    if (k === "n") spot?.skip();
    if (k === "b") dock?.toggle("bonds");
    if (e.key === "," ) ribbon?.step(-1);
    if (e.key === ".") ribbon?.step(1);
    if (e.key.toLowerCase() === "h" && dock) dock.setHidden(!dock.isHidden);
    if (e.key === " ") { e.preventDefault(); ui?.setSpeed(lastTick.speed ? 0 : 1); }
    const n = "123456".indexOf(e.key); if (n >= 0) ui?.setSpeed([0, 1, 3, 10, 30, 100][n]);
    if (renderer && (e.key === "+" || e.key === "=")) renderer.cam.zoomAt(renderer.cam.vw / 2, renderer.cam.vh / 2, 1.4);
    if (renderer && (e.key === "-" || e.key === "_")) renderer.cam.zoomAt(renderer.cam.vw / 2, renderer.cam.vh / 2, 1 / 1.4);
  });
  window.addEventListener("keyup", e => held.delete(e.key.toLowerCase()));
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (renderer) {
      const v = 900 * dt * (window.devicePixelRatio || 1);
      if (held.has("arrowleft") || held.has("a")) renderer.cam.pan(v, 0);
      if (held.has("arrowright") || held.has("d")) renderer.cam.pan(-v, 0);
      if (held.has("arrowup") || held.has("w")) renderer.cam.pan(0, v);
      if (held.has("arrowdown") || held.has("s")) renderer.cam.pan(0, -v);
      const t = lastTick.time + (lastTick.speed * (now - lastTick.at)) / 1000;
      renderer.gameTime = t; renderer.speed = lastTick.speed;
      /* the camera keeps the followed person in view */
      if (pui?.following && pui.pinned.person) { const p = renderer.people.pos.get(pui.pinned.person); if (p && !renderer.cam.flying) { renderer.cam.x += (p[0] - renderer.cam.x) * 0.12; renderer.cam.y += (p[1] - 0.8 - renderer.cam.y) * 0.12; renderer.cam.clamp(); } }
      renderer.draw(now);
      const dpr1 = Math.min(2, window.devicePixelRatio || 1);
      if (pui && dock) pui.inset = dock.isOpen("history") && !dock.isHidden ? ribbon?.height ?? 0 : 0;
      bonds?.poll(renderer.cam, now); bonds?.frame(renderer.cam, renderer.people.pos, dpr1, pui?.pinned.person ?? 0);
      pui?.frame(renderer.cam, renderer.people.pos, camps, dpr1);
      ribbon?.frame(t, now); journal?.tick(now); tech?.tick(now); spot?.frame(now);
      ui?.setTime(t);
      ui?.drawMinimap(renderer.cam.visible());
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* small hook for automated visual checks and the curious */
(window as unknown as { littleAges: unknown }).littleAges = { get renderer() { return renderer; }, get camps() { return camps; }, get history() { return history; }, get ribbon() { return ribbon; }, get spot() { return spot; }, get journal() { return journal; }, get search() { return search; }, get bonds() { return bonds; }, get tech() { return tech; }, get dock() { return dock; }, get deposits() { return deposits; }, lookAt, setSpeed: (s: number) => ui?.setSpeed(s), setTime: (t: number) => send({ type: "settime", time: t }), pin };

start();
