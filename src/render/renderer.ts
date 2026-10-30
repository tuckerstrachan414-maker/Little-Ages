import { bakeTile } from "../sim/world/bake.ts";
import { Camera } from "./camera.ts";
import { treeSprite, treeGlyph } from "./sprites/trees.ts";
import { animalSprite, ANIMAL_DOT } from "./sprites/animals.ts";
import { textureKind, tileTexture } from "./sprites/textures.ts";
import { Biome, Flag, DAY_SECONDS, type Season, type MapMode, type WorldData } from "../shared/types.ts";
import { FN } from "../shared/palette.ts";
import { hash2 } from "../shared/rng.ts";
import { isSnowy } from "../shared/seasonfx.ts";
import { fineGround } from "./ground.ts";
import { drawBirds, drawFish, drawRabbits, drawDryness, type Fields, type FlockSnap } from "./life.ts";
import { PeopleLayer } from "./people.ts";
import { paintInDepth, type DepthItem } from "./depth.ts";
import { CREATURE_SCALE } from "./scale.ts";

/*
  Draw order each frame:
    1. the whole map, one pixel per tile, scaled to the zoom (cross-fading between seasons)
    2. up close: cached chunks of ground texture, then live water (foam, glints) and fish
    3. up close: trees, wildlife, birds on the ground and people with their camps, all painted
       in depth order by the row they stand on, so a creature walks behind a tree that stands
       in front of it, and in front of one that stands behind it
    4. flying birds, clouds and their shadows, day and night, then campfire light through the
       dark and band names over their camps
  Chunks are rebuilt lazily a few per frame, so zooming never stalls.
*/

const BUCKETS = [4, 6, 8, 12, 16, 24, 32, 48];
const CHUNK_PX = 256;
/* A tree row is cached on its own canvas that starts LIFT tiles above it: the tallest crown is 3.5 tiles, and a trunk can dip into the next row. */
const LIFT = 3;
/* A trunk stands near the bottom of its tile: about 0.42 of a tile below the middle of its row. */
const TREE_OFFSET = 0.42;
/* Rows per cached band. Up close a row is its own band; zoomed out, creatures are dots, so rows share a band to save draw calls. */
const rowsPerBand = (T: number) => (T < 8 ? 4 : 1);
/* Share of forest tiles that hold a tree. Forests stay dense, with gaps where the creatures can be seen. */
const TREE_KEEP = 0.62;
/* How far a creature can reach into a neighboring tree chunk, in tiles: a crown rises 3.5 tiles above its trunk, a creature stands 1.5 tall and about a tile wide. */
const REACH_UP = 3.5, REACH_DOWN = 2, REACH_SIDE = 2.5;

/* A chunk's trees come in two forms: one canvas for the whole chunk, and a sheet of row bands for when creatures are near. */
interface Chunk { ground: HTMLCanvasElement | null; objects: HTMLCanvasElement | null; sheet: HTMLCanvasElement | null; groups: boolean[]; surf: HTMLCanvasElement[] | null; used: number; px: number; }
export interface HerdSnap { n: number; data: Float32Array; }   /* per herd: id, species, x, y, count, heading, state */
export const HERD_STRIDE = 7;

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly cam: Camera;
  terrain: HTMLCanvasElement;
  private terrainPrev: HTMLCanvasElement | null = null;
  private px: Uint8ClampedArray | null = null;   /* the baked terrain colors, for the close-up ground */
  private fadeStart = 0;
  season: Season = 1;
  mode: MapMode = "terrain";
  private chunks = new Map<string, Chunk>();
  private chunkPixels = 0;
  private coast = new Map<number, Int32Array>();
  herdsPrev: HerdSnap | null = null;
  herds: HerdSnap | null = null;
  herdT = 0;
  flocksPrev: FlockSnap | null = null;
  flocks: FlockSnap | null = null;
  fields: Fields | null = null;
  gameTime = 0;            /* seconds of game time, extrapolated between worker ticks */
  speed = 1;
  hover: [number, number] | null = null;
  dayNight = true;
  dpr = 1;
  readonly people: PeopleLayer;
  private clouds: { x: number; y: number; s: number; v: number; sprite: HTMLCanvasElement; shadow: HTMLCanvasElement }[] = [];

  readonly canvas: HTMLCanvasElement;
  readonly world: WorldData;
  constructor(canvas: HTMLCanvasElement, world: WorldData) {
    this.canvas = canvas; this.world = world;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.cam = new Camera(world.w, world.h);
    this.people = new PeopleLayer(world);
    this.terrain = document.createElement("canvas");
    this.terrain.width = world.w; this.terrain.height = world.h;
    this.makeClouds();
  }

  setTerrain(px: Uint8ClampedArray, season: Season, mode: MapMode): void {
    const fresh = document.createElement("canvas"); fresh.width = this.world.w; fresh.height = this.world.h;
    fresh.getContext("2d")!.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, this.world.w, this.world.h), 0, 0);
    const changed = season !== this.season || mode !== this.mode;
    this.terrainPrev = changed ? this.mipFor(this.cam.z) : null; this.fadeStart = performance.now();
    this.terrain = fresh; this.season = season; this.mode = mode;
    if (mode === "terrain") this.px = px;
    /* pre-shrunk copies so the zoomed-out view is a cheap blit */
    this.buildMips();
    if (mode !== "terrain" || changed) this.clearChunks();
  }
  private mips: HTMLCanvasElement[] = [];
  private mipsDirty = false; private mipsAt = 0;
  /** The smallest copy of the map that still has at least one pixel per screen pixel. */
  private mipFor(z: number): HTMLCanvasElement { let best = this.terrain; for (const m of this.mips) { if (m.width / this.world.w >= z) best = m; } return best; }
  private buildMips(): void {
    this.mips = [];
    let src = this.terrain;
    while (src.width > 512) { const m = document.createElement("canvas"); m.width = src.width >> 1; m.height = src.height >> 1; const c = m.getContext("2d")!; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.drawImage(src, 0, 0, m.width, m.height); this.mips.push(m); src = m; }
    this.mipsDirty = false; this.mipsAt = performance.now();
  }
  /**
   * Trees felled, fallen or grown back: the page's copy of the world changes, the tile is repainted on the map,
   * and the cached ground chunks over it are thrown away so they are built again with the land as it is now.
   */
  applyTiles(changes: Int32Array): void {
    const wd = this.world, W = wd.w;
    const tctx = this.terrain.getContext("2d")!, one = tctx.createImageData(1, 1);
    const gone = new Set<string>();
    for (let k = 0; k < changes.length; k += 2) {
      const i = changes[k], t = changes[k + 1];
      if (i < 0 || i >= wd.tree.length) continue;
      wd.tree[i] = t;
      if (this.px) {
        bakeTile(wd, this.season, this.mode, i, this.px);
        if (this.mode === "terrain") { const o = i * 4; one.data[0] = this.px[o]; one.data[1] = this.px[o + 1]; one.data[2] = this.px[o + 2]; one.data[3] = 255; tctx.putImageData(one, i % W, (i / W) | 0); }
      }
      const x = i % W, y = (i / W) | 0;
      for (const T of BUCKETS) {
        const CH = Math.max(8, Math.round(CHUNK_PX / T)), cx = Math.floor(x / CH), cy = Math.floor(y / CH);
        /* a crown reaches into the chunk above, the ground smoothing into every neighbor: on a border, those go too */
        const bx = x % CH === 0 ? -1 : x % CH === CH - 1 ? 1 : 0, by = y % CH === 0 ? -1 : y % CH === CH - 1 ? 1 : 0;
        for (let dy = Math.min(0, by); dy <= Math.max(0, by); dy++) for (let dx = Math.min(0, bx); dx <= Math.max(0, bx); dx++) gone.add(`${cx + dx},${cy + dy},${T}`);
      }
    }
    for (const g of gone) for (let s = 0; s < 4; s++) { const key = `${g},${s}`, c = this.chunks.get(key); if (c) { this.chunks.delete(key); this.chunkPixels -= c.px; } }
    this.mipsDirty = true;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr); this.canvas.height = Math.round(cssH * dpr);
    this.cam.resize(this.canvas.width, this.canvas.height);
  }

  draw(now: number): void {
    const { ctx, cam } = this;
    cam.step(now);
    /* felled trees reach the zoomed-out map at most once a second */
    if (this.mipsDirty && now - this.mipsAt > 1000) this.buildMips();
    const z = cam.z, W = this.world.w, H = this.world.h;
    ctx.fillStyle = FN.deep; ctx.fillRect(0, 0, cam.vw, cam.vh);
    /* 1. the map */
    const [ox, oy] = cam.toScreen(0, 0);
    ctx.imageSmoothingEnabled = z < 1;
    ctx.imageSmoothingQuality = "low";
    const fade = this.terrainPrev ? Math.min(1, (now - this.fadeStart) / 1400) : 1;
    if (this.terrainPrev && fade < 1) { ctx.drawImage(this.terrainPrev, ox, oy, W * z, H * z); ctx.globalAlpha = fade; }
    ctx.drawImage(this.mipFor(z), ox, oy, W * z, H * z);
    ctx.globalAlpha = 1;
    if (fade >= 1) this.terrainPrev = null;
    ctx.imageSmoothingEnabled = false;
    /* 2. close-up ground, water and fish */
    const detail = z >= 4 && this.mode === "terrain";
    if (detail && this.bucketFor(z) >= 8) this.drawChunks(now, z);   /* below sprite scale the ground is just the map itself */
    if (z >= 6 && this.mode === "terrain") this.drawWater(now, z, this.bucketFor(z) < 8);
    if (this.fields && this.mode === "terrain" && z >= 2) drawDryness(ctx, cam, this.world, this.fields);
    if (this.fields && this.mode === "terrain") drawFish(ctx, cam, this.world, this.fields, now, this.season);
    /* 3. everything that stands on the ground, painted in depth order */
    const ba = Math.min(1, (now - this.herdT) / 100);
    const creatures: DepthItem[] = [];
    this.collectHerds(creatures, now, z);
    if (this.fields && this.mode === "terrain") drawRabbits(ctx, cam, this.world, this.fields, this.gameTime, this.season, creatures);
    drawBirds(ctx, cam, this.flocks, this.flocksPrev, ba, now, false, creatures);
    if (this.mode === "terrain") this.people.collect(creatures, ctx, cam, now, this.season);
    const trees: DepthItem[] = [];
    if (detail) this.collectTrees(trees, creatures, now, z);
    paintInDepth(creatures.concat(trees));
    if (this.mode === "terrain") this.people.drawOverlay(ctx, cam);
    /* 4. flying birds, the hover box, weather and light */
    drawBirds(ctx, cam, this.flocks, this.flocksPrev, ba, now, true);
    if (this.hover && z >= 4) { const [hx, hy] = cam.toScreen(this.hover[0], this.hover[1]); ctx.strokeStyle = "rgba(255,240,200,.8)"; ctx.lineWidth = Math.max(1, z / 16); ctx.strokeRect(Math.round(hx) + 0.5, Math.round(hy) + 0.5, Math.round(z) - 1, Math.round(z) - 1); }
    this.drawClouds(z);
    if (this.dayNight && this.mode === "terrain") { this.drawDayNight(z); this.people.drawGlow(ctx, cam, now, this.sun()); }
    this.people.drawLabels(ctx, cam, this.dpr);
    this.evictChunks();
  }

  /* ---------- chunks ---------- */
  private bucketFor(z: number): number { let b = BUCKETS[0]; for (const v of BUCKETS) if (v <= z + 1e-6) b = v; return b; }
  /** The ground of the visible chunks, drawn flat under everything else. */
  private drawChunks(now: number, z: number): void {
    const { ctx, cam } = this, T = this.bucketFor(z), CH = Math.max(8, Math.round(CHUNK_PX / T)), k = z / T;
    const v = cam.visible();
    const cx0 = Math.floor(v.x0 / CH), cy0 = Math.floor(Math.max(0, v.y0 - 1) / CH), cx1 = Math.floor((v.x1 - 1) / CH), cy1 = Math.floor(Math.min(this.world.h - 1, v.y1 + 3) / CH);
    const t0 = performance.now();
    let built = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = `${cx},${cy},${T},${this.season}`;
      let ch = this.chunks.get(key);
      /* build missing chunks a few milliseconds' worth per frame, so zooming never stalls */
      if (!ch && (built === 0 || performance.now() - t0 < 7)) { ch = this.buildChunk(cx, cy, T, CH); this.chunks.set(key, ch); this.chunkPixels += ch.px; built++; }
      if (!ch) { ch = this.findStale(cx, cy, T); if (!ch) continue; }
      ch.used = now;
      if (!ch.ground) continue;
      const [sx, sy] = cam.toScreen(cx * CH, cy * CH);
      ctx.drawImage(ch.ground, Math.round(sx), Math.round(sy), Math.ceil(CH * T * k), Math.ceil(CH * T * k));
      if (ch.surf) { const f = ch.surf[Math.floor(now / 520 + (cx * 7 + cy * 3) * 0.37) & 3]; ctx.drawImage(f, Math.round(sx), Math.round(sy), Math.ceil(f.width / 8 * T * k), Math.ceil(f.height / 8 * T * k)); }
    }
  }
  /**
   * The trees of the visible chunks. A chunk with no creature close to it is one cached canvas, drawn in a single
   * step. A chunk that creatures can overlap is split by tile row, so each row is painted at its depth among them.
   */
  private collectTrees(out: DepthItem[], creatures: DepthItem[], now: number, z: number): void {
    const { ctx, cam } = this, T = this.bucketFor(z), CH = Math.max(8, Math.round(CHUNK_PX / T)), k = z / T;
    const v = cam.visible();
    const cx0 = Math.floor(v.x0 / CH), cy0 = Math.floor(Math.max(0, v.y0 - 1) / CH), cx1 = Math.floor((v.x1 - 1) / CH), cy1 = Math.floor(Math.min(this.world.h - 1, v.y1 + 3) / CH);
    /* which chunks have a creature within reach of their trees */
    const busy = new Set<number>(), cell = (cx: number, cy: number) => (cx + 1) * 1_000_003 + (cy + 1);
    for (const c of creatures) {
      for (let cx = Math.floor((c.x - REACH_SIDE) / CH); cx <= Math.floor((c.x + REACH_SIDE) / CH); cx++)
        for (let cy = Math.floor((c.y - REACH_UP) / CH); cy <= Math.floor((c.y + REACH_DOWN) / CH); cy++) busy.add(cell(cx, cy));
    }
    const G = rowsPerBand(T), t0 = performance.now();
    let built = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = `${cx},${cy},${T},${this.season}`;
      let ch = this.chunks.get(key);
      /* chunks at full scale are built with their ground; only the small-scale ones are built here */
      if (!ch && T < 8 && (built === 0 || performance.now() - t0 < 7)) { ch = this.buildChunk(cx, cy, T, CH); this.chunks.set(key, ch); this.chunkPixels += ch.px; built++; }
      if (!ch) { ch = this.findStale(cx, cy, T); if (!ch) continue; }
      ch.used = now;
      const [sx, sy] = cam.toScreen(cx * CH, cy * CH);
      if (!busy.has(cell(cx, cy))) {
        if (ch.objects) { const o = ch.objects; out.push({ x: cx * CH, y: cy * CH, f: () => ctx.drawImage(o, Math.round(sx - T * k), Math.round(sy - 3 * T * k), Math.ceil(o.width * k), Math.ceil(o.height * k)) }); }
        continue;
      }
      const sheet = ch.sheet; if (!sheet) continue;
      const BH = (G + LIFT + 1) * T;
      ch.groups.forEach((on, g) => {
        if (!on) return;
        const row = g * G;
        out.push({ x: cx * CH, y: cy * CH + row + G / 2 + TREE_OFFSET, f: () => ctx.drawImage(sheet, 0, g * BH, sheet.width, BH, Math.round(sx - T * k), Math.round(sy + (row - LIFT) * T * k), Math.ceil(sheet.width * k), Math.ceil(BH * k)) });
      });
    }
  }
  private findStale(cx: number, cy: number, T: number): Chunk | undefined {
    for (let s = 0; s < 4; s++) { const c = this.chunks.get(`${cx},${cy},${T},${s}`); if (c) return c; }
    return undefined;
  }
  private buildChunk(cx: number, cy: number, T: number, CH: number): Chunk {
    const wd = this.world, x0 = cx * CH, y0 = cy * CH, cw = Math.min(CH, wd.w - x0), chh = Math.min(CH, wd.h - y0);
    const ground = T >= 8 ? document.createElement("canvas") : null;
    let surf: HTMLCanvasElement[] | null = null, wet: ((tx: number, ty: number) => boolean) | null = null;
    if (ground && this.px) {
      ground.width = CH * T; ground.height = CH * T;
      const g = ground.getContext("2d")!; g.imageSmoothingEnabled = false;
      const fine = fineGround(wd, this.px, this.season, x0, y0, cw, chh); wet = fine.wet;
      g.drawImage(fine.ground, 0, 0, cw * T, chh * T); surf = fine.surf;
      for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
        const i = (y0 + y) * wd.w + x0 + x; if (wd.flags[i] & Flag.Water) continue;
        /* shore tiles are left plain, their outline is no longer square */
        if (wd.flags[i] & Flag.Coast && this.touchesWater(x0 + x, y0 + y)) continue;
        const tex = tileTexture(textureKind(wd.biome[i]), Math.floor(hash2(x0 + x, y0 + y, 5) * 6));
        if (tex) g.drawImage(tex, x * T, y * T, T, T);
      }
    }
    /* trees and rocks: the whole chunk on one canvas for when no creature is near, and one canvas per tile row for when one is */
    const o = document.createElement("canvas"); o.width = (CH + 2) * T; o.height = (CH + 4) * T;
    const oc = o.getContext("2d")!; oc.imageSmoothingEnabled = false;
    /* row bands share one sheet, each band a slot LIFT tiles above its first row, tall enough for the crowns above it */
    const G = rowsPerBand(T), BH = (G + LIFT + 1) * T, groups = new Array<boolean>(Math.ceil(CH / G)).fill(false);
    const sheet = document.createElement("canvas"); sheet.width = (CH + 2) * T; sheet.height = groups.length * BH;
    const sc = sheet.getContext("2d")!; sc.imageSmoothingEnabled = false;
    const originOf = (row: number) => Math.floor(row / G) * G - LIFT;
    const slotOf = (row: number) => Math.floor(row / G) * BH;
    const sk = T / 8;
    let any = false;
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const wx = x0 + x, wy = y0 + y, i = wy * wd.w + wx;
      /* not every forest tile holds a tree: thinning leaves gaps for the creatures to be seen in */
      const sp = hash2(wx, wy, 88) < TREE_KEEP ? wd.tree[i] : 0;
      if (!sp) {
        if (wd.biome[i] === Biome.Mountain && T >= 8 && hash2(wx, wy, 41) < 0.05 && !(wet && wet(x + 0.5, y + 0.8))) {
          any = true;
          this.boulder(oc, (x + 1) * T + T / 2, (y + 3) * T + T * 0.8, sk);
          groups[Math.floor(y / G)] = true;
          this.boulder(sc, (x + 1) * T + T / 2, (y + 0.8 - originOf(y)) * T + slotOf(y), sk);
        }
        continue;
      }
      const h = hash2(wx, wy, 31);
      let jx = (h - 0.5) * 0.35, jy = (hash2(wx, wy, 32) - 0.5) * 0.25 + 0.42;
      /* the smoothed shore can swallow a tile's corner: keep the trunk on dry ground */
      if (wet && wet(x + 0.5 + jx, y + 0.5 + jy)) { jx = 0; jy = 0; if (wet(x + 0.5, y + 0.5)) continue; }
      any = true;
      const snowy = isSnowy(wd.temp[i] / 255, wd.biome[i], this.season, hash2(wx, wy, wd.seed + 5));
      const spr = T >= 8 ? treeSprite(sp, this.season, Math.floor(h * 3), snowy) : treeGlyph(sp, this.season, snowy);
      /* the sprite is drawn with its trunk on the tile, at this scale */
      const scale = T >= 8 ? sk : T / 4;
      const w = Math.round(spr.width * scale), hh = Math.round(spr.height * scale);
      const bx = (x + 1 + 0.5 + jx) * T, byO = (y + 3 + 0.5 + jy) * T, byB = (y + 0.5 + jy - originOf(y)) * T + slotOf(y);
      oc.drawImage(spr, Math.round(bx - w / 2), Math.round(byO - hh), w, hh);
      sc.drawImage(spr, Math.round(bx - w / 2), Math.round(byB - hh), w, hh);
      groups[Math.floor(y / G)] = true;
    }
    const objects = any ? o : null, rows = any ? sheet : null;
    const px = (ground ? ground.width * ground.height : 0) + (surf ? surf.length * surf[0].width * surf[0].height : 0)
      + (objects ? objects.width * objects.height : 0) + (rows ? rows.width * rows.height : 0);
    return { ground, objects, sheet: rows, groups, surf, used: performance.now(), px };
  }
  private touchesWater(x: number, y: number): boolean {
    const { w, h, flags } = this.world;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && flags[yy * w + xx] & Flag.Water) return true; }
    return false;
  }
  private boulder(c: CanvasRenderingContext2D, x: number, y: number, k: number) {
    const s = Math.max(1, k);
    c.fillStyle = "rgba(12,14,24,.22)"; c.fillRect(x - 3 * s, y, 7 * s, s);
    c.fillStyle = FN.outline; c.fillRect(x - 3 * s, y - 3 * s, 6 * s, 3 * s);
    c.fillStyle = FN.rock; c.fillRect(x - 2 * s, y - 3 * s, 4 * s, 2 * s); c.fillStyle = FN.rockL; c.fillRect(x - 2 * s, y - 3 * s, 2 * s, s);
  }
  private evictChunks(): void {
    const budget = 90_000_000;
    if (this.chunkPixels < budget) return;
    const list = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, c] of list) { if (this.chunkPixels < budget * 0.7) break; this.chunks.delete(k); this.chunkPixels -= c.px; }
  }
  clearChunks(): void { this.chunks.clear(); this.chunkPixels = 0; }

  /* ---------- live water ---------- */
  private coastBlock(bx: number, by: number): Int32Array {
    const key = by * 4096 + bx; let c = this.coast.get(key); if (c) return c;
    const wd = this.world, out: number[] = [];
    for (let y = by * 32; y < Math.min(wd.h, by * 32 + 32); y++) for (let x = bx * 32; x < Math.min(wd.w, bx * 32 + 32); x++) {
      const i = y * wd.w + x; if (!(wd.flags[i] & Flag.Water)) continue;
      let m = 0;
      if (y > 0 && !(wd.flags[i - wd.w] & Flag.Water)) m |= 1;
      if (y < wd.h - 1 && !(wd.flags[i + wd.w] & Flag.Water)) m |= 2;
      if (x > 0 && !(wd.flags[i - 1] & Flag.Water)) m |= 4;
      if (x < wd.w - 1 && !(wd.flags[i + 1] & Flag.Water)) m |= 8;
      if (m) out.push(x, y, m); else if (hash2(x, y, 77) < 0.02) out.push(x, y, 16);
    }
    c = new Int32Array(out); this.coast.set(key, c); return c;
  }
  /** Glints on open water; below sprite scale also tile-edge surf (above it, chunks carry their own). */
  private drawWater(now: number, z: number, foam: boolean): void {
    const { ctx, cam } = this, v = cam.visible(), fw = Math.max(1, Math.round(z / 10)), sp = Math.max(1, Math.round(z / 8));
    const frozen = this.season === 3;
    for (let by = v.y0 >> 5; by <= (v.y1 - 1) >> 5; by++) for (let bx = v.x0 >> 5; bx <= (v.x1 - 1) >> 5; bx++) {
      const list = this.coastBlock(bx, by);
      for (let n = 0; n < list.length; n += 3) {
        const x = list[n], y = list[n + 1], m = list[n + 2];
        if (x < v.x0 - 1 || x > v.x1 || y < v.y0 - 1 || y > v.y1) continue;
        if (frozen && this.world.temp[y * this.world.w + x] < 115) continue;
        const [sx, sy] = cam.toScreen(x, y), X = Math.round(sx), Y = Math.round(sy), T = Math.ceil(z);
        const p = ((now + hash2(x, y, 3) * 4000) % 2800) / 2800;
        if (m === 16) { if (p < 0.3) { ctx.fillStyle = "rgba(220,235,230,.5)"; const gx = X + Math.round(p * 6) * sp; ctx.fillRect(gx, Y + 4 * sp, 3 * sp, sp); if (p > 0.1 && p < 0.2) ctx.fillRect(gx + sp, Y + 3 * sp, sp, sp); } continue; }
        if (!foam) continue;
        const wave = Math.round((0.5 - 0.5 * Math.cos(p * Math.PI * 2)) * Math.max(1, z / 6));
        ctx.fillStyle = "rgba(224,236,226,.85)";
        if (m & 1) ctx.fillRect(X, Y, T, fw); if (m & 2) ctx.fillRect(X, Y + T - fw, T, fw); if (m & 4) ctx.fillRect(X, Y, fw, T); if (m & 8) ctx.fillRect(X + T - fw, Y, fw, T);
        ctx.fillStyle = "rgba(224,236,226,.32)";
        if (m & 1) ctx.fillRect(X, Y + fw + wave, T, fw); if (m & 2) ctx.fillRect(X, Y + T - 2 * fw - wave, T, fw); if (m & 4) ctx.fillRect(X + fw + wave, Y, fw, T); if (m & 8) ctx.fillRect(X + T - 2 * fw - wave, Y, fw, T);
      }
    }
  }

  /* ---------- wildlife ---------- */
  /** Herds on the visible land, each member queued at its own feet so it sorts among the trees. */
  private collectHerds(out: DepthItem[], now: number, z: number): void {
    const cur = this.herds; if (!cur || z < 0.9) return;
    const prev = this.herdsPrev, a = Math.min(1, (now - this.herdT) / 100);
    const { ctx, cam } = this, v = cam.visible(), winter = this.season === 3;
    const prevPos = new Map<number, number>();
    if (prev) for (let k = 0; k < prev.n; k++) prevPos.set(prev.data[k * HERD_STRIDE], k);
    for (let k = 0; k < cur.n; k++) {
      const o = k * HERD_STRIDE, id = cur.data[o], sp = cur.data[o + 1];
      let x = cur.data[o + 2], y = cur.data[o + 3];
      const pk = prevPos.get(id); if (pk !== undefined && prev) { const po = pk * HERD_STRIDE; x = prev.data[po + 2] + (x - prev.data[po + 2]) * a; y = prev.data[po + 3] + (y - prev.data[po + 3]) * a; }
      const count = cur.data[o + 4], heading = cur.data[o + 5], state = cur.data[o + 6];
      if (x < v.x0 - 6 || x > v.x1 + 6 || y < v.y0 - 6 || y > v.y1 + 6) continue;
      const spread = sp === 2 ? 1.6 : sp === 4 || sp === 5 ? 1 : sp >= 6 ? 0.9 : 1.25;
      for (let m = 0; m < count; m++) {
        /* members keep loose formation; each wanders a little on its own */
        const r = Math.sqrt(m + 0.5) * spread * 0.9, ang = m * 2.399 + id;
        const wob = Math.sin(now / 1500 + m * 1.7 + id) * 0.25;
        const mx = x + Math.cos(ang) * r + wob, my = y + Math.sin(ang) * r * 0.6;
        const [sx, sy] = cam.toScreen(mx, my);
        if (z < 6) { const s = z < 2 ? 1 : Math.max(2, Math.round(z / 2)); out.push({ x: mx, y: my, f: () => { ctx.fillStyle = ANIMAL_DOT[sp]; ctx.fillRect(Math.round(sx), Math.round(sy), s, s); } }); continue; }
        const moving = state > 0.5;
        const f = moving ? 2 + (Math.floor((now + m * 97) / (state > 1.5 ? 90 : 160)) % (state > 1.5 ? 4 : 2)) : (Math.floor((now / 900) + m * 0.37) % 4 === 0 ? 1 : 0);
        const spr = animalSprite(sp, state > 1.5 ? 4 + (f % 2) : f, winter);
        const k2 = z / 8 * CREATURE_SCALE, w = spr.width * k2, h = spr.height * k2;
        const facing = Math.cos(heading) >= 0 ? 1 : -1;
        out.push({ x: mx, y: my, f: () => { ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); if (facing < 0) ctx.scale(-1, 1); ctx.drawImage(spr, Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h)); ctx.restore(); } });
      }
    }
  }

  /* ---------- weather and light ---------- */
  private makeClouds(): void {
    const n = Math.round(this.world.w * this.world.h / 60000);
    for (let i = 0; i < n; i++) {
      const s = 0.5 + Math.pow(hash2(i, 1, this.world.seed), 2) * 2.2;
      const sprite = cloudSprite(Math.round(12 + s * 16), Math.round(6 + s * 6), i);
      const shadow = document.createElement("canvas"); shadow.width = sprite.width; shadow.height = sprite.height;
      const sc = shadow.getContext("2d")!; sc.drawImage(sprite, 0, 0); sc.globalCompositeOperation = "source-in"; sc.fillStyle = "#0b0e18"; sc.fillRect(0, 0, shadow.width, shadow.height);
      this.clouds.push({ x: hash2(i, 2, this.world.seed) * this.world.w, y: hash2(i, 3, this.world.seed) * this.world.h, s, v: 0.6 + hash2(i, 4, 9) * 0.6, sprite, shadow });
    }
  }
  private drawClouds(z: number): void {
    const alpha = z < 2 ? 0.85 : z < 6 ? 0.85 * (1 - (z - 2) / 4) : 0;
    if (alpha <= 0.02) return;
    const { ctx, cam } = this, W = this.world.w, t = this.gameTime;
    const unit = 2;   /* one cloud pixel covers 2x2 tiles */
    for (const c of this.clouds) {
      const lat = Math.abs(c.y / this.world.h - 0.5) * 2, dir = lat < 0.33 || lat > 0.66 ? -1 : 1;
      let x = (c.x + dir * t * 0.05 * c.v) % W; if (x < 0) x += W;
      const w = c.sprite.width * unit, h = c.sprite.height * unit;
      for (const xx of [x, x - W]) {
        const [sx, sy] = cam.toScreen(xx, c.y);
        if (sx > cam.vw || sx + w * z < 0 || sy > cam.vh || sy + h * z < 0) continue;
        ctx.globalAlpha = alpha * 0.22;
        const off = 6 * z;
        ctx.drawImage(c.shadow, Math.round(sx + off), Math.round(sy + off * 1.6), Math.round(w * z), Math.round(h * z));
        ctx.globalAlpha = alpha;
        ctx.drawImage(c.sprite, Math.round(sx), Math.round(sy), Math.round(w * z), Math.round(h * z));
      }
    }
    ctx.globalAlpha = 1;
  }
  /** Daylight 0..1 (the same curve the simulation uses). */
  sun(): number { const d = (this.gameTime / DAY_SECONDS) % 1; return d < 0.22 || d > 0.85 ? 0 : d < 0.32 ? (d - 0.22) / 0.1 : d > 0.72 ? 1 - (d - 0.72) / 0.13 : 1; }
  private drawDayNight(z: number): void {
    const day = (this.gameTime / DAY_SECONDS) % 1;
    /* 0 = midnight. Light rises from 0.22, full by 0.32, fades from 0.72, dark by 0.85 */
    const sun = day < 0.22 || day > 0.85 ? 0 : day < 0.32 ? (day - 0.22) / 0.1 : day > 0.72 ? 1 - (day - 0.72) / 0.13 : 1;
    if (sun >= 0.999) return;
    /* moonlit blue at night (still readable), a warm glow through dawn and dusk */
    const night = (1 - sun) * (z < 2 ? 0.4 : 0.8), warm = sun > 0 && sun < 1 ? Math.sin(sun * Math.PI) * 0.7 : 0;
    const ch = (n: number, d: number) => (255 + (n - 255) * night) * (1 + (d / 255 - 1) * warm);
    const r = ch(112, 255), g = ch(126, 196), b = ch(184, 152);
    const { ctx } = this; ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`; ctx.fillRect(0, 0, this.cam.vw, this.cam.vh); ctx.globalCompositeOperation = "source-over";
  }
}

/** Puffy pixel cloud: union of blobs, bright top edge, cool shaded belly. */
function cloudSprite(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d")!;
  const blobs: [number, number, number][] = [];
  const n = 4 + Math.floor(hash2(seed, 1, 5) * 3);
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; blobs.push([w * (0.12 + t * 0.76), h * (0.55 - Math.sin(t * Math.PI) * 0.18 + (hash2(i, seed, 2) - 0.5) * 0.1), h * (0.28 + Math.sin(t * Math.PI) * 0.24)]); }
  const inside = (px: number, py: number) => blobs.some(([bx, by, r]) => Math.hypot(px - bx, (py - by) * 1.3) < r);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    if (!inside(px, py)) continue;
    const top = !inside(px, py - 1), bottom = !inside(px, py + 2);
    x.fillStyle = bottom ? "#cfd8e2" : top ? "#ffffff" : FN.cloud; x.fillRect(px, py, 1, 1);
  }
  return c;
}
