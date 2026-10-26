import type { Camera } from "./camera.ts";
import { Anim, PERSON_STRIDE, PFlag, type CampSnap, type Look } from "../shared/people.ts";
import { personSprite, tinySprite, animFrame, drawBubble, type View } from "./sprites/people.ts";
import { fireSprite, shelterSprite, storeSprite, woodpileSprite, shelterVariant } from "./sprites/camp.ts";
import { isSnowy } from "../shared/seasonfx.ts";
import type { Season, WorldData } from "../shared/types.ts";

/*
  Drawing people and their camps. Positions arrive ten times a second and are blended
  between, so walking is smooth. Up close everyone is a full sprite, posed for what they
  are doing, sorted back to front with the shelters and fires of their camp; further out
  they shrink to tiny figures, then to specks in their band's color. At night the
  campfires glow through the dark.
*/

export interface PeopleSnap { n: number; data: Float32Array; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; age: number; c: string; g: number; }
const SIDE_ONLY = new Set<number>([Anim.Fish, Anim.Throw, Anim.Chop, Anim.Dig, Anim.Butcher, Anim.Gather, Anim.Drink]);

export class PeopleLayer {
  looks = new Map<number, Look>();
  cur: PeopleSnap | null = null;
  prev: PeopleSnap | null = null;
  at = 0;
  camps: CampSnap[] = [];
  selected = 0;
  selectedBand = 0;
  /** interpolated position of everyone drawn this frame */
  pos = new Map<number, [number, number]>();
  private facing = new Map<number, number>();
  private parts: Particle[] = [];
  private lastFrame = 0;
  readonly world: WorldData;
  constructor(world: WorldData) { this.world = world; }

  setTick(people: Float32Array, n: number, camps: CampSnap[], looks: Look[], now: number): void {
    this.prev = this.cur; this.cur = { n, data: people }; this.at = now; this.camps = camps;
    for (const l of looks) this.looks.set(l.id, l);
  }
  forget(ids: Set<number>): void { for (const id of this.looks.keys()) if (!ids.has(id)) this.looks.delete(id); }

  /** Everyone and every camp, drawn in one back-to-front pass. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, now: number, season: Season): void {
    const cur = this.cur; if (!cur) return;
    const z = cam.z, v = cam.visible(), a = Math.min(1, (now - this.at) / 100);
    const dtReal = Math.min(0.1, (now - this.lastFrame) / 1000); this.lastFrame = now;
    const prevAt = new Map<number, number>();
    if (this.prev) for (let k = 0; k < this.prev.n; k++) prevAt.set(this.prev.data[k * PERSON_STRIDE], k);
    this.pos.clear();
    const items: { y: number; f: () => void }[] = [];
    const margin = 4;
    /* camps: first the trampled earth around the fire, under everything else */
    if (z >= 4) for (const c of this.camps) {
      if (c.x < v.x0 - 8 || c.x > v.x1 + 8 || c.y < v.y0 - 8 || c.y > v.y1 + 8) continue;
      this.ground(ctx, cam, c);
    }
    for (const c of this.camps) {
      if (c.x < v.x0 - 8 || c.x > v.x1 + 8 || c.y < v.y0 - 8 || c.y > v.y1 + 8) continue;
      if (z >= 4) {
        const i = (c.y | 0) * this.world.w + (c.x | 0), snow = isSnowy(this.world.temp[i] / 255, this.world.biome[i], season, 0.5);
        for (let k = 0; k < c.shelters.length; k += 2) {
          const hx = c.shelters[k], hy = c.shelters[k + 1];
          items.push({ y: hy - 0.3, f: () => this.stamp(ctx, cam, shelterSprite(c.shelter, shelterVariant(hx, hy), snow), hx, hy, z / 8, 1) });
        }
        items.push({ y: c.y, f: () => this.stamp(ctx, cam, fireSprite(Math.floor(now / 110 + c.id), c.fire), c.x, c.y + 0.35, z / 8, 1) });
        if (c.food > 0) items.push({ y: c.y - 0.6, f: () => this.stamp(ctx, cam, storeSprite(c.food * 0.6, c.food * 0.4), c.x + 1.6, c.y - 0.6, z / 8, 1) });
        items.push({ y: c.y - 0.9, f: () => this.stamp(ctx, cam, woodpileSprite(3), c.x - 1.6, c.y - 0.8, z / 8, 1) });
        if (z >= 8 && c.fire > 0.05 && Math.random() < dtReal * 6) this.parts.push({ x: c.x + (Math.random() - 0.5) * 0.3, y: c.y - 0.4, vx: (Math.random() - 0.5) * 0.3, vy: -0.9 - Math.random() * 0.6, life: 1.6, age: 0, c: Math.random() < 0.25 ? "#ffdf7e" : "#d9d8d0", g: 0 });
      }
    }
    /* people */
    for (let k = 0; k < cur.n; k++) {
      const o = k * PERSON_STRIDE, id = cur.data[o], carrier = cur.data[o + 8];
      let x = cur.data[o + 1], y = cur.data[o + 2];
      const pk = prevAt.get(id);
      if (pk !== undefined && this.prev) { const po = pk * PERSON_STRIDE; const px = this.prev.data[po + 1], py = this.prev.data[po + 2]; if (Math.hypot(x - px, y - py) < 6) { x = px + (x - px) * a; y = py + (y - py) * a; } }
      this.pos.set(id, [x, y]);
      if (carrier) continue;
      if (x < v.x0 - margin || x > v.x1 + margin || y < v.y0 - margin || y > v.y1 + margin + 2) continue;
      const l = this.looks.get(id); if (!l) continue;
      const dir = cur.data[o + 3], anim = cur.data[o + 4], flags = cur.data[o + 5], bubble = cur.data[o + 6];
      if (dir === 1) this.facing.set(id, 1); else if (dir === 3) this.facing.set(id, -1);
      if (z < 2) continue;
      items.push({ y, f: () => this.drawPerson(ctx, cam, l, id, x, y, dir, anim, flags, bubble, now, dtReal) });
    }
    items.sort((p, q) => p.y - q.y);
    for (const it of items) it.f();
    if (z < 2) this.drawSpecks(ctx, cam);
    this.drawParticles(ctx, cam, dtReal, z);
  }

  /** Bare, trodden earth around a camp: a soft-edged oval of dirt with scuffs, under the shelters. Built once per layout. */
  private groundCache = new Map<number, { key: string; c: HTMLCanvasElement; r: number }>();
  private ground(ctx: CanvasRenderingContext2D, cam: Camera, c: CampSnap): void {
    const key = `${c.x},${c.y},${c.shelters.length}`;
    let g = this.groundCache.get(c.id);
    if (!g || g.key !== key) {
      let r = 2.4; for (let k = 0; k < c.shelters.length; k += 2) r = Math.max(r, Math.hypot(c.shelters[k] - c.x, (c.shelters[k + 1] - c.y) / 0.8) + 1.2);
      const W = Math.ceil(r * 16) + 2, H = Math.ceil(r * 0.8 * 16) + 2, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const x = cv.getContext("2d")!;
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const dx = (px - W / 2) / 8, dy = (py - H / 2) / 8, d = Math.hypot(dx / r, dy / (r * 0.8));
        if (d > 1) continue;
        const n = Math.sin((c.x + dx) * 7.1 + (c.y + dy) * 3.3) * 0.5 + 0.5;
        if (d > 0.82 && n > (1 - d) * 5) continue;
        x.fillStyle = n > 0.82 ? "rgba(70,50,30,.30)" : n < 0.1 ? "rgba(230,210,170,.14)" : "rgba(120,88,52,.22)";
        x.fillRect(px, py, 1, 1);
      }
      g = { key, c: cv, r }; this.groundCache.set(c.id, g);
    }
    const [sx, sy] = cam.toScreen(c.x, c.y + 0.3), k = cam.z / 8;
    ctx.drawImage(g.c, Math.round(sx - g.c.width * k / 2), Math.round(sy - g.c.height * k / 2), Math.round(g.c.width * k), Math.round(g.c.height * k));
  }

  private stamp(ctx: CanvasRenderingContext2D, cam: Camera, c: HTMLCanvasElement, x: number, y: number, k: number, foot: number): void {
    const [sx, sy] = cam.toScreen(x, y), w = c.width * k, h = c.height * k;
    ctx.drawImage(c, Math.round(sx - w / 2), Math.round(sy - h + foot * k), Math.round(w), Math.round(h));
  }

  private drawPerson(ctx: CanvasRenderingContext2D, cam: Camera, l: Look, id: number, x: number, y: number, dir: number, anim: number, flags: number, bubble: number, now: number, dt: number): void {
    const z = cam.z, [sx, sy] = cam.toScreen(x, y);
    const phase = (id * 97) % 1000;
    const moving = anim === Anim.Walk || anim === Anim.Run || anim === Anim.Carry || anim === Anim.CaneWalk || anim === Anim.Play;
    if (z < 8) {
      const size = z < 4 ? "s" : "m", f = moving ? Math.floor((now + phase) / 180) : 0, c = tinySprite(l, size, f), k = z < 4 ? 1 : Math.floor(z / 4);
      const flip = (this.facing.get(id) ?? 1) < 0;
      ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); if (flip) ctx.scale(-1, 1);
      ctx.fillStyle = "rgba(12,14,24,0.22)"; ctx.fillRect(Math.round(-c.width * k / 2), 0, Math.round(c.width * k), Math.max(1, k));
      ctx.drawImage(c, Math.round(-c.width * k / 2), Math.round(-c.height * k), c.width * k, c.height * k);
      ctx.restore();
      if (id === this.selected) this.marker(ctx, sx, sy - c.height * k - 3, now, 1);
      return;
    }
    const lying = anim === Anim.Sleep || anim === Anim.Sick;
    let view: View = dir === 0 ? "front" : dir === 2 ? "back" : "side";
    let flip = dir === 3;
    if (SIDE_ONLY.has(anim) && view !== "side") { view = "side"; flip = (this.facing.get(id) ?? 1) < 0; }
    if ((anim === Anim.Sit || anim === Anim.HoldBaby || anim === Anim.Sew || anim === Anim.Knap || anim === Anim.Eat || anim === Anim.Cook || anim === Anim.Talk) && view === "back") view = "front";
    const frame = animFrame(anim, now, phase);
    const load = flags & PFlag.Meat ? 2 : 1;
    const d = personSprite(l, anim, frame, view, flags, load);
    const k = z / 8, w = d.c.width * k, h = d.c.height * k;
    /* soft ground shadow, away from the northwest light */
    ctx.fillStyle = "rgba(12,14,24,0.24)";
    const shw = lying ? w * 0.8 : 6 * k;
    ctx.fillRect(Math.round(sx - shw / 2 + k), Math.round(sy - k), Math.round(shw), Math.max(1, Math.round(1.6 * k)));
    ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); if (flip) ctx.scale(-1, 1);
    const footY = lying ? h - 2 * k : h - 2 * k;
    ctx.drawImage(d.c, Math.round(-w / 2), Math.round(-footY), Math.round(w), Math.round(h));
    ctx.restore();
    const head = sy - (lying ? 6 : l.stage === "toddler" || l.stage === "child" ? 12 : 17) * k;
    /* the fishing line to the water, with a bobbing float */
    if (anim === Anim.Fish && d.tip) {
      const tx = sx + (flip ? -1 : 1) * (d.tip[0] - d.c.width / 2) * k, ty = sy - footY + d.tip[1] * k;
      const fx = tx + (flip ? -1 : 1) * 7 * k, fy = sy + (Math.sin((now + phase) / 380) > 0.6 ? 1.5 : 0.5) * k;
      ctx.strokeStyle = "rgba(240,236,224,.8)"; ctx.lineWidth = Math.max(1, k * 0.6); ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = "#a5503c"; ctx.fillRect(Math.round(fx), Math.round(fy), Math.max(1, Math.round(k)), Math.max(1, Math.round(k)));
    }
    /* chips, dust and sparks at the moment of impact */
    if (d.hit && frame === 2 && Math.random() < dt * 14) {
      const hx = x + (flip ? -1 : 1) * (d.hit[0] - d.c.width / 2) / 8, hy = y - (d.c.height - 2 - d.hit[1]) / 8;
      const col = anim === Anim.Chop ? ["#a8805a", "#dcc085"] : anim === Anim.Knap ? ["#f2efe6", "#aaa79d"] : anim === Anim.Butcher ? ["#a8433a", "#cf6a52"] : ["#ad8562", "#93694a"];
      for (let i = 0; i < 3; i++) this.parts.push({ x: hx, y: hy, vx: (Math.random() - 0.5) * 2.2, vy: -1.5 - Math.random() * 1.5, life: 0.5, age: 0, c: col[i % 2], g: 7 });
    }
    if (anim === Anim.Run && Math.random() < dt * 5) this.parts.push({ x: x - (flip ? -1 : 1) * 0.3, y, vx: (Math.random() - 0.5) * 0.6, vy: -0.4, life: 0.5, age: 0, c: "#c9b48c", g: 0 });
    if (bubble) drawBubble(ctx, sx, head - 2 * k, bubble, Math.max(1, k));
    if (anim === Anim.Sleep && z >= 12 && Math.floor((now + phase) / 1600) % 3 === 0) this.zzz(ctx, sx + 3 * k, head - 3 * k, now + phase, k);
    if (id === this.selected) this.marker(ctx, sx, head - (bubble ? 12 : 3) * k, now, k);
  }

  private zzz(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, k: number): void {
    const u = Math.max(1, Math.round(k * 0.75)), q = Math.floor(t / 400) % 3;
    ctx.fillStyle = "rgba(244,244,248,.85)";
    const z = (zx: number, zy: number) => { ctx.fillRect(zx, zy, 3 * u, u); ctx.fillRect(zx + u, zy + u, u, u); ctx.fillRect(zx, zy + 2 * u, 3 * u, u); };
    z(Math.round(x + q * u), Math.round(y - q * 2 * u));
  }
  /** A bouncing pointer over the person the tag is pinned to. */
  private marker(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, k: number): void {
    const u = Math.max(1, Math.round(k * 0.8)), b = Math.round(Math.sin(now / 180) * 1.5 * u);
    const X = Math.round(x), Y = Math.round(y) + b;
    ctx.fillStyle = "#2b2418"; ctx.fillRect(X - 3 * u, Y - 4 * u, 7 * u, u); ctx.fillRect(X - 2 * u, Y - 3 * u, 5 * u, u); ctx.fillRect(X - u, Y - 2 * u, 3 * u, u); ctx.fillRect(X, Y - u, u, u);
    ctx.fillStyle = "#f6d77a"; ctx.fillRect(X - 2 * u, Y - 4 * u, 5 * u, u); ctx.fillRect(X - u, Y - 3 * u, 3 * u, u); ctx.fillRect(X, Y - 2 * u, u, u);
  }

  /** At the world view, people are specks in their band's color. */
  private drawSpecks(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const z = cam.z, s = z < 1 ? 1 : 2, colors = new Map<number, string>();
    for (const c of this.camps) colors.set(c.id, c.color);
    for (const [id, [x, y]] of this.pos) {
      const l = this.looks.get(id); if (!l) continue;
      const [sx, sy] = cam.toScreen(x, y);
      if (sx < -2 || sy < -2 || sx > cam.vw + 2 || sy > cam.vh + 2) continue;
      ctx.fillStyle = id === this.selected ? "#fff4b0" : colors.get(l.band) ?? "#f2e6c8";
      ctx.fillRect(Math.round(sx), Math.round(sy), s, s);
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, cam: Camera, dt: number, z: number): void {
    if (z < 8) { this.parts.length = 0; return; }
    const u = Math.max(1, Math.round(z / 8));
    for (const p of this.parts) {
      p.age += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const [sx, sy] = cam.toScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life) * (p.g ? 1 : 0.6);
      ctx.fillStyle = p.c; ctx.fillRect(Math.round(sx), Math.round(sy), u, u);
    }
    ctx.globalAlpha = 1;
    this.parts = this.parts.filter(p => p.age < p.life).slice(-400);
  }

  /** After dark the fires show: a warm pool of light around every lit camp, drawn over the night tint. */
  drawGlow(ctx: CanvasRenderingContext2D, cam: Camera, now: number, sun: number): void {
    const night = 1 - sun; if (night < 0.05) return;
    const z = cam.z, v = cam.visible();
    ctx.globalCompositeOperation = "lighter";
    for (const c of this.camps) {
      if (c.fire <= 0.03 || c.x < v.x0 - 10 || c.x > v.x1 + 10 || c.y < v.y0 - 10 || c.y > v.y1 + 10) continue;
      const [sx, sy] = cam.toScreen(c.x, c.y);
      const flick = 0.9 + 0.1 * Math.sin(now / 90 + c.id) + 0.05 * Math.sin(now / 37 + c.id * 3);
      const r = Math.max(4, 4.5 * z) * (0.6 + 0.4 * Math.min(1, c.fire * 2)) * flick;
      const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      const al = 0.55 * night * Math.min(1, 0.4 + c.fire);
      gr.addColorStop(0, `rgba(255,190,90,${al.toFixed(3)})`); gr.addColorStop(0.35, `rgba(240,120,40,${(al * 0.45).toFixed(3)})`); gr.addColorStop(1, "rgba(200,80,20,0)");
      ctx.fillStyle = gr; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      if (z < 4) { ctx.fillStyle = `rgba(255,230,160,${(0.9 * night).toFixed(3)})`; ctx.fillRect(Math.round(sx), Math.round(sy), z < 1.5 ? 1 : 2, z < 1.5 ? 1 : 2); }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** Band names over their camps when zoomed out, like a map's labels. */
  drawLabels(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number): void {
    const z = cam.z; if (z >= 6) return;
    const fs = Math.round((z < 1.2 ? 11 : 12) * dpr);
    ctx.font = `600 ${fs}px "Pixelify Sans", "Silkscreen", monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const placed: [number, number, number, number][] = [];
    for (const c of this.camps.slice().sort((a, d) => d.pop - a.pop)) {
      const [sx, sy] = cam.toScreen(c.x, c.y);
      if (sx < -80 || sy < -20 || sx > cam.vw + 80 || sy > cam.vh + 40) continue;
      const label = z >= 1.5 ? `${c.name} · ${c.pop}` : c.name;
      const w = ctx.measureText(label).width, pad = 4 * dpr;
      /* lift a label that would cover a bigger band's, so neighbors stay readable */
      let ty = Math.round(sy - (z < 2 ? 6 : 10 + z * 2) * dpr);
      for (let tries = 0; tries < 4; tries++) {
        const L = sx - w / 2 - pad, R = sx + w / 2 + pad, T = ty - fs - 4 * dpr, B = ty;
        if (!placed.some(([a, b, c2, d]) => L < c2 && R > a && T < d && B > b)) break;
        ty -= fs + 6 * dpr;
      }
      placed.push([sx - w / 2 - pad, ty - fs - 4 * dpr, sx + w / 2 + pad, ty]);
      /* pennant on a pole, then a paper tag with the name */
      ctx.fillStyle = "#2b2418"; ctx.fillRect(Math.round(sx), ty, Math.max(1, dpr), Math.round(7 * dpr));
      ctx.fillStyle = c.color; ctx.fillRect(Math.round(sx + dpr), ty, Math.round(5 * dpr), Math.round(3 * dpr));
      const bx = Math.round(sx - w / 2 - pad), by = Math.round(ty - fs - 3 * dpr), bw = Math.round(w + pad * 2), bh = Math.round(fs + 3 * dpr);
      ctx.fillStyle = c.id === this.selectedBand ? "#fff4b0" : "rgba(242,230,200,.92)"; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "#2b2418"; ctx.fillRect(bx, by + bh, bw, Math.max(1, dpr)); ctx.fillRect(bx, by - Math.max(1, dpr), bw, Math.max(1, dpr)); ctx.fillRect(bx - Math.max(1, dpr), by, Math.max(1, dpr), bh); ctx.fillRect(bx + bw, by, Math.max(1, dpr), bh);
      ctx.fillStyle = c.color; ctx.fillRect(bx, by, Math.round(2 * dpr), bh);
      ctx.fillStyle = "#2b2418"; ctx.fillText(label, Math.round(sx + dpr), Math.round(by + bh - 1.5 * dpr));
    }
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }

  /** Who or what is under a point: the nearest person within reach, else a camp. */
  pick(wx: number, wy: number, z: number): { person: number; band: number } {
    let best = 0, bd = z >= 8 ? 1.1 : Math.max(1, 6 / z);
    for (const [id, [x, y]] of this.pos) {
      const l = this.looks.get(id); if (!l) continue;
      const cy = z >= 8 ? y - 0.9 : y - 0.4, d = Math.hypot(x - wx, cy - wy);
      if (d < bd) { bd = d; best = id; }
    }
    if (best) return { person: best, band: 0 };
    let band = 0, bb = Math.max(3, 10 / z);
    for (const c of this.camps) { const d = Math.hypot(c.x - wx, c.y - wy); if (d < bb) { bb = d; band = c.id; } }
    return { person: 0, band };
  }
}
