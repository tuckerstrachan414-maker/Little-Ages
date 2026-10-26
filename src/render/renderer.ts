import { Camera } from "./camera.ts";
import { treeSprite, treeGlyph } from "./sprites/trees.ts";
import { animalSprite, ANIMAL_DOT } from "./sprites/animals.ts";
import { textureKind, tileTexture } from "./sprites/textures.ts";
import { Biome, Flag, DAY_SECONDS, type Season, type MapMode, type WorldData } from "../shared/types.ts";
import { FN } from "../shared/palette.ts";
import { hash2 } from "../shared/rng.ts";
import { isSnowy } from "../shared/seasonfx.ts";
import { fineGround } from "./ground.ts";
import { drawBirds, drawFish, drawRabbits, type Fields, type FlockSnap } from "./life.ts";

/*
  Draw order each frame:
    1. the whole map, one pixel per tile, scaled to the zoom (cross-fading between seasons)
    2. up close: cached chunks of ground texture, then live water (foam, glints)
    3. up close: cached chunks of trees and rocks, back to front by row
    4. wildlife, clouds and their shadows, day and night
  Chunks are rebuilt lazily a few per frame, so zooming never stalls.
*/

const BUCKETS = [4, 6, 8, 12, 16, 24, 32, 48];
const CHUNK_PX = 256;

interface Chunk { ground: HTMLCanvasElement | null; objects: HTMLCanvasElement | null; surf: HTMLCanvasElement[] | null; used: number; px: number; }
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
  private clouds: { x: number; y: number; s: number; v: number; sprite: HTMLCanvasElement; shadow: HTMLCanvasElement }[] = [];

  readonly canvas: HTMLCanvasElement;
  readonly world: WorldData;
  constructor(canvas: HTMLCanvasElement, world: WorldData) {
    this.canvas = canvas; this.world = world;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.cam = new Camera(world.w, world.h);
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
    this.mips = [];
    let src = fresh;
    while (src.width > 512) { const m = document.createElement("canvas"); m.width = src.width >> 1; m.height = src.height >> 1; const c = m.getContext("2d")!; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.drawImage(src, 0, 0, m.width, m.height); this.mips.push(m); src = m; }
    if (mode !== "terrain" || changed) this.clearChunks();
  }
  private mips: HTMLCanvasElement[] = [];
  /** The smallest copy of the map that still has at least one pixel per screen pixel. */
  private mipFor(z: number): HTMLCanvasElement { let best = this.terrain; for (const m of this.mips) { if (m.width / this.world.w >= z) best = m; } return best; }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.canvas.width = Math.round(cssW * dpr); this.canvas.height = Math.round(cssH * dpr);
    this.cam.resize(this.canvas.width, this.canvas.height);
  }

  draw(now: number): void {
    const { ctx, cam } = this;
    cam.step(now);
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
    /* 2-3. close-up chunks */
    const detail = z >= 4 && this.mode === "terrain";
    if (detail && this.bucketFor(z) >= 8) this.drawChunks(now, z);   /* below sprite scale the ground is just the map itself */
    if (z >= 6 && this.mode === "terrain") this.drawWater(now, z, this.bucketFor(z) < 8);
    if (this.fields && this.mode === "terrain") { drawFish(ctx, cam, this.world, this.fields, now, this.season); drawRabbits(ctx, cam, this.world, this.fields, this.gameTime, this.season); }
    if (detail) this.drawChunks(now, z, true);
    /* 4. life and weather */
    this.drawHerds(now, z);
    const ba = Math.min(1, (now - this.herdT) / 100);
    drawBirds(ctx, cam, this.flocks, this.flocksPrev, ba, now, false);
    drawBirds(ctx, cam, this.flocks, this.flocksPrev, ba, now, true);
    if (this.hover && z >= 4) { const [hx, hy] = cam.toScreen(this.hover[0], this.hover[1]); ctx.strokeStyle = "rgba(255,240,200,.8)"; ctx.lineWidth = Math.max(1, z / 16); ctx.strokeRect(Math.round(hx) + 0.5, Math.round(hy) + 0.5, Math.round(z) - 1, Math.round(z) - 1); }
    this.drawClouds(z);
    if (this.dayNight && this.mode === "terrain") this.drawDayNight(z);
    this.evictChunks();
  }

  /* ---------- chunks ---------- */
  private bucketFor(z: number): number { let b = BUCKETS[0]; for (const v of BUCKETS) if (v <= z + 1e-6) b = v; return b; }
  private drawChunks(now: number, z: number, objects = false): void {
    const { ctx, cam } = this, T = this.bucketFor(z), CH = Math.max(8, Math.round(CHUNK_PX / T)), k = z / T;
    const v = cam.visible();
    const cx0 = Math.floor(v.x0 / CH), cy0 = Math.floor(Math.max(0, v.y0 - 1) / CH), cx1 = Math.floor((v.x1 - 1) / CH), cy1 = Math.floor(Math.min(this.world.h - 1, v.y1 + 3) / CH);
    const t0 = performance.now();
    let built = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = `${cx},${cy},${T},${this.season}`;
      let ch = this.chunks.get(key);
      /* build missing chunks a few milliseconds' worth per frame, so zooming never stalls */
      if (!ch && (!objects || T < 8) && (built === 0 || performance.now() - t0 < 7)) { ch = this.buildChunk(cx, cy, T, CH); this.chunks.set(key, ch); this.chunkPixels += ch.px; built++; }
      if (!ch) { ch = this.findStale(cx, cy, T); if (!ch) continue; }
      ch.used = now;
      const [sx, sy] = cam.toScreen(cx * CH, cy * CH);
      if (!objects) {
        if (!ch.ground) continue;
        ctx.drawImage(ch.ground, Math.round(sx), Math.round(sy), Math.ceil(CH * T * k), Math.ceil(CH * T * k));
        if (ch.surf) { const f = ch.surf[Math.floor(now / 520 + (cx * 7 + cy * 3) * 0.37) & 3]; ctx.drawImage(f, Math.round(sx), Math.round(sy), Math.ceil(f.width / 8 * T * k), Math.ceil(f.height / 8 * T * k)); }
      }
      else if (ch.objects) ctx.drawImage(ch.objects, Math.round(sx - T * k), Math.round(sy - 3 * T * k), Math.ceil(ch.objects.width * k), Math.ceil(ch.objects.height * k));
    }
  }
  private findStale(cx: number, cy: number, T: number): Chunk | undefined {
    for (let s = 0; s < 4; s++) { const c = this.chunks.get(`${cx},${cy},${T},${s}`); if (c) return c; }
    return undefined;
  }
  private buildChunk(cx: number, cy: number, T: number, CH: number): Chunk {
    const wd = this.world, x0 = cx * CH, y0 = cy * CH, cw = Math.min(CH, wd.w - x0), chh = Math.min(CH, wd.h - y0);
    const ground = T >= 8 ? document.createElement("canvas") : null;
    let objects: HTMLCanvasElement | null = null, surf: HTMLCanvasElement[] | null = null, wet: ((tx: number, ty: number) => boolean) | null = null;
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
    const o = document.createElement("canvas"); o.width = (CH + 2) * T; o.height = (CH + 4) * T;
    const oc = o.getContext("2d")!; oc.imageSmoothingEnabled = false;
    let any = false;
    const sk = T / 8;
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const wx = x0 + x, wy = y0 + y, i = wy * wd.w + wx, sp = wd.tree[i];
      if (!sp) {
        if (wd.biome[i] === Biome.Mountain && T >= 8 && hash2(wx, wy, 41) < 0.05 && !(wet && wet(x + 0.5, y + 0.8))) { any = true; this.boulder(oc, (x + 1) * T + T / 2, (y + 3) * T + T * 0.8, sk); }
        continue;
      }
      const h = hash2(wx, wy, 31);
      let jx = (h - 0.5) * 0.35, jy = (hash2(wx, wy, 32) - 0.5) * 0.25 + 0.42;
      /* the smoothed shore can swallow a tile's corner: keep the trunk on dry ground */
      if (wet && wet(x + 0.5 + jx, y + 0.5 + jy)) { jx = 0; jy = 0; if (wet(x + 0.5, y + 0.5)) continue; }
      any = true;
      const snowy = isSnowy(wd.temp[i] / 255, wd.biome[i], this.season, hash2(wx, wy, wd.seed + 5));
      const bx = (x + 1 + 0.5 + jx) * T, by = (y + 3 + 0.5 + jy) * T;
      if (T >= 8) { const spr = treeSprite(sp, this.season, Math.floor(h * 3), snowy); oc.drawImage(spr, Math.round(bx - spr.width * sk / 2), Math.round(by - spr.height * sk), Math.round(spr.width * sk), Math.round(spr.height * sk)); }
      else { const gl = treeGlyph(sp, this.season, snowy), gk = T / 4; oc.drawImage(gl, Math.round(bx - gl.width * gk / 2), Math.round(by - gl.height * gk), Math.round(gl.width * gk), Math.round(gl.height * gk)); }
    }
    if (any) objects = o;
    return { ground, objects, surf, used: performance.now(), px: (ground ? ground.width * ground.height : 0) + (objects ? o.width * o.height : 0) + (surf ? surf.length * surf[0].width * surf[0].height : 0) };
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
  private drawHerds(now: number, z: number): void {
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
      const spread = sp === 2 ? 1.6 : sp >= 4 ? 1 : 1.25;
      for (let m = 0; m < count; m++) {
        /* members keep loose formation; each wanders a little on its own */
        const r = Math.sqrt(m + 0.5) * spread * 0.9, ang = m * 2.399 + id;
        const wob = Math.sin(now / 1500 + m * 1.7 + id) * 0.25;
        const mx = x + Math.cos(ang) * r + wob, my = y + Math.sin(ang) * r * 0.6;
        const [sx, sy] = cam.toScreen(mx, my);
        if (z < 6) { const s = z < 2 ? 1 : Math.max(2, Math.round(z / 2)); ctx.fillStyle = ANIMAL_DOT[sp]; ctx.fillRect(Math.round(sx), Math.round(sy), s, s); continue; }
        const moving = state > 0.5;
        const f = moving ? 2 + (Math.floor((now + m * 97) / (state > 1.5 ? 90 : 160)) % (state > 1.5 ? 4 : 2)) : (Math.floor((now / 900) + m * 0.37) % 4 === 0 ? 1 : 0);
        const spr = animalSprite(sp, state > 1.5 ? 4 + (f % 2) : f, winter);
        const k2 = z / 8, w = spr.width * k2, h = spr.height * k2;
        const facing = Math.cos(heading) >= 0 ? 1 : -1;
        ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); if (facing < 0) ctx.scale(-1, 1);
        ctx.drawImage(spr, Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h)); ctx.restore();
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
