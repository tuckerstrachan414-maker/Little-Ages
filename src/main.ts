import "./ui/styles.css";
import SimWorker from "./sim/worker.ts?worker&inline";
import { Renderer } from "./render/renderer.ts";
import { createScreen, hud } from "./ui/hud.ts";
import type { FromWorker, ToWorker } from "./shared/protocol.ts";
import type { MapMode } from "./shared/types.ts";

/* Boot: world creation, then the map, the simulation worker and the interface. */

const canvas = document.getElementById("world") as HTMLCanvasElement;
const app = document.getElementById("app")!;
let worker: Worker | null = null;
let renderer: Renderer | null = null;
let ui: ReturnType<typeof hud> | null = null;
let lastTick = { time: 0, at: 0, speed: 1 };
const life = { animals: 0, birds: 0, rabbits: 0, fish: 0 };
const send = (m: ToWorker) => worker?.postMessage(m);

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
        ui = hud(app, m.world, {
          onSpeed: s => { send({ type: "speed", speed: s }); lastTick.speed = s; },
          onMode: (mode: MapMode) => send({ type: "mode", mode }),
          onNew: () => { worker?.terminate(); worker = null; renderer = null; app.innerHTML = ""; start(); },
          onMinimap: (u, v) => { if (renderer) { renderer.cam.x = u * renderer.world.w; renderer.cam.y = v * renderer.world.h; renderer.cam.clamp(); } },
        });
        bindInput();
      } else if (m.type === "baked") {
        if (!renderer) return;
        renderer.setTerrain(m.pixels, m.season, m.mode);
        if (m.mode === "terrain") ui?.setMinimap(renderer.terrain);
        screen.close();
      } else if (m.type === "fields") {
        if (renderer) renderer.fields = m;
        life.rabbits = m.rabbitTotal; life.fish = m.fishTotal; ui?.setLife(life); ui?.setFields(m);
      } else if (m.type === "tick") {
        if (!renderer) return;
        renderer.herdsPrev = renderer.herds; renderer.herds = { n: m.herdCount, data: m.herds }; renderer.herdT = performance.now();
        renderer.flocksPrev = renderer.flocks; renderer.flocks = { n: m.flockCount, data: m.birds };
        lastTick = { time: m.time, at: performance.now(), speed: m.speed };
        life.animals = m.animals; life.birds = m.birdCount; ui?.setLife(life);
      }
    };
    send({ type: "generate", size: choice.size, seed: choice.seed });
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
  canvas.addEventListener("wheel", e => { e.preventDefault(); if (!renderer) return; const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)); renderer.cam.zoomAt(e.clientX * dpr(), e.clientY * dpr(), f); }, { passive: false });
  const readAt = (e: PointerEvent) => { if (!renderer) return; const [wx, wy] = renderer.cam.toWorld(e.clientX * dpr(), e.clientY * dpr()); const tx = Math.floor(wx), ty = Math.floor(wy); renderer.hover = [tx, ty]; ui?.setInfo(tx, ty); };
  canvas.addEventListener("pointerdown", e => { readAt(e); canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.classList.add("dragging"); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
  canvas.addEventListener("pointermove", e => {
    if (!renderer) return;
    const p = pointers.get(e.pointerId);
    if (p) {
      if (pointers.size === 1) renderer.cam.pan((e.clientX - p.x) * dpr(), (e.clientY - p.y) * dpr());
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) renderer.cam.zoomAt((a.x + b.x) / 2 * dpr(), (a.y + b.y) / 2 * dpr(), d / pinch); pinch = d; }
    }
    if (e.pointerType === "mouse" || !p) readAt(e);
  });
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (!pointers.size) canvas.classList.remove("dragging"); pinch = 0; };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { if (renderer) renderer.hover = null; });
  const held = new Set<string>();
  window.addEventListener("keydown", e => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    held.add(e.key.toLowerCase());
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
      renderer.draw(now);
      ui?.setTime(t);
      ui?.drawMinimap(renderer.cam.visible());
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* small hook for automated visual checks and the curious */
(window as unknown as { littleAges: unknown }).littleAges = { get renderer() { return renderer; }, setSpeed: (s: number) => ui?.setSpeed(s), setTime: (t: number) => send({ type: "settime", time: t }) };

start();
