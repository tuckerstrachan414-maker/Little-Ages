import { SIZES, SEASON_NAMES, BIOME_NAMES, TREE_NAMES, Flag, DAY_SECONDS, DAYS_PER_SEASON, DAYS_PER_YEAR, type SizeKey, type MapMode, type WorldData } from "../shared/types.ts";
import { STAGES } from "../sim/world/gen.ts";

/* The paper interface over the map: world creation, the clock, map modes, the tile card, the minimap. */

export function frameURL(): string {
  const c = document.createElement("canvas"); c.width = 18; c.height = 18; const x = c.getContext("2d")!;
  x.fillStyle = "#2b2418"; x.fillRect(1, 0, 16, 18); x.fillRect(0, 1, 18, 16);
  x.fillStyle = "#f2e6c8"; x.fillRect(2, 2, 14, 14);
  x.fillStyle = "#fff8e2"; x.fillRect(2, 2, 14, 1); x.fillRect(2, 2, 1, 14);
  x.fillStyle = "#cbb88e"; x.fillRect(2, 15, 14, 1); x.fillRect(15, 2, 1, 14);
  return c.toDataURL();
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export interface CreateChoice { size: SizeKey; seed: number; start: "bands" | "cradle"; bands: number; }

export function createScreen(root: HTMLElement, onCreate: (c: CreateChoice) => void) {
  const wrap = el("div"); wrap.id = "create";
  const card = el("div", "paper card");
  const randomSeed = () => Math.floor(Math.random() * 999999) + 1;
  card.innerHTML = `
    <h1>Little Ages</h1>
    <p class="lede">A new world, one pixel per tile. Continents rise on drifting plates, rivers find the sea, forests settle where the rain falls, and herds wander it all. People come next.</p>
    <h2>WORLD SIZE</h2>
    <div class="sizes" role="group" aria-label="World size">
      ${(Object.keys(SIZES) as SizeKey[]).map(k => `<button type="button" class="size" data-size="${k}" aria-pressed="${k === "large"}"><b>${SIZES[k].label}</b><span>${k === "medium" ? "Quick to make. Continents a few hundred tiles across." : k === "large" ? "The default. Continents a thousand tiles across, ranges hundreds long." : "Enormous. Four times the land. Takes longer to make."}</span><div class="dims">${SIZES[k].w} x ${SIZES[k].h} TILES</div></button>`).join("")}
    </div>
    <h2>SEED</h2>
    <div class="row"><input id="seed" inputmode="numeric" aria-label="World seed"><button type="button" class="pbtn" id="reroll">NEW SEED</button><span class="note">The same seed always makes the same world.</span></div>
    <h2>HOW HUMANITY STARTS</h2>
    <div class="row">
      <div class="seg" role="group" aria-label="Start"><button type="button" data-start="bands" aria-pressed="true">SCATTERED BANDS</button><button type="button" data-start="cradle" aria-pressed="false">ONE CRADLE</button></div>
      <label for="bands">Bands: <b id="bands-n">12</b></label><input id="bands" type="range" min="4" max="24" value="12">
    </div>
    <p class="note">People arrive in the next update. This build is the world and its wildlife.</p>
    <div class="go"><button type="button" id="go">Create world</button><span class="note" id="go-note"></span></div>
    <div class="progress" hidden><ol>${STAGES.map(s => `<li>${s}</li>`).join("")}<li>Waking the animals</li></ol><div class="bar"><i></i></div></div>`;
  card.style.borderImageSource = `url(${frameURL()})`;
  wrap.append(card); root.append(wrap);
  const seed = card.querySelector<HTMLInputElement>("#seed")!; seed.value = String(randomSeed());
  card.querySelector("#reroll")!.addEventListener("click", () => { seed.value = String(randomSeed()); });
  let size: SizeKey = "large", start: "bands" | "cradle" = "bands";
  card.querySelectorAll<HTMLButtonElement>(".size").forEach(b => b.onclick = () => { size = b.dataset.size as SizeKey; card.querySelectorAll(".size").forEach(o => o.setAttribute("aria-pressed", String(o === b))); });
  card.querySelectorAll<HTMLButtonElement>("[data-start]").forEach(b => b.onclick = () => { start = b.dataset.start as "bands"; card.querySelectorAll("[data-start]").forEach(o => o.setAttribute("aria-pressed", String(o === b))); });
  const bands = card.querySelector<HTMLInputElement>("#bands")!; bands.oninput = () => { card.querySelector("#bands-n")!.textContent = bands.value; };
  const go = card.querySelector<HTMLButtonElement>("#go")!;
  go.onclick = () => {
    go.disabled = true; go.textContent = "Making the world...";
    (card.querySelector(".progress") as HTMLElement).hidden = false;
    onCreate({ size, seed: Math.max(1, parseInt(seed.value, 10) || randomSeed()), start, bands: +bands.value });
  };
  return {
    progress(stage: number, pct: number) {
      const lis = card.querySelectorAll(".progress li");
      lis.forEach((li, i) => { li.className = i < stage ? "done" : i === stage ? "now" : ""; });
      const total = (stage + pct) / (STAGES.length + 1);
      (card.querySelector(".bar i") as HTMLElement).style.width = `${Math.round(total * 100)}%`;
    },
    close() { wrap.remove(); },
    fail(msg: string) { go.disabled = false; go.textContent = "Try again"; card.querySelector("#go-note")!.textContent = `Something went wrong: ${msg}`; },
  };
}

export function hud(root: HTMLElement, world: WorldData, cb: { onSpeed: (s: number) => void; onMode: (m: MapMode) => void; onNew: () => void; onMinimap: (u: number, v: number) => void }) {
  const frame = frameURL();
  const time = el("div", "ui paper pill"); time.id = "hud-time";
  const SPEEDS = [0, 1, 3, 10, 30, 100];
  time.innerHTML = `<span id="hud-date">...</span><div class="seg" role="group" aria-label="Speed">${SPEEDS.map(s => `<button type="button" data-speed="${s}" aria-pressed="${s === 1}" aria-label="${s ? s + " times speed" : "Pause"}">${s ? s + "X" : "II"}</button>`).join("")}</div>`;
  const modes = el("div", "ui paper pill"); modes.id = "hud-modes";
  const MODES: [MapMode, string][] = [["terrain", "TERRAIN"], ["elevation", "HEIGHT"], ["temperature", "HEAT"], ["rainfall", "RAIN"], ["biomes", "BIOMES"]];
  modes.innerHTML = `<div class="seg" role="group" aria-label="Map mode">${MODES.map(([m, l]) => `<button type="button" data-mode="${m}" aria-pressed="${m === "terrain"}">${l}</button>`).join("")}</div><button type="button" class="pbtn" id="new-world">NEW WORLD</button>`;
  const info = el("div", "ui paper"); info.id = "hud-info";
  const touch = window.matchMedia("(hover: none)").matches;
  info.innerHTML = touch ? `<h3>Tap the map</h3><p class="muted">Tap any spot to read the land.</p>` : `<h3>Hover the map</h3><p class="muted">Point at any tile to read the land.</p>`;
  const map = el("div", "ui paper"); map.id = "hud-map";
  const mw = Math.min(260, Math.round(260 * (world.w / world.h) / 2)), mh = Math.round(mw * world.h / world.w);
  const mini = el("canvas"); mini.width = mw; mini.height = mh; mini.setAttribute("aria-label", "Minimap. Click to jump there.");
  const cap = el("div", "cap", `<span>${world.size.toUpperCase()}</span><span id="hud-life"></span>`);
  map.append(mini, cap);
  const hint = el("div", "ui"); hint.id = "hud-hint"; hint.textContent = "SCROLL OR PINCH TO ZOOM  /  DRAG TO PAN  /  SPACE TO PAUSE";
  [time, modes, info, map].forEach(p => (p.style.borderImageSource = `url(${frame})`));
  root.append(time, modes, info, map, hint);
  time.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(b => b.onclick = () => setSpeed(+b.dataset.speed!));
  const setSpeed = (s: number) => { time.querySelectorAll("[data-speed]").forEach(o => o.setAttribute("aria-pressed", String(+(o as HTMLElement).dataset.speed! === s))); cb.onSpeed(s); };
  modes.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b => b.onclick = () => { modes.querySelectorAll("[data-mode]").forEach(o => o.setAttribute("aria-pressed", String(o === b))); cb.onMode(b.dataset.mode as MapMode); });
  modes.querySelector<HTMLButtonElement>("#new-world")!.onclick = cb.onNew;
  let dragging = false;
  const jump = (e: PointerEvent) => { const r = mini.getBoundingClientRect(); cb.onMinimap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); };
  mini.addEventListener("pointerdown", e => { dragging = true; mini.setPointerCapture(e.pointerId); jump(e); });
  mini.addEventListener("pointermove", e => { if (dragging) jump(e); });
  mini.addEventListener("pointerup", () => { dragging = false; });
  const date = time.querySelector("#hud-date")!, life = cap.querySelector("#hud-life")!;
  const mctx = mini.getContext("2d")!;
  let base: HTMLCanvasElement | null = null;
  let fields: { gw: number; cell: number; rabbits: Uint8Array; fish: Uint8Array } | null = null;
  const plenty = (v: number) => v > 0.66 ? "plenty" : v > 0.33 ? "some" : v > 0.08 ? "scarce" : "none";
  return {
    setSpeed,
    setTime(t: number) {
      const dayN = Math.floor(t / DAY_SECONDS), year = Math.floor(dayN / DAYS_PER_YEAR) + 1, season = Math.floor(dayN / DAYS_PER_SEASON) % 4, day = (dayN % DAYS_PER_SEASON) + 1;
      const frac = (t / DAY_SECONDS) % 1, hh = Math.floor(frac * 24), mm = Math.floor((frac * 24 - hh) * 60 / 10) * 10;
      date.innerHTML = `${SEASON_NAMES[season]}, day ${day}<small>Year ${year} &middot; ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}</small>`;
    },
    setLife(l: { animals: number; birds: number; rabbits: number; fish: number }) {
      const k = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : n.toLocaleString();
      life.textContent = `${k(l.animals + l.birds + l.rabbits)} ANIMALS`;
      life.setAttribute("title", `${l.animals.toLocaleString()} large animals, ${l.birds.toLocaleString()} birds, about ${l.rabbits.toLocaleString()} rabbits and hares, about ${l.fish.toLocaleString()} fish`);
    },
    setFields(f: { gw: number; cell: number; rabbits: Uint8Array; fish: Uint8Array }) { fields = f; },
    setMinimap(src: HTMLCanvasElement) { base = document.createElement("canvas"); base.width = mw; base.height = mh; const b = base.getContext("2d")!; b.imageSmoothingEnabled = true; b.imageSmoothingQuality = "high"; b.drawImage(src, 0, 0, mw, mh); },
    drawMinimap(view: { x0: number; y0: number; x1: number; y1: number }) {
      if (!base) return; mctx.drawImage(base, 0, 0);
      const sx = mw / world.w, sy = mh / world.h;
      mctx.strokeStyle = "#fff4d6"; mctx.lineWidth = 1.5; mctx.strokeRect(view.x0 * sx + 0.5, view.y0 * sy + 0.5, Math.max(3, (view.x1 - view.x0) * sx), Math.max(3, (view.y1 - view.y0) * sy));
    },
    setInfo(x: number, y: number) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) return;
      const i = y * world.w + x, b = world.biome[i], f = world.flags[i], e = world.elev[i];
      const tC = Math.round(world.temp[i] / 255 * 62 - 26), mm = Math.round(world.rain[i] / 255 * 3200);
      const elevText = f & Flag.Ocean ? `${Math.round(-e * 6000).toLocaleString()} m deep` : `${Math.round(Math.max(0, e) * 5200).toLocaleString()} m`;
      const tree = world.tree[i] ? TREE_NAMES[world.tree[i]] : "";
      const extra = f & Flag.River ? (world.depth[i] >= 3 ? "A great river" : world.depth[i] === 2 ? "A river" : "A stream") : f & Flag.Ocean ? `${world.depth[i]} tiles from shore` : f & Flag.Lake ? "Fresh water" : tree ? `${tree}${world.tree[i] >= 18 ? "" : " trees"}` : "Open ground";
      let game = "";
      if (fields) {
        const c = Math.floor(y / fields.cell) * fields.gw + Math.floor(x / fields.cell);
        game = f & Flag.Water ? `<dt>FISH</dt><dd>${plenty(fields.fish[c] / 255)}</dd>` : fields.rabbits[c] ? `<dt>SMALL GAME</dt><dd>${plenty(fields.rabbits[c] / 255)}</dd>` : "";
      }
      info.innerHTML = `<h3>${BIOME_NAMES[b]}</h3><dl><dt>HERE</dt><dd>${extra}</dd><dt>HEIGHT</dt><dd>${elevText}</dd><dt>CLIMATE</dt><dd>${tC}&deg;C average, ${mm.toLocaleString()} mm rain</dd>${game}<dt>TILE</dt><dd>${x}, ${y}</dd></dl>`;
    },
  };
}
