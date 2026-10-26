import { Rng } from "../../shared/rng.ts";
import { fbm, ridged, sampleField, blur } from "../../shared/noise.ts";

/*
  Continents come from tectonic plates. Each plate is continental or oceanic and drifts in
  its own direction. Where plates collide, the crust buckles into long mountain chains;
  where they pull apart, rifts and mid-ocean ridges form. Fractal noise, warped so it never
  looks like a grid, adds coastlines, hills and islands on top.
*/

export interface Plate { x: number; y: number; continental: boolean; vx: number; vy: number; core: number; owner: number; }

export function makePlates(n: number, seed: number, aspect: number): Plate[] {
  const r = new Rng(seed * 31 + 7), plates: Plate[] = [];
  /* jittered grid so plates are spread out, sized to the map's aspect */
  const cols = Math.max(2, Math.round(Math.sqrt(n * aspect))), rows = Math.max(2, Math.ceil(n / cols));
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols && plates.length < n; i++) {
    const a = r.range(0, Math.PI * 2), sp = r.range(0.3, 1);
    plates.push({ x: (i + r.range(0.15, 0.85)) / cols, y: (j + r.range(0.15, 0.85)) / rows, continental: false, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, core: 0, owner: -1 });
  }
  /* continents grow around a few well-separated cores, so the map gets several landmasses
     with oceans between them; a stray plate or two becomes a microcontinent */
  const cores: { x: number; y: number }[] = [];
  const nCores = Math.max(3, Math.round(n / 7));
  for (let tries = 0; cores.length < nCores && tries < 400; tries++) {
    const c = { x: r.range(0.14, 0.86), y: r.range(0.3, 0.7) };
    if (cores.every(o => Math.hypot((o.x - c.x) * aspect, o.y - c.y) > 0.5 * Math.sqrt(aspect))) cores.push(c);
  }
  for (const p of plates) {
    let bd = Infinity;
    cores.forEach((c, k) => { const d = Math.hypot((c.x - p.x) * aspect, c.y - p.y) * r.range(0.85, 1.2); if (d < bd) { bd = d; p.owner = k; } });
    p.core = bd;
  }
  cores.forEach((c, k) => { let best = plates[0], bd = Infinity; for (const p of plates) { const d = Math.hypot((c.x - p.x) * aspect, c.y - p.y); if (d < bd) { bd = d; best = p; } } best.continental = true; best.owner = k; });
  /* now and then a lone plate far from any core becomes a microcontinent */
  for (const p of plates) if (!p.continental && r.chance(0.05)) { p.continental = true; p.owner = -1; }
  return plates;
}

/*
  Each continent grows outward from its core, plate by plate, until together they cover a
  little less of the map than will end up above the sea. A plate is never added if it would
  weld two continents together, so oceans stay between them. The coast then follows the
  edge of the crust, and noise carves it into peninsulas, bays and offshore islands.
*/
const CRUST_SHARE = 0.31;
function growContinents(plates: Plate[], id: Int16Array, lw: number, seed: number): void {
  const n = plates.length, area = new Float64Array(n), adj: Set<number>[] = plates.map(() => new Set<number>());
  for (let i = 0; i < id.length; i++) { area[id[i]]++; const x = i % lw; if (x < lw - 1 && id[i + 1] !== id[i]) { adj[id[i]].add(id[i + 1]); adj[id[i + 1]].add(id[i]); } if (i + lw < id.length && id[i + lw] !== id[i]) { adj[id[i]].add(id[i + lw]); adj[id[i + lw]].add(id[i]); } }
  const r = new Rng(seed * 7 + 5), owners = new Set(plates.filter(p => p.owner >= 0 && p.continental).map(p => p.owner));
  const want = new Map<number, number>(); let wsum = 0;
  for (const o of owners) { const v = r.range(0.55, 1.5); want.set(o, v); wsum += v; }
  const have = new Map<number, number>(); plates.forEach((p, k) => { if (p.continental && p.owner >= 0) have.set(p.owner, (have.get(p.owner) ?? 0) + area[k]); });
  for (const o of owners) want.set(o, want.get(o)! / wsum * CRUST_SHARE * id.length);
  for (let grew = true; grew;) {
    grew = false;
    for (const o of owners) {
      if ((have.get(o) ?? 0) >= want.get(o)!) continue;
      let best = -1;
      for (let k = 0; k < n; k++) {
        const p = plates[k]; if (p.continental || p.owner !== o) continue;
        let touchesOwn = false, touchesOther = false;
        for (const j of adj[k]) { const q = plates[j]; if (!q.continental) continue; if (q.owner === o) touchesOwn = true; else if (q.owner >= 0) touchesOther = true; }
        if (touchesOwn && !touchesOther && (best < 0 || p.core < plates[best].core)) best = k;
      }
      if (best >= 0 && (have.get(o) ?? 0) + area[best] * 0.5 < want.get(o)!) { plates[best].continental = true; have.set(o, (have.get(o) ?? 0) + area[best]); grew = true; }
    }
  }
}

/** Low-resolution plate maps: continental crust (0..1) and tectonic uplift (-1..1). */
export function plateFields(plates: Plate[], lw: number, lh: number, seed: number, aspect: number) {
  const id = new Int16Array(lw * lh), cont = new Float32Array(lw * lh), up = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const u = x / lw, v = y / lh;
    /* warp the lookup so plate borders wander */
    const wu = u + (fbm(u * 4, v * 4, seed + 11, 4) - 0.5) * 0.22, wv = v + (fbm(u * 4 + 9, v * 4, seed + 12, 4) - 0.5) * 0.22;
    let best = 0, bd = Infinity;
    for (let p = 0; p < plates.length; p++) { const dx = (wu - plates[p].x) * aspect, dy = wv - plates[p].y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = p; } }
    id[y * lw + x] = best;
  }
  growContinents(plates, id, lw, seed);
  for (let i = 0; i < id.length; i++) cont[i] = plates[id[i]].continental ? 1 : 0;
  /* boundary cells: how hard the two plates press together (or pull apart) */
  const bnd = new Float32Array(lw * lh), dist = new Float32Array(lw * lh).fill(1e9), src = new Float32Array(lw * lh);
  const q: number[] = [];
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const i = y * lw + x, a = plates[id[i]]; let u = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= lw || yy >= lh) continue;
      const j = yy * lw + xx; if (id[j] === id[i]) continue;
      const b = plates[id[j]];
      const closing = (a.vx - b.vx) * dx + (a.vy - b.vy) * dy;   /* > 0: plates move toward each other */
      let k: number;
      if (closing > 0) k = a.continental && b.continental ? 1.0 : a.continental ? 0.9 : b.continental ? -0.4 : 0.35;
      else k = a.continental ? -0.3 : 0.15;
      const v = closing > 0 ? k * (0.35 + closing) : k * Math.min(0.6, -closing);
      if (Math.abs(v) > Math.abs(u)) u = v;
    }
    if (u !== 0) { bnd[i] = u; dist[i] = 0; src[i] = u; q.push(i); }
  }
  /* spread outward a few cells so each range has a crest that falls away on both sides */
  for (let h0 = 0; h0 < q.length; h0++) { const i = q[h0], x = i % lw, y = (i / lw) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= lw || yy >= lh) continue; const j = yy * lw + xx;
      if (dist[j] > dist[i] + 1 && dist[i] < 6) { dist[j] = dist[i] + 1; src[j] = src[i]; q.push(j); } } }
  for (let i = 0; i < lw * lh; i++) { const d = dist[i]; const s0 = src[i]; up[i] = d > 5 ? 0 : s0 > 0 ? s0 * Math.pow(1 - d / 5.5, 2) : s0 * Math.max(0, 1 - d / 3); }
  blur(cont, lw, lh, Math.max(3, lw >> 5), 3);   /* a wide continental margin, so noise has room to shape the coast */
  blur(up, lw, lh, 1, 1);
  return { cont, up };
}

const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

/** Full-resolution raw elevation (arbitrary units; sea level chosen afterwards). */
export function rawElevation(w: number, h: number, seed: number, plates: Plate[], progress: (p: number) => void): Float32Array {
  const aspect = w / h, lw = Math.max(64, w >> 3), lh = Math.max(32, h >> 3);
  const { cont, up } = plateFields(plates, lw, lh, seed, aspect);
  const e = new Float32Array(w * h);
  const S = h;  /* noise frequencies are relative to map height so every size has the same shapes, just more detail */
  for (let y = 0; y < h; y++) {
    if ((y & 63) === 0) progress(y / h);
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const qx = x / S, qy = y / S;
      const wx = (fbm(qx * 3, qy * 3, seed + 21, 4) - 0.5) * 0.09, wy = (fbm(qx * 3 + 5.2, qy * 3 + 1.3, seed + 22, 4) - 0.5) * 0.09;
      /* crust thins toward the map's east and west edges and the poles, so coasts there are
         shaped by noise like everywhere else instead of being cut off in a straight line */
      const jig = (fbm(qx * 5, qy * 5, seed + 61, 3) - 0.5) * 0.1;
      const ex = Math.min(u, 1 - u) * aspect + jig, ey = Math.min(v, 1 - v) + jig;
      const fade = smooth((ex - 0.04) / 0.26) * smooth((ey - 0.02) / 0.12);
      const c = sampleField(cont, lw, lh, u + wx / aspect, v + wy) * fade;
      const upl = sampleField(up, lw, lh, u + wx * 0.6 / aspect, v + wy * 0.6);
      const wx2 = (fbm(qx * 18, qy * 18, seed + 23, 3) - 0.5) * 0.025, wy2 = (fbm(qx * 18 + 3.3, qy * 18, seed + 24, 3) - 0.5) * 0.025;
      const coast = fbm((qx + wx + wx2) * 9, (qy + wy + wy2) * 9, seed + 31, 8, 2.1, 0.53) - 0.5;
      const hills = fbm(qx * 26, qy * 26, seed + 41, 5) - 0.5;
      let el = (c - 0.5) * 1.0 + coast * 0.85 + hills * 0.12;
      if (upl > 0) { const r = ridged((qx + wx * 0.5) * 22, (qy + wy * 0.5) * 22, seed + 51, 6); el += upl * (0.25 + 1.25 * r) * 1.05; }
      else el += upl * 0.45;
      /* old ranges, worn down long ago, wander across the continental interiors */
      const belt = fbm(qx * 2.6 + 7.1, qy * 2.6, seed + 71, 3);
      if (belt > 0.56 && c > 0.3) el += (belt - 0.56) / 0.44 * Math.min(1, (c - 0.3) * 2) * ridged((qx + wx) * 16, (qy + wy) * 16, seed + 73, 5) * 0.55;
      /* keep the map edges at sea */
      if (ex < 0.1) el -= (0.1 - ex) ** 2 * 80;
      if (ey < 0.2) el -= (0.2 - ey) ** 2 * 34;   /* little land in the polar seas */
      e[y * w + x] = el;
    }
  }
  return e;
}

/** Choose sea level for a target land share, then normalize: ocean -1..0, land 0..1. */
export function normalizeElevation(e: Float32Array, landShare: number): number {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < e.length; i += 3) { const v = e[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const bins = 4096, hist = new Uint32Array(bins), span = mx - mn || 1; let n = 0;
  for (let i = 0; i < e.length; i += 3) { hist[Math.min(bins - 1, Math.floor((e[i] - mn) / span * bins))]++; n++; }
  let acc = 0, b = bins - 1; while (b > 0 && acc < n * landShare) { acc += hist[b]; b--; }
  const sea = mn + (b / bins) * span;
  let land = 0;
  for (let i = 0; i < e.length; i++) {
    const v = e[i];
    if (v >= sea) { const t = (v - sea) / (mx - sea); e[i] = Math.pow(t, 1.35); land++; }
    else e[i] = -Math.pow((sea - v) / (sea - mn), 0.8);
  }
  return land / e.length;
}
