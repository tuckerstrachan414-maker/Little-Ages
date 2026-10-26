/* Field Notes palette (round 2 pick) plus color helpers ported from the style board. */

export function hex2rgb(h: string): [number, number, number] { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
export function rgb2hex(r: number, g: number, b: number): string { return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
function rgb2hsl(r: number, g: number, b: number): [number, number, number] { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; }
function hsl2rgb(h: number, s: number, l: number): [number, number, number] { h = ((h % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0; if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]; }
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export function mix(a: string, b: string, t: number): string { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
const shadeMemo = new Map<string, string>();
/** Hue-shifted ramp step: positive darkens toward cool violet, negative lightens toward warm yellow. */
export function shade(hex: string, amt: number): string {
  const k = hex + amt; const m = shadeMemo.get(k); if (m) return m;
  const [h, s, l] = rgb2hsl(...hex2rgb(hex)); const toward = amt > 0 ? 245 : 55;
  const dh = ((toward - h + 540) % 360) - 180; const nh = h + dh * Math.min(0.22, Math.abs(amt) * 0.75);
  const ns = clamp01(amt > 0 ? s + amt * 0.25 : s - Math.abs(amt) * 0.35);
  const r = rgb2hex(...hsl2rgb(nh, ns, clamp01(l - amt))); shadeMemo.set(k, r); return r;
}

export const FN = {
  deep: "#1f4659", ocean: "#2c6175", shelf: "#4f8b93", shallow: "#6ba5a3", lake: "#3b7488", river: "#4d8fa3", ice: "#d6e6ea", foam: "#d5e4d6",
  sand: "#d6c393", sandD: "#b5a06e", sandL: "#e8dcb2", shingle: "#a59f8c", cliff: "#7c766a",
  grass: "#7c9a4c", grassD: "#647f3c", grassL: "#94b05d", dryGrass: "#a8a35c", steppe: "#a5a172", shrub: "#8a8f56",
  forest: "#5b7a3a", forestD: "#4a662f", rainforest: "#3f6a34", taiga: "#566f4d", tundra: "#9aa58a", savanna: "#c4a456", desert: "#d9c08a", coldDesert: "#bba985", swamp: "#5f6f45",
  snow: "#e7ebe5", snowD: "#c2cbc8", rock: "#7a766d", rockD: "#5c5952", rockL: "#9a958a", iceSheet: "#e3ecee",
  leaf: "#5c8a3d", leafD: "#3f6630", leafL: "#82ab53", pine: "#3f6a44", pineD: "#2c4f36", trunk: "#6b4a2c", trunkD: "#4d3420", bark: "#d8d2c2",
  outline: "#26211d", wood: "#8a6040", woodL: "#a8805a", thatch: "#c6a25c", stone: "#8c8a82",
  fire: "#ef9a3c", fireL: "#ffdf7e", smoke: "#d9d8d0", cloud: "#f2f2ec",
  deer: "#93673e", deerD: "#6c4b2c", aurochs: "#4a3426", mammoth: "#6e4a32", horse: "#a07a4e", wolf: "#8c8a84", bear: "#5c3e2a",
};

/** Canopy colors per tree species and season [spring, summer, autumn, winter]. */
export const CANOPY: Record<number, [string, string, string, string]> = {
  1: ["#7ea44c", "#5c8a3d", "#c07a2e", "#7a6650"],    /* oak: orange-brown */
  2: ["#8ab055", "#5f8e3f", "#b3301f", "#7a6252"],    /* maple: red */
  3: ["#9cbc5e", "#74a04a", "#e2c04a", "#a59c8e"],    /* birch: yellow, pale bark */
  4: ["#86ac52", "#628f40", "#b5602a", "#7a6450"],    /* beech: copper */
  5: ["#98ba5a", "#6f9a46", "#e9b636", "#988d7e"],    /* aspen: gold */
  6: ["#9cbb64", "#7aa250", "#c9b84a", "#8a8468"],    /* willow */
  7: ["#4b7a4c", "#3f6a44", "#3f6a44", "#3d6142"],    /* pine */
  8: ["#3f6c4c", "#355e44", "#355e44", "#33573f"],    /* spruce */
  9: ["#44714e", "#3a6447", "#3a6447", "#375d43"],    /* fir */
  10: ["#7fa25a", "#5f8a4a", "#d8a83a", "#8a7a62"],   /* larch: yellow then bare */
  11: ["#6c9a44", "#6c9a44", "#7c9a44", "#6c9040"],   /* palm */
  12: ["#8a9a48", "#7f8f40", "#9a8f40", "#8a8a4a"],   /* acacia */
  13: ["#8aa050", "#7a9446", "#b0903a", "#8c7c5a"],   /* baobab */
  14: ["#3f7a3a", "#3a7034", "#3d7236", "#3a6e34"],   /* kapok */
  15: ["#4f7f44", "#4a7840", "#4c7a42", "#4a763f"],   /* mangrove */
  16: ["#6f8f4a", "#6a8a46", "#6c8c48", "#6a8846"],   /* cactus */
  17: ["#7a6a58", "#7a6a58", "#7a6a58", "#7a6a58"],   /* dead snag */
  18: ["#6a9444", "#5c8a3d", "#a85a32", "#7a6a56"],   /* berry bush */
  19: ["#8aa45a", "#7c9a4c", "#b8a45a", "#a8a088"],   /* reeds */
  20: ["#7d9452", "#6f8a4a", "#9a8a4a", "#7a7a62"],   /* scrub */
  21: ["#5a7a44", "#4f7240", "#8a6a3a", "#6a5e4a"],   /* cypress: rusts in autumn */
};
