import { Flag } from "../../shared/types.ts";

/*
  Rivers and lakes. A priority flood starts at the sea and climbs inland, always taking the
  lowest unvisited ground next. That fills every pit up to its spill point (which is where
  lakes come from) and gives every tile a downhill neighbor, so all water finds the sea.
  Rain is then summed downstream; where enough of it gathers, a river appears, widening
  as tributaries join.
*/

const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

export function hydrology(w: number, h: number, elev: Float32Array, rain: Float32Array, flags: Uint8Array, depth: Uint8Array, progress: (p: number) => void) {
  const N = w * h, Q = 60000;
  const elevQ = new Uint16Array(N), filled = new Uint16Array(N), parent = new Int32Array(N).fill(-1);
  const visited = new Uint8Array(N);
  const head = new Int32Array(Q + 2).fill(-1), tail = new Int32Array(Q + 2).fill(-1), next = new Int32Array(N).fill(-1);
  const push = (i: number, lv: number) => { next[i] = -1; if (tail[lv] < 0) { head[lv] = tail[lv] = i; } else { next[tail[lv]] = i; tail[lv] = i; } };
  let land = 0;
  for (let i = 0; i < N; i++) { if (elev[i] >= 0) { elevQ[i] = Math.min(Q, Math.round(elev[i] * Q)); land++; } }
  /* seed with ocean tiles touching land */
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (elev[i] >= 0) continue;
    visited[i] = 1;
    for (const [dx, dy] of NB8) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; if (elev[yy * w + xx] >= 0) { push(i, 0); break; } }
  }
  const order = new Int32Array(land); let oc = 0;
  for (let lv = 0; lv <= Q; lv++) {
    while (head[lv] >= 0) {
      const cur = head[lv]; head[lv] = next[cur]; if (head[lv] < 0) tail[lv] = -1;
      const x = cur % w, y = (cur / w) | 0;
      for (const [dx, dy] of NB8) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n = yy * w + xx; if (visited[n]) continue;
        visited[n] = 1;
        const f = Math.max(elevQ[n], lv);
        filled[n] = f; parent[n] = cur; order[oc++] = n;
        push(n, f);
      }
    }
    if ((lv & 4095) === 0) progress(lv / Q * 0.4);
  }
  /* rain gathers downstream */
  const acc = new Float32Array(N);
  for (let k = 0; k < oc; k++) { const i = order[k]; acc[i] += 0.15 + rain[i]; }
  for (let k = oc - 1; k >= 0; k--) { const i = order[k], p = parent[i]; if (p >= 0 && elev[p] >= 0) acc[p] += acc[i]; }
  progress(0.55);
  /* lakes: pits deep enough and big enough to hold standing water */
  const lakeQ = Math.round(0.014 * Q), minLake = Math.max(16, Math.round(N / 60000));
  const seen = new Uint8Array(N), stack: number[] = [];
  let lakes = 0;
  for (let s = 0; s < N; s++) {
    if (seen[s] || elev[s] < 0 || filled[s] - elevQ[s] <= lakeQ) continue;
    const comp: number[] = []; stack.push(s); seen[s] = 1;
    while (stack.length) { const i = stack.pop()!; comp.push(i); const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of NB8) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const n = yy * w + xx;
        if (!seen[n] && elev[n] >= 0 && filled[n] - elevQ[n] > lakeQ * 0.35) { seen[n] = 1; stack.push(n); } } }
    let wet = 0; for (const i of comp) wet += rain[i];
    if (comp.length >= minLake && wet / comp.length > 0.3) { lakes++; for (const i of comp) { flags[i] |= Flag.Water | Flag.Lake; elev[i] = filled[i] / Q; } }
  }
  progress(0.7);
  /* rivers, scaled so every map size gets a similar number of big rivers */
  const thr = 260 * Math.sqrt(N / (1024 * 512));
  let riverTiles = 0;
  for (let k = 0; k < oc; k++) {
    const i = order[k]; if (acc[i] < thr || (flags[i] & Flag.Lake)) continue;
    flags[i] |= Flag.Water | Flag.River;
    const wd = acc[i] > thr * 40 ? 3 : acc[i] > thr * 8 ? 2 : 1;
    depth[i] = Math.max(depth[i], wd); riverTiles++;
    if (wd > 1) {
      const p = parent[i]; if (p < 0) continue;
      const dx = (p % w) - (i % w), dy = ((p / w) | 0) - ((i / w) | 0);
      const sides = wd === 3 ? [[-dy, dx], [dy, -dx]] : [[-dy, dx]];
      const x = i % w, y = (i / w) | 0;
      for (const [sx, sy] of sides) { const xx = x + sx, yy = y + sy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const n = yy * w + xx;
        if (elev[n] >= 0 && !(flags[n] & Flag.Lake)) { flags[n] |= Flag.Water | Flag.River; depth[n] = Math.max(depth[n], wd); } }
    }
  }
  /* a dry tile hemmed in by river on three sides is a sandbar the current would take: flood it */
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (flags[i] & Flag.Water || elev[i] < 0) continue;
    let n = 0, d = 1; for (const j of [i - 1, i + 1, i - w, i + w]) if (flags[j] & (Flag.River | Flag.Lake)) { n++; d = Math.max(d, depth[j]); }
    if (n >= 3) { flags[i] |= Flag.Water | Flag.River; depth[i] = d; riverTiles++; }
  }
  /* rivers wear their valleys down a little, which the hillshade picks up */
  for (let i = 0; i < N; i++) if ((flags[i] & Flag.River) && elev[i] > 0) elev[i] = Math.max(0.0005, elev[i] - 0.006 * Math.log2(acc[i] / thr + 1));
  progress(1);
  return { acc, lakes, riverTiles, thr };
}
