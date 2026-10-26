import { fbm, blur } from "../../shared/noise.ts";

/*
  Temperature falls toward the poles and with altitude. Rain is carried by the prevailing
  winds: easterly trade winds near the equator, westerlies in the middle latitudes,
  polar easterlies near the poles. Air picks up moisture over water, drops it as it
  travels inland, and dumps most of it when forced up a mountain range, leaving a dry
  rain shadow behind. Subtropical highs dry out the bands around 30 degrees.
*/

export function climate(w: number, h: number, elev: Float32Array, seed: number, progress: (p: number) => void) {
  const temp = new Float32Array(w * h), rain = new Float32Array(w * h);
  const S = h;
  for (let y = 0; y < h; y++) {
    if ((y & 127) === 0) progress(y / h * 0.5);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, e = elev[i];
      const lat = latAt(x, y, w, h, seed);   /* 0 at the equator, 1 at the poles */
      const n = fbm(x / S * 6, y / S * 6, seed + 61, 3) - 0.5;
      let t = 1.02 - Math.pow(lat, 1.25) * 1.08 + n * 0.12;
      if (e > 0) t -= e * 0.62;
      else t = t * 0.85 + 0.12;   /* oceans are milder */
      temp[i] = Math.max(0, Math.min(1, t));
    }
  }
  /* rain only cares about large-scale climbs, not every bump, so read a smoothed copy */
  const es = new Float32Array(w * h); for (let i = 0; i < w * h; i++) es[i] = Math.max(0, elev[i]);
  blur(es, w, h, Math.max(2, w >> 7), 2);
  /* sweep each row along its wind */
  for (let y = 0; y < h; y++) {
    if ((y & 127) === 0) progress(0.5 + y / h * 0.4);
    const lat = Math.abs(y / h - 0.5) * 2;
    const dir = lat < 0.33 ? -1 : lat < 0.66 ? 1 : -1;
    let m = 1, prev = 0;
    const ks = 1024 / w;   /* same weather patterns at every map size */
    const start = dir > 0 ? 0 : w - 1;
    for (let k = 0; k < w; k++) {
      const x = start + dir * k, i = y * w + x, e = elev[i];
      if (e < 0) { m = Math.min(1, m + 0.035); prev = es[i]; rain[i] = m * 0.9; continue; }
      const rise = Math.max(0, es[i] - prev);
      prev = es[i];
      const hold = 0.45 + 0.55 * temp[i];               /* cold air holds less water */
      const fall = m * (0.0012 * ks + rise * 1.8);
      m = Math.max(0, m - fall - 0.0006 * ks * (1 + e));
      rain[i] = Math.min(1, (m * 0.92 + fall * 9 / ks) * hold);
    }
  }
  blur(rain, w, h, Math.max(3, w >> 6), 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lat = latAt(x, y, w, h, seed);
      /* the subtropical highs dry the interiors and lee sides most; a coast facing the
         wind still catches some rain, as monsoon coasts do */
      const hadley = 1 - Math.exp(-(((lat - 0.34) / 0.1) ** 2)) * (0.22 + 0.6 * (1 - rain[y * w + x]));
      const itcz = 1 + 0.4 * Math.exp(-((lat / 0.13) ** 2));
      const i = y * w + x, n = fbm(x / S * 7 + 3, y / S * 7, seed + 71, 4) - 0.5;
      const n2 = fbm(x / S * 24, y / S * 24, seed + 73, 3) - 0.5;
      rain[i] = Math.max(0, Math.min(1, rain[i] * 1.75 * hadley * itcz + n * 0.3 + n2 * 0.16));
    }
  }
  rankRain(rain, elev);
  progress(1);
  return { temp, rain };
}

/** Latitude with a slow wobble, so climate bands meander instead of running ruler-straight. */
function latAt(x: number, y: number, _w: number, h: number, seed: number): number {
  const wob = (fbm(x / h * 2.2, y / h * 2.2, seed + 97, 3) - 0.5) * 0.3;
  return Math.min(1, Math.abs(y / h - 0.5 + wob * 0.5) * 2);
}

/*
  The winds decide where it is wet and where it is dry, but the overall amount would swing
  with how big and how close together the continents are. So land rainfall is re-ranked
  onto an Earth-like spread (about an eighth of the land arid, a third really wet) while
  keeping every place in the same order: rain shadows stay dry, windward coasts stay wet.
*/
function rankRain(rain: Float32Array, elev: Float32Array): void {
  const B = 2048, hist = new Float64Array(B); let n = 0;
  for (let i = 0; i < rain.length; i++) if (elev[i] >= 0) { hist[Math.min(B - 1, Math.floor(rain[i] * B))]++; n++; }
  if (!n) return;
  const cdf = new Float32Array(B); let acc = 0;
  for (let b = 0; b < B; b++) { acc += hist[b]; cdf[b] = (acc - hist[b] / 2) / n; }
  for (let i = 0; i < rain.length; i++) if (elev[i] >= 0) { const p = cdf[Math.min(B - 1, Math.floor(rain[i] * B))]; rain[i] = 0.05 + 0.87 * Math.pow(p, 1.12); }
}
