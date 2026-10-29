import { mix, shade } from "../../shared/palette.ts";
import { skinHex } from "../../sim/people/genetics.ts";
import { Anim, PFlag, type Look } from "../../shared/people.ts";
import { grid, put, del, rect, hline, vline, outlined, type Grid } from "./grid.ts";

/*
  People, drawn the way the style board drew them (round 2): an 8x16 body built from parts
  by age and sex, skin from melanin, hair by color, texture and the culture's style, clothes
  by culture, season and wealth. Lit from the top left with hue-shifted shading, a dark
  outer outline, and poses for every kind of work so you can always tell what someone is
  doing. Front, side and back views; tiny versions for the zoomed-out map.
*/

/* Field Notes colors used by people and their things */
const P = {
  hide: "#a47b52", wool: "#e2dccb", ochre: "#a5503c", yel: "#c49e40", woodL: "#a8805a", wood: "#8a6040", woodD: "#62422a",
  stoneL: "#aaa79d", stone: "#8c8a82", thatch: "#c6a25c", thatchD: "#9f7e40", thatchL: "#dcc085", eye: "#231a17", blush: "#d98a7c",
  outline: "#26211d", meat: "#a8433a", meatL: "#cf6a52", fish: "#9fb6be", fishD: "#6f8a94", berry: "#9a2f45", green: "#6f9a44", fur: "#7a5a3e", furL: "#9a7a58",
};

export type View = "front" | "side" | "back";
interface Age { hw: number; hh: number; th: number; lh: number; sw: number; stoop?: number; }
const AGE: Record<string, Age> = {
  toddler: { hw: 6, hh: 4, th: 2, lh: 1, sw: 4 }, child: { hw: 6, hh: 4, th: 3, lh: 2, sw: 4 }, teen: { hw: 6, hh: 4, th: 5, lh: 4, sw: 4 },
  adult: { hw: 6, hh: 5, th: 5, lh: 4, sw: 6 }, elder: { hw: 6, hh: 5, th: 5, lh: 3, sw: 6, stoop: 1 },
};

/** Frame timings in ms: walks 100-150 with contact frames held longer, idles 300-500, work holds the impact frame. */
const TIMING: Record<string, number[]> = {
  idle: [440, 320, 440, 320], walk: [130, 100, 130, 100], run: [80, 70, 80, 70], carry: [150, 120, 150, 120],
  gather: [420, 260, 420, 300], dig: [220, 80, 240, 170], fish: [600, 520, 600, 520], throw: [260, 90, 300, 240], butcher: [200, 70, 230, 160],
  chop: [200, 70, 230, 160], knap: [150, 60, 170, 120], sew: [380, 300, 380, 300], talk: [300, 240, 300, 240], sit: [460, 340, 460, 340],
  sleep: [900, 900, 900, 900], cook: [380, 380, 380, 380], holdbaby: [460, 340, 460, 340], cane: [480, 360, 480, 360], canewalk: [170, 150, 170, 150],
  play: [90, 80, 90, 80], wave: [180, 180, 180, 180], drink: [500, 400, 500, 400], eat: [360, 300, 360, 300], sick: [900, 900, 900, 900],
  /* raising a hut: crouch back to lift, reach up to lash, bring it down and tamp (the impact held), straighten */
  build: [260, 150, 220, 300],
  /* shaping a pot: seated, the hands turning and pinching the clay */
  shape: [300, 220, 300, 220],
};
const NAMES = ["idle", "walk", "run", "carry", "gather", "dig", "fish", "throw", "butcher", "chop", "knap", "sew", "talk", "sit", "sleep", "cook", "holdbaby", "cane", "canewalk", "play", "wave", "drink", "eat", "sick", "build", "shape"];
export function animName(a: number): string { return NAMES[a] ?? "idle"; }
export function animFrame(anim: number, t: number, phase: number): number {
  const d = TIMING[animName(anim)] ?? TIMING.idle, total = d[0] + d[1] + d[2] + d[3];
  let m = ((t + phase) % total + total) % total;
  for (let i = 0; i < 4; i++) { if (m < d[i]) return i; m -= d[i]; }
  return 0;
}

export interface Drawn { c: HTMLCanvasElement; tip: [number, number] | null; hit: [number, number] | null; }
const cache = new Map<string, Drawn>();
const MAX = 6000;

/** A person sprite: feet at the bottom center of the canvas (one transparent pixel row for the outline). */
export function personSprite(l: Look, anim: number, frame: number, view: View, flags: number, load: number): Drawn {
  const key = `${l.id}|${l.stage}|${l.wear}|${l.style}|${(l.gray * 6) | 0}|${anim}|${frame}|${view}|${flags & (PFlag.Sling | PFlag.Spear | PFlag.Pregnant | PFlag.Sad | PFlag.Happy | PFlag.Wood | PFlag.Carrying | PFlag.Meat | PFlag.Injured | PFlag.Leader | PFlag.Chief)}|${load}`;
  let d = cache.get(key);
  if (d) return d;
  if (cache.size > MAX) { let n = 0; for (const k of cache.keys()) { cache.delete(k); if (++n > MAX / 4) break; } }
  const r = anim === Anim.Sleep || anim === Anim.Sick ? lyingGrid(l, anim, frame) : personGrid(l, anim, frame & 3, view, flags, load);
  d = { c: toCanvas(outlined(r.g, P.outline)), tip: r.tip, hit: r.hit };
  cache.set(key, d);
  return d;
}
function toCanvas(g: Grid): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = g.w; c.height = g.h; const x = c.getContext("2d")!;
  for (let y = 0; y < g.h; y++) for (let i = 0; i < g.w; i++) { const p = g.px[y * g.w + i]; if (p) { x.fillStyle = p; x.fillRect(i, y, 1, 1); } }
  return c;
}

interface Built { g: Grid; tip: [number, number] | null; hit: [number, number] | null; }

function colors(l: Look) {
  const skin = skinHex(l.skin), skinD = shade(skin, 0.1), skinL = shade(skin, -0.07);
  let hairC = l.hair; if (l.gray > 0) hairC = mix(hairC, "#e6e3dc", Math.min(1, l.gray));
  /* dark hair needs a brighter shine to show its shape */
  const dark = l.gray < 0.3 && parseInt(hairC.slice(1, 3), 16) < 90;
  const top = l.wear === "furs" ? (l.trim === "#ece4d0" ? "#cbbfa6" : P.fur) : l.top, bot = l.wear === "furs" ? P.fur : l.bottom;
  return { skin, skinD, skinL, hairC, hairD: shade(hairC, 0.08), hairL: dark ? mix(hairC, "#8a7a6a", 0.45) : shade(hairC, -0.1), top, topD: shade(top, 0.11), topL: shade(top, -0.08), topDD: shade(top, 0.2), bot, botD: shade(bot, 0.11), eye: l.eye };
}

function personGrid(l: Look, anim: number, f: number, view: View, flags: number, load: number): Built {
  const st = l.stage === "baby" ? "toddler" : l.stage;
  const A = { ...AGE[st] };
  if (st === "adult" || st === "elder") A.lh = Math.max(3, A.lh + (l.tall > 0 ? 1 : l.tall < 0 ? -1 : 0));
  const g = grid(24, 27), cx = 12, fy = 25;
  const a = animName(anim);
  const sit = a === "sit" || a === "cook" || a === "holdbaby" || a === "sew" || a === "knap" || a === "eat" || a === "shape";
  const crouch = a === "gather" || a === "drink" || a === "butcher";
  const sad = (flags & PFlag.Sad) !== 0 && (a === "idle" || a === "walk" || a === "sit");
  const legH = sit ? 1 : crouch ? Math.max(1, A.lh - 2) : A.lh;
  const T = 1 + A.hh + A.th + legH + 1;
  const walking = a === "walk" || a === "carry" || a === "canewalk";
  const bob = walking || a === "run" || a === "play" ? [0, -1, 0, -1][f] : 0;
  const breathe = (a === "idle" || a === "cane" || sit || a === "fish") && f === 1 ? -1 : 0;
  const happyHop = (flags & PFlag.Happy) && a === "idle" && f === 1 ? -1 : 0;
  const swing = a === "chop" || a === "dig" || a === "butcher", raise = a === "build";
  const lean = swing ? [-1, 0, 1, 0][f] : raise ? [-1, 0, 1, 0][f] : a === "run" || a === "play" ? 1 : crouch ? 1 : 0;
  /* squash on the impact, a stretch up on the toes for the reach (overshooting the rest pose) */
  const squash = (swing || raise) && f === 2 ? 1 : 0, stretch = raise && f === 1 ? -1 : 0;
  const dy = bob + breathe + squash + stretch + happyHop;
  const blink = a === "idle" && f === 3;
  const y0 = fy - T + 1, hy = y0 + 1 + dy + (sad ? 1 : 0), ty = y0 + 1 + dy + A.hh, ly = fy - legH;
  const stoop = (A.stoop ?? 0) + (sad ? 0 : 0);
  const c = colors(l);
  const { skin, skinD, skinL, hairC, hairD, hairL, top, topD, topL, topDD, bot, botD, eye } = c;
  const side = view === "side", back = view === "back";
  const wear = l.wear;
  const stride = walking ? [1, 0, -1, 0][f] : a === "run" || a === "play" ? [2, 0, -2, 0][f] : 0;
  let tip: [number, number] | null = null, hit: [number, number] | null = null;
  const hw = side ? A.hw - 1 : A.hw;
  const hx = (side ? cx - 3 + stoop : cx - A.hw / 2) + lean;
  const hY = hy + stoop;
  const ey = hY + Math.floor(A.hh / 2);
  const stl = l.style;
  const longHair = stl === "long" || stl === "wavy" || stl === "shaggy";
  const lag = bob < 0 ? 1 : 0;
  const foot = shade(skin, 0.17);

  /* back hair (seen behind the head from the front and side, covering the head from the back) */
  if (longHair && !back) {
    const bottom = ty + (stl === "shaggy" ? 1 : 2) + (stl === "wavy" ? 1 : 0) + lag;
    if (side) { for (let y = hY + 1; y <= bottom; y++) for (let x = hx - 1; x <= hx + 1; x++) put(g, x, y, x === hx - 1 ? hairD : (y % 3 ? hairC : hairD)); }
    else for (let y = hY + 1; y <= bottom; y++) for (let x = hx - 1; x <= hx + hw; x++) put(g, x, y, x === hx + hw ? hairD : (stl === "wavy" && (x + y) % 2) ? hairD : hairC);
  }

  /* baby in a sling, carried on the back: behind the body when seen from the front */
  if (flags & PFlag.Sling && !back && !side) { rect(g, cx + 1, ty, 3, 2, P.yel); put(g, cx + 3, ty, skinL); }

  /* legs */
  const bare = wear === "loin" || st === "toddler";
  const legC = bare ? skin : bot, legD = bare ? skinD : botD;
  if (sit) {
    rect(g, cx - 3, ly, 6, 1, (wear === "dress" || wear === "wrap") ? top : legC); put(g, cx + 2, ly, (wear === "dress" || wear === "wrap") ? topD : legD);
    [cx - 3, cx - 2, cx + 1, cx + 2].forEach(x => put(g, x, fy, foot));
  } else if (!side) {
    const liftL = (walking || a === "run" || a === "play") && f === 0, liftR = (walking || a === "run" || a === "play") && f === 2;
    for (let r = 0; r < legH - (liftL ? 1 : 0); r++) { put(g, cx - 2, ly + r, legC); put(g, cx - 1, ly + r, legD); }
    for (let r = 0; r < legH - (liftR ? 1 : 0); r++) { put(g, cx, ly + r, legC); put(g, cx + 1, ly + r, legD); }
    put(g, cx - 2, fy - (liftL ? 1 : 0), foot); put(g, cx - 1, fy - (liftL ? 1 : 0), shade(foot, 0.08)); put(g, cx, fy - (liftR ? 1 : 0), foot); put(g, cx + 1, fy - (liftR ? 1 : 0), shade(foot, 0.08));
  } else {
    const base = cx - 1;
    const legAt = (s: number, col: string, fc: string) => {
      for (let r = 0; r < legH; r++) { const dx = Math.round(s * (r + 1) / legH); put(g, base + dx, ly + r, col); put(g, base + dx + 1, ly + r, col); }
      const dx = Math.round(s); put(g, base + dx, fy, fc); put(g, base + dx + 1, fy, fc); put(g, base + dx + 2, fy, fc);
    };
    if (crouch) { /* knees bent: one leg forward and folded */ legAt(-1, legD, shade(foot, 0.1)); legAt(2, legC, foot); }
    else { legAt(-stride, legD, shade(foot, 0.1)); legAt(stride, legC, foot); }
  }

  /* torso */
  const sw = side ? (A.sw >= 6 ? 5 : 4) : A.sw, sx = (side ? cx - 2 : cx - A.sw / 2) + (side ? Math.round(lean / 2) : 0);
  const bC = wear === "loin" ? skin : top, bD = wear === "loin" ? skinD : topD, bL = wear === "loin" ? skinL : topL;
  for (let r = 0; r < A.th; r++) for (let i = 0; i < sw; i++) {
    let col = bC;
    if (i === 0) col = r < 2 ? bL : bC;
    if (side ? i === sw - 1 && r > 0 : i === sw - 1) col = bD;
    if (r === A.th - 1 && wear !== "dress") col = side ? bD : (i === sw - 1 ? shade(bD, 0.06) : bD);
    if (wear === "furs" && (i * 3 + r * 5) % 7 === 0) col = P.furL;
    if (back && r === 0 && longHair) col = hairC;
    put(g, sx + i, ty + r, col);
  }
  /* a pregnancy shows as a rounder belly */
  if (flags & PFlag.Pregnant && A.th >= 4) { if (side) { put(g, sx + sw, ty + A.th - 2, bC); put(g, sx + sw, ty + A.th - 3, bL); } else { put(g, sx - 1, ty + A.th - 2, bC); put(g, sx + sw, ty + A.th - 2, bD); } }
  if (!side && !back && A.th >= 4 && wear !== "loin") put(g, cx - 1, ty, shade(top, 0.14));
  if (l.sex === "f" && !side && (wear === "dress" || wear === "wrap") && A.th >= 4 && (st === "adult" || st === "teen" || st === "elder")) { del(g, sx, ty + A.th - 1); del(g, sx + sw - 1, ty + A.th - 1); }
  /* a dyed belt on tunics and dresses */
  if ((wear === "tunic" || wear === "dress") && A.th >= 4) hline(g, sx, ty + A.th - 2, sw, l.trim);
  if (wear === "tunic") hline(g, sx, ty + A.th - 1, sw, topDD);
  if (wear === "loin") {
    /* body paint: ochre stripes or white clay dots across the chest */
    if (l.paint === 1 && A.th >= 4 && !back) for (let i = 0; i < sw; i += 2) { put(g, sx + i, ty + 1, "#a5503c"); put(g, sx + i + 1, ty + 2, "#a5503c"); }
    if (l.paint === 2 && A.th >= 4) for (let i = 1; i < sw; i += 2) put(g, sx + i, ty + 2 + (i % 4 === 1 ? 0 : 1), "#ece4d0");
    rect(g, sx, ly, sw, 1, l.bottom); put(g, sx + sw - 1, ly, shade(l.bottom, 0.12)); put(g, sx + 1, ly, l.trim);
  }
  /* a necklace of beads, shells or teeth */
  if (l.beads && !back && A.th >= 4) for (let i = 1; i < sw - 1; i++) put(g, sx + i, ty, i % 2 ? "#ece4d0" : l.trim);
  if (wear === "wrap" && !side && !back) { put(g, sx, ty, skin); put(g, sx + 1, ty, skinL); for (let r = 0; r < A.th; r++) put(g, sx + Math.min(sw - 1, r + 1), ty + r, topD); }
  if (wear === "furs" && !sit && !crouch) for (let i = 0; i < sw; i++) if (i % 2 === 0) put(g, sx + i, ly, i === sw - 1 ? topD : top);
  if ((wear === "dress" || wear === "wrap") && !sit && !crouch) {
    const rows = wear === "dress" ? Math.max(1, legH - 1) : Math.max(1, legH - 2);
    for (let r = 0; r < rows; r++) { const grow = r > 0 ? 1 : 0; for (let i = -grow; i < sw + grow; i++) put(g, sx + i, ly + r, (side ? i <= 0 : i >= sw - 1) ? topD : (i === -grow && !side ? topL : top)); }
  }
  if (flags & PFlag.Sling && side) { rect(g, sx - 2, ty, 2, 3, P.yel); put(g, sx - 2, ty, skinL); put(g, sx - 1, ty + 2, shade(P.yel, 0.12)); }

  /* arms */
  const sleeve = wear === "loin" ? skin : top, sleeveD = wear === "loin" ? skinD : topD;
  const armLen = Math.max(1, Math.min(3, A.th - 1));
  const armDown = (x: number, col: string, hand = skin) => { for (let r = 0; r < armLen; r++) put(g, x, ty + r, col); put(g, x, ty + armLen, hand); };
  const handle = P.woodL, handleD = P.wood;
  if (!side) {
    if (a === "talk" && f === 1 && !back) { put(g, sx + sw, ty, sleeveD); put(g, sx + sw + 1, ty - 1, skin); armDown(sx - 1, sleeve); }
    else if (a === "talk" && f === 3 && !back) { put(g, sx - 1, ty, sleeve); put(g, sx - 2, ty - 1, skin); armDown(sx + sw, sleeveD, skinD); }
    else if (a === "wave") { armDown(sx - 1, sleeve); put(g, sx + sw, ty, sleeveD); put(g, sx + sw + 1, ty - 1, sleeveD); put(g, sx + sw + 1 + (f % 2), ty - 2, skin); }
    else if (a === "play") { const up = f % 2; put(g, sx - 1, ty - up, sleeve); put(g, sx - 1, ty - 1 - up, skin); put(g, sx + sw, ty - (1 - up), sleeveD); put(g, sx + sw, ty - 2 + up, skin); }
    else if (a === "holdbaby" && !back) {
      armDown(sx - 1, sleeve); armDown(sx + sw, sleeveD, skinD);
      rect(g, cx - 3, ty + 1, 4, 3, P.yel); put(g, cx, ty + 3, shade(P.yel, 0.12)); hline(g, cx - 3, ty + 2, 4, shade(P.yel, 0.07));
      rect(g, cx - 3, ty, 3, 2, skinL); put(g, cx - 3, ty, hairC); put(g, cx - 2, ty, hairC); put(g, cx - 1, ty + 1, eye);
      put(g, cx + 1, ty + 2, skin);
    }
    else if (a === "cook" && !back) {
      armDown(sx - 1, sleeve); put(g, sx + sw, ty, sleeveD); put(g, sx + sw + 1, ty + 1, skin);
      const b = f % 2; put(g, sx + sw + 2, ty + 1 + b, handle); put(g, sx + sw + 3, ty + 2 + b, handleD); put(g, sx + sw + 4, ty + 3 + b, P.woodD);
      tip = [sx + sw + 4, ty + 3 + b];
    }
    else if (a === "eat" && !back) { armDown(sx - 1, sleeve); const up = f % 2 === 0; if (up) { put(g, sx + sw, ty, sleeveD); put(g, sx + sw - 1, ty - 1, skin); } else armDown(sx + sw, sleeveD, skinD); }
    else if ((a === "sew" || a === "knap" || a === "shape") && !back) {
      /* hands working in the lap: a needle glints, a stone strikes a stone, or a lump of clay rises into a pot */
      put(g, sx - 1, ty, sleeve); put(g, sx, ty + 1, skin); put(g, sx + sw, ty, sleeveD); put(g, sx + sw - 1, ty + 1 - (f % 2), skin);
      if (a === "sew") { rect(g, cx - 2, ty + 2, 4, 1, P.fur); if (f % 2) put(g, cx, ty + 1, "#f2efe6"); }
      else if (a === "shape") { const h = f < 2 ? 1 : 2; rect(g, cx - 1, ty + 3 - h, 3, h, "#b5603a"); put(g, cx, ty + 3 - h, "#c8744a"); if (f === 3) { put(g, cx - 2, ty + 2, "#b5603a"); put(g, cx + 2, ty + 2, "#b5603a"); } }
      else { put(g, cx - 1, ty + 2, P.stoneL); put(g, cx, ty + 2 - (f % 2), P.stone); if (f === 2) hit = [cx, ty + 1]; }
    }
    else if (a === "cane" && !back) { armDown(sx - 1, sleeve); put(g, sx + sw, ty, sleeveD); put(g, sx + sw, ty + 1, sleeveD); put(g, sx + sw + 1, ty + 2, skin); for (let y = ty + 3; y <= fy; y++) put(g, sx + sw + 1, y, handle); }
    else if (a === "carry") { put(g, sx - 1, ty, sleeve); put(g, sx - 1, ty - 1, skin); put(g, sx + sw, ty, sleeveD); put(g, sx + sw, ty - 1, skinD); }
    else { armDown(sx - 1, sleeve); armDown(sx + sw, sleeveD, skinD); }
    if (flags & PFlag.Spear && a !== "carry") { for (let y = ty - 4; y <= fy - 1; y++) put(g, sx + sw + 1, y, y < ty - 2 ? P.stoneL : handle); put(g, sx + sw + 1, ty - 5, P.stone); }
  } else {
    const ax = cx + Math.round(lean / 2), arm = shade(sleeve, 0.13);
    const metal = a === "dig" ? P.woodD : P.stoneL, metalD = shade(metal, 0.15);
    if (swing) {
      const head = (ex: number, eyy: number, down: boolean) => {
        if (a === "chop" || a === "butcher") { put(g, ex, eyy, metal); put(g, ex, eyy + 1, metalD); put(g, ex + (down ? -1 : 1), eyy + (down ? 1 : 0), metal); }
        else { put(g, ex, eyy, metal); put(g, ex, eyy + 1, metalD); }
      };
      const low = a === "butcher" ? 2 : 0;
      if (f === 0) { put(g, ax + 1, ty, arm); put(g, ax + 2, ty - 1, arm); put(g, ax + 2, ty - 2, skin); put(g, ax + 1, ty - 3, handle); put(g, ax, ty - 4, handle); put(g, ax - 1, ty - 5, handleD); head(ax - 2, ty - 6, false); }
      else if (f === 1) { put(g, ax + 1, ty, arm); put(g, ax + 1, ty - 1, arm); put(g, ax + 1, ty - 2, skin); vline(g, ax + 1, ty - 5, 3, handle); head(ax + 2, ty - 6, false); }
      else if (f === 2) {
        put(g, ax + 1, ty + 1, arm); put(g, ax + 2, ty + 2, skin);
        const len = a === "dig" ? 5 : 3 - (low ? 1 : 0);
        for (let i = 1; i <= len; i++) put(g, ax + 2 + i, ty + 2 + i, i % 2 ? handle : handleD);
        const ex = ax + 3 + len, eyy = ty + 2 + len; head(ex, eyy - 1, true); hit = [ex, eyy];
      } else { put(g, ax + 1, ty + 1, arm); put(g, ax + 2, ty + 1, skin); hline(g, ax + 3, ty + 1, 3, handle); head(ax + 6, ty, false); }
    } else if (raise) {
      /* a pole lifted overhead, lashed high on the frame, then a stake tamped into the ground */
      if (f === 0) { put(g, ax + 1, ty + 1, arm); put(g, ax + 2, ty + 2, skin); hline(g, ax + 1, ty + 3, 6, handle); put(g, ax + 6, ty + 3, handleD); }
      else if (f === 1) { for (let y = ty - 1; y >= ty - 5; y--) put(g, ax + 2, y, arm); put(g, ax + 2, ty - 6, skin); hline(g, ax - 2, ty - 7, 8, handle); put(g, ax + 5, ty - 7, handleD); put(g, ax - 1, ty - 8, P.thatch); put(g, ax, ty - 8, P.thatchL); put(g, ax + 1, ty - 8, P.thatch); }
      else if (f === 2) { put(g, ax + 1, ty + 1, arm); put(g, ax + 2, ty + 2, arm); put(g, ax + 3, ty + 2, skin); vline(g, ax + 3, ty + 3, Math.max(1, fy - ty - 3), handle); hit = [ax + 3, fy]; }
      else { put(g, ax + 1, ty, arm); put(g, ax + 2, ty + 1, skin); vline(g, ax + 3, ty + 1, 3, handleD); }
    } else if (a === "throw") {
      /* wind up with the spear over the shoulder, hurl it, follow through */
      if (f === 0) { put(g, ax - 1, ty, arm); put(g, ax - 2, ty - 1, arm); put(g, ax - 2, ty - 2, skin); for (let i = -4; i <= 4; i++) put(g, ax + i, ty - 2, i > 2 ? P.stoneL : handle); }
      else if (f === 1) { put(g, ax + 1, ty, arm); put(g, ax + 2, ty - 1, arm); put(g, ax + 3, ty - 1, skin); for (let i = 1; i <= 8; i++) put(g, ax + 2 + i, ty - 2, i > 6 ? P.stoneL : handle); tip = [ax + 10, ty - 2]; }
      else { put(g, ax + 1, ty, arm); put(g, ax + 2, ty + 1, arm); put(g, ax + 3, ty + 1, skin); }
    } else if (a === "fish") {
      put(g, ax + 1, ty + 1, arm); put(g, ax + 2, ty + 1, skin);
      const b = f === 2 ? 1 : 0;
      put(g, ax + 3, ty, handle); put(g, ax + 4, ty - 1, handle); put(g, ax + 5, ty - 2 + b, handle); put(g, ax + 6, ty - 3 + b, handleD); put(g, ax + 7, ty - 4 + b, handleD);
      tip = [ax + 7, ty - 4 + b];
    } else if (a === "gather") {
      /* bending to pick: hand down to the ground, then up to the basket at the hip */
      if (f % 2 === 0) { put(g, ax + 1, ty + 1, arm); put(g, ax + 2, ty + 2, arm); put(g, ax + 3, ty + 3, skin); hit = [ax + 3, ty + 4]; }
      else { put(g, ax + 1, ty + 1, arm); put(g, ax + 1, ty + 2, skin); }
      rect(g, ax - 3, ty + 2, 2, 2, P.thatch); put(g, ax - 3, ty + 2, P.thatchL);
    } else if (a === "drink") { put(g, ax + 1, ty + 1, arm); put(g, ax + 2, ty + (f % 2 ? 0 : 2), skin); }
    else if (a === "carry") { put(g, ax, ty, arm); put(g, ax + 1, ty - 1, arm); put(g, ax + 1, ty - 2, skin); }
    else if (a === "canewalk") { put(g, ax, ty, arm); put(g, ax + 1, ty + 1, arm); put(g, ax + 2, ty + 2, skin); for (let y = ty + 3; y <= fy; y++) put(g, ax + 3, y, handle); }
    else if (a === "play") { const up = f % 2; put(g, ax, ty - up, arm); put(g, ax + 1, ty - 1 - up, skin); }
    else if (a === "talk") { put(g, ax + 1, ty, arm); put(g, ax + 2, ty - (f % 2), skin); }
    else {
      const sw2 = a === "run" ? [-2, 0, 2, 0][f] : -stride;
      for (let r = 0; r < armLen; r++) put(g, ax + Math.round(sw2 * r / Math.max(1, armLen)), ty + r, r === 0 ? shade(arm, -0.03) : arm);
      put(g, ax + sw2, ty + armLen, skin);
    }
    if (flags & PFlag.Spear && a !== "throw" && a !== "carry") { for (let i = -3; i <= 5; i++) put(g, ax + 1 + i, ty + 1 - Math.floor(i / 2), i >= 4 ? P.stoneL : handle); }
  }

  /* head: rounded, lit from the top left, jaw in shadow; from behind, all hair */
  for (let r = 0; r < A.hh; r++) for (let i = 0; i < hw; i++) {
    if ((r === 0 || r === A.hh - 1) && (i === 0 || i === hw - 1)) continue;
    let col = skin;
    if (back) col = stl === "bald" ? (i === hw - 1 ? skinD : skin) : (i === hw - 1 || r === A.hh - 1 ? hairD : i === 1 && r < 2 ? hairL : hairC);
    else if (!side) { if (i === hw - 1 || (r === A.hh - 1 && i >= hw - 2)) col = skinD; else if (i === 0 && r < A.hh - 1) col = skinL; }
    else { if (i === 0) col = skinD; if (r === A.hh - 1) col = skinD; }
    put(g, hx + i, hY + r, col);
  }
  if (back) {
    if (stl === "braids") for (let y = hY + 1; y <= ty + 3 + lag; y++) { put(g, hx - 1, y, y % 2 ? hairC : hairD); put(g, hx + hw, y, y % 2 ? hairD : hairC); }
    if (longHair) for (let y = hY + A.hh; y <= ty + 2 + lag; y++) for (let x = hx; x < hx + hw; x++) put(g, x, y, x === hx + hw - 1 ? hairD : hairC);
    if (stl === "bun" || stl === "topknot") { rect(g, cx - 1, hY - 2, 2, 2, hairC); put(g, cx, hY - 1, hairD); }
    if (stl === "coils" || stl === "puffs") { for (let i = -1; i <= hw; i++) put(g, hx + i, hY - 1, (i % 2) ? hairD : hairC); for (let r = 0; r < A.hh - 1; r++) { put(g, hx - 1, hY + r, hairC); put(g, hx + hw, hY + r, hairD); } }
  } else {
    if (side) { put(g, hx + hw - 2, ey, blink ? skinD : eye); if (l.skin > 0.5) put(g, hx + hw - 2, ey + 1, mix(skin, "#e8c8a8", 0.3)); }
    else {
      const e1 = hx + 1, e2 = hx + hw - 2;
      /* on dark skin, light catches the cheekbones so the eyes still read */
      if (l.skin > 0.5) { put(g, e1, ey + 1, mix(skin, "#e8c8a8", 0.35)); put(g, e2, ey + 1, mix(skin, "#e8c8a8", 0.25)); }
      put(g, e1, ey, blink ? skinD : eye); put(g, e2, ey, blink ? skinD : eye);
      if (a === "talk" && (f === 1 || f === 3)) put(g, cx - 1, hY + A.hh - 1, shade(skin, 0.32));
      if (st === "toddler" || st === "child") { put(g, e1, ey + 1, mix(skin, P.blush, 0.45)); put(g, e2, ey + 1, mix(skin, P.blush, 0.45)); }
      if (sad) { put(g, e1, ey - 1, skinD); put(g, e2, ey - 1, skinD); }
    }
    /* front hair */
    if (stl !== "bald") {
      if (side) {
        for (let i = 0; i < hw - 1; i++) put(g, hx + i, hY - 1, i === 0 ? hairD : hairC);
        for (let i = 0; i < hw; i++) put(g, hx + i, hY, i === hw - 1 ? hairL : hairC);
        for (let r = 1; r < A.hh - 1; r++) put(g, hx, hY + r, hairD);
        if (stl !== "crop") for (let r = 1; r < A.hh - 2; r++) put(g, hx + 1, hY + r, hairC);
        if (stl === "bun") { put(g, hx - 1, hY - 1, hairC); put(g, hx - 1, hY, hairD); put(g, hx - 2, hY - 1 + lag, hairD); }
        if (stl === "topknot") { put(g, hx + 1, hY - 2, hairC); put(g, hx + 2, hY - 2, hairL); }
        if (stl === "coils" || stl === "puffs") { for (let i = -1; i < hw - 1; i++) put(g, hx + i, hY - 2, (i % 2) ? hairC : hairL); for (let r = -1; r < A.hh - 1; r++) { put(g, hx - 1, hY + r, hairD); put(g, hx, hY + r, hairC); } }
        if (stl === "braids") for (let y = hY + 1; y <= ty + 3 + lag; y++) put(g, hx - 1, y, y % 2 ? hairC : hairD);
      } else {
        for (let i = 1; i < hw - 1; i++) put(g, hx + i, hY - 1, i === 1 ? hairL : hairC);
        for (let i = 0; i < hw; i++) put(g, hx + i, hY, i === hw - 1 ? hairD : (i === 1 ? hairL : hairC));
        if (stl === "short" || longHair || stl === "bun" || stl === "topknot" || stl === "braids") { put(g, hx, hY + 1, hairC); put(g, hx + hw - 1, hY + 1, hairD); }
        if (stl === "crop") for (let i = 2; i < hw - 2; i++) put(g, hx + i, hY, skinL);
        if (stl === "shaggy") { put(g, hx + 1, hY + 1, hairC); put(g, hx + hw - 2, hY + 1, hairD); }
        if (stl === "bun") { rect(g, cx - 1, hY - 3, 2, 2, hairC); put(g, cx - 1, hY - 3, hairL); put(g, cx, hY - 2, hairD); }
        if (stl === "topknot") { put(g, cx - 1, hY - 2, hairL); put(g, cx, hY - 2, hairC); }
        if (stl === "coils") {
          for (let i = 0; i < hw; i++) put(g, hx + i, hY - 2, (i % 2) ? hairD : hairC);
          for (let i = 0; i < hw; i++) put(g, hx + i, hY - 1, (i % 2) ? hairC : hairL);
          for (let r = -1; r <= 1; r++) { put(g, hx - 1, hY + r, hairC); put(g, hx + hw, hY + r, hairD); }
          put(g, hx, hY + 1, hairC); put(g, hx + hw - 1, hY + 1, hairD);
        }
        if (stl === "puffs") { rect(g, hx - 1, hY - 2, 2, 2, hairC); rect(g, hx + hw - 1, hY - 2, 2, 2, hairD); put(g, hx - 1, hY - 2, hairL); }
        if (stl === "braids") for (let y = hY + 1; y <= ty + 3 + lag; y++) { put(g, hx - 1, y, y % 2 ? hairC : hairD); put(g, hx + hw, y, y % 2 ? hairD : hairC); }
      }
    } else if (!side) { put(g, hx, hY + 1, hairC); put(g, hx + hw - 1, hY + 1, hairD); put(g, hx, hY + 2, hairC); put(g, hx + hw - 1, hY + 2, hairD); put(g, hx + 1, hY, skinL); }
    else { put(g, hx, hY + 1, hairD); put(g, hx, hY + 2, hairD); }
    if (l.beard) {
      if (side) { for (let r = ey + 1; r < hY + A.hh; r++) for (let x = hx + 1; x <= hx + hw - 1; x++) put(g, x, r, x === hx + hw - 1 ? hairL : hairC); put(g, hx + hw - 2, hY + A.hh, hairD); }
      else {
        for (let r = ey + 1; r < hY + A.hh; r++) for (let i = 0; i < hw; i++) put(g, hx + i, r, i === hw - 1 ? hairD : (i === 0 ? hairL : hairC));
        for (let i = 1; i < hw - 1; i++) put(g, hx + i, hY + A.hh, i === hw - 2 ? hairD : hairC);
        put(g, cx - 1, ey + 1, skin); put(g, cx, ey + 1, skinD);
      }
    }
  }

  /* the one the band listens to wears a feather in the hair, set at the back of the head */
  if (flags & (PFlag.Leader | PFlag.Chief) && (st === "adult" || st === "elder")) {
    const quill = "#8a6a3a", vane = "#f2ead6", tipC = "#b5502a";
    if (side) { put(g, hx, hY - 1, quill); put(g, hx - 1, hY - 2, vane); put(g, hx - 1, hY - 3, vane); put(g, hx - 2, hY - 4, tipC); }
    else { const fx = hx + hw - (back ? 2 : 1); put(g, fx, hY - 1, quill); put(g, fx, hY - 2, vane); put(g, fx + 1, hY - 3, vane); put(g, fx + 1, hY - 4, tipC); }
    /* the one a whole village listens to wears a second, taller feather */
    if (flags & PFlag.Chief) {
      if (side) { put(g, hx + 1, hY - 2, quill); put(g, hx, hY - 3, vane); put(g, hx, hY - 4, vane); put(g, hx, hY - 5, vane); put(g, hx - 1, hY - 6, tipC); }
      else { const fx = hx + hw - (back ? 3 : 2); put(g, fx, hY - 2, quill); put(g, fx, hY - 3, vane); put(g, fx, hY - 4, vane); put(g, fx + 1, hY - 5, vane); put(g, fx + 1, hY - 6, tipC); }
    }
  }

  /* loads: a basket on the head (berries, roots, fish), meat over the shoulder, a bundle of firewood */
  if (a === "carry" || (flags & (PFlag.Carrying | PFlag.Wood) && (walking || a === "idle"))) {
    if (flags & PFlag.Wood) { for (let i = 0; i < hw + 3; i++) { put(g, hx - 2 + i, ty - 1 - (i % 3 === 0 ? 1 : 0), i % 2 ? P.wood : P.woodL); put(g, hx - 1 + i, ty - 2, i % 3 === 1 ? P.woodD : null); } }
    else if (flags & PFlag.Meat) { rect(g, side ? sx - 2 : sx + sw - 1, ty - 1, 3, 2, P.meat); put(g, side ? sx - 2 : sx + sw - 1, ty - 1, P.meatL); put(g, side ? sx : sx + sw + 1, ty, "#f0e6d8"); }
    else {
      const bx = hx - 1, bw = hw + 2, by = hY - 4;
      for (let i = 0; i < bw; i++) { put(g, bx + i, by + 1, i % 2 ? P.thatch : P.thatchL); put(g, bx + i, by + 2, i % 2 ? P.thatchD : P.thatch); }
      const fill = load === 3 ? [P.fish, P.fishD] : load === 1 ? [P.berry, P.green] : [P.ochre, P.yel];
      for (let i = 1; i < bw - 1; i++) put(g, bx + i, by, i % 2 ? fill[0] : fill[1]);
    }
  }
  return { g, tip, hit };
}

/** Lying down: asleep on a mat under a blanket, head on the left; or sick with a fever. */
function lyingGrid(l: Look, anim: number, f: number): Built {
  const st = l.stage, long = st === "adult" || st === "elder" || st === "teen" ? 10 : st === "child" ? 7 : 5;
  const g = grid(long + 8, 9), c = colors(l);
  const mat = "#cdb688", matD = "#a8925e", y = 6;
  /* a woven grass mat */
  for (let i = 0; i < long + 7; i++) { put(g, i, y + 1, i % 2 ? mat : shade(mat, 0.05)); put(g, i, y + 2, matD); }
  /* the head: a round face turned up, hair spread on the mat */
  const hx = 1, hy = y - 3;
  if (l.style !== "bald") { for (let i = 0; i < 4; i++) put(g, hx + i, hy - 1, c.hairC); put(g, hx - 1, hy, c.hairC); put(g, hx - 1, hy + 1, c.hairD); put(g, hx - 1, hy + 2, c.hairD); if (l.style === "long" || l.style === "wavy" || l.style === "braids") { put(g, hx - 2, hy + 2, c.hairC); put(g, hx - 2, hy + 3, c.hairD); } }
  rect(g, hx, hy, 4, 3, c.skin); put(g, hx, hy, c.skinL); put(g, hx + 3, hy + 2, c.skinD); put(g, hx + 3, hy, c.skinD);
  put(g, hx + 2, hy + 1, anim === Anim.Sick ? c.eye : c.skinD); put(g, hx + 1, hy + 1, anim === Anim.Sick ? c.eye : c.skinD);
  /* body under a blanket or fur, rising and falling with each breath, a stripe of the band's dye */
  const cover = anim === Anim.Sick ? "#d8d2c2" : l.wear === "furs" ? P.fur : l.top, breath = f % 2;
  for (let i = 0; i < long; i++) {
    const hump = i > 1 && i < long - 2 ? 1 : 0;
    for (let r = 0; r < 3 + hump; r++) {
      const yy = y - 2 - hump + r - (r === 0 && hump ? breath : 0);
      put(g, hx + 4 + i, yy, r === 0 ? shade(cover, -0.08) : r >= 2 + hump ? shade(cover, 0.12) : cover);
    }
    if (i % 4 === 2) put(g, hx + 4 + i, y - 1, l.trim);
  }
  put(g, hx + 4 + long - 1, y, shade(cover, 0.16));
  if (anim === Anim.Sick) { put(g, hx + 1, hy - 3, "#dfe9f0"); put(g, hx + 3, hy - 4, "#dfe9f0"); }
  return { g, tip: null, hit: null };
}

/* ---------------- far zooms ---------------- */

const tinyCache = new Map<string, HTMLCanvasElement>();
/** Small people for the zoomed-out map: "s" is 3x5, "m" is 5x8. */
export function tinySprite(l: Look, size: "s" | "m", f: number): HTMLCanvasElement {
  const key = `${l.id}|${l.stage}|${l.wear}|${size}|${f % 2}`;
  let cv = tinyCache.get(key);
  if (cv) return cv;
  if (tinyCache.size > 8000) tinyCache.clear();
  const c = colors(l), bare = l.wear === "loin", body = bare ? c.skin : c.top, leg = shade(bare ? c.skin : c.bot, 0.12);
  const small = l.stage === "child" || l.stage === "toddler" || l.stage === "baby";
  let g: Grid;
  if (size === "s") {
    g = grid(3, small ? 4 : 5); const o = small ? 1 : 0;
    put(g, 1, 0, c.hairC); put(g, 1, 1 - o, c.skin);
    if (!small) { put(g, 0, 2, body); put(g, 1, 2, body); put(g, 2, 2, c.topD); put(g, 1, 3, body); }
    else { put(g, 0, 1, body); put(g, 1, 1, body); put(g, 2, 1, c.topD); put(g, 1, 2, body); }
    const ly = small ? 3 : 4;
    if (f % 2) { put(g, 0, ly, leg); put(g, 2, ly, leg); } else put(g, 1, ly, leg);
  } else {
    g = grid(5, small ? 6 : 8);
    put(g, 1, 0, c.hairC); put(g, 2, 0, c.hairC); put(g, 3, 0, c.hairD);
    put(g, 1, 1, c.skin); put(g, 2, 1, c.skin); put(g, 3, 1, c.skinD);
    if (l.style === "long" || l.style === "braids" || l.style === "wavy" || l.style === "shaggy") { put(g, 0, 1, c.hairC); put(g, 4, 1, c.hairD); }
    if (l.style === "coils" || l.style === "puffs") { put(g, 0, 0, c.hairC); put(g, 4, 0, c.hairD); }
    const bh = small ? 2 : 3;
    for (let r = 0; r < bh; r++) for (let i = 0; i < 5; i++) { if ((i === 0 || i === 4) && r === bh - 1 && !small) { put(g, i, 2 + r, c.skin); continue; } put(g, i, 2 + r, i >= 3 ? c.topD : body); }
    const ly = 2 + bh;
    if (f % 2) { put(g, 1, ly, leg); put(g, 3, ly + 1, leg); put(g, 1, ly + 1, leg); }
    else { put(g, 1, ly, leg); put(g, 3, ly, leg); put(g, 1, ly + 1, leg); put(g, 3, ly + 1, leg); }
  }
  cv = toCanvas(size === "m" ? outlined(g, P.outline) : g);
  tinyCache.set(key, cv);
  return cv;
}

/* ---------------- picture bubbles ---------------- */

const ICONS: Record<number, { c: Record<string, string>; px: string[] }> = {
  1: { c: { a: "#9a2f45", b: "#6f9a44" }, px: ["..b..", ".a.a.", "aa.aa", ".a.a."] },                 /* berries */
  2: { c: { a: "#6ba5a3", b: "#2c6175" }, px: [".....", "aa.a.", "aaaab", "aa.a."] },                 /* fish */
  3: { c: { a: "#93673e", b: "#6c4b2c" }, px: ["b...b", ".b.b.", ".aaa.", "a.a.a"] },                 /* deer */
  4: { c: { a: "#e0485a", b: "#b03040" }, px: [".a.a.", "aaaab", ".aab.", "..b.."] },                 /* heart */
  5: { c: { a: "#d0402a" }, px: ["a.a.a", ".a.a.", "a.a.a", ".a.a."] },                              /* angry */
  6: { c: { a: "#ffdf7e", b: "#ef9a3c" }, px: ["a.a.a", ".bbb.", "abbba", ".bbb."] },                 /* sun: small talk */
  7: { c: { a: "#e2dccb", b: "#d9a277" }, px: [".bb..", ".bb..", "aaaa.", ".aaa."] },                 /* baby */
  8: { c: { a: "#ffdf7e", b: "#ef9a3c", d: "#cf4d2c" }, px: ["..a..", ".aba.", ".bdb.", "ddddd"] },    /* fire */
  9: { c: { a: "#6ba5d3", b: "#3f6fa8" }, px: ["..a..", ".aab.", "aaabb", ".abb."] },                 /* water drop */
  10: { c: { a: "#a8433a", b: "#f0e6d8" }, px: [".aaa.", "aaaab", ".aab.", "...bb"] },                /* meat */
  11: { c: { a: "#8ac0e8" }, px: ["a.a.a", ".aaa.", "aa.aa", ".aaa."] },                              /* cold */
  12: { c: { a: "#7a8da0", b: "#4f7fb8" }, px: [".aaa.", "aaaaa", ".b.b.", "b.b.."] },                /* sad: rain cloud */
  13: { c: { a: "#5e4f38" }, px: ["..a..", "...a.", "aaaaa", "...a."] },                              /* move: arrow */
  14: { c: { a: "#d0402a" }, px: ["..a..", "..a..", "..a..", "....."] },                              /* fear: ! (dot below added) */
  15: { c: { a: "#7a8da0" }, px: ["aaa..", ".a...", "aaa.a", "...a."] },                              /* zzz */
  16: { c: { a: "#e3ad2f", b: "#b5502a" }, px: ["..a..", "aaaaa", ".aba.", "a...a"] },                /* star: respect */
  17: { c: { a: "#5e4f38" }, px: [".aaa.", "...a.", "..a..", "....."] },                              /* question */
  18: { c: { a: "#8c8a84", b: "#5c5952" }, px: ["b...b", "aaaa.", "aaaaa", "a..a."] },                /* wolf */
  19: { c: { a: "#6e4a32", b: "#efe6d2" }, px: [".aaa.", "aaaaa", "aa.ab", "a.a.b"] },                /* mammoth */
  20: { c: { a: "#a47b52", b: "#5e4a2c" }, px: ["..a..", ".aba.", "aabaa", "aabaa"] },                /* home: tent */
  21: { c: { a: "#d9b45a", b: "#9a2f45", d: "#6f8a44" }, px: ["a...a", ".a.a.", "b.d.b", ".bdb."] },   /* gift: a string of beads */
  22: { c: { a: "#6f9a44", b: "#4e7a34", d: "#8a6a3a" }, px: ["..a.a", ".aba.", "a.b..", "..d.."] },   /* peace: a green sprig */
  23: { c: { a: "#a47b52", b: "#6e5442", d: "#d9a277" }, px: ["....d", "...d.", "abbba", ".aaa."] },   /* asking: an empty bowl held out */
  24: { c: { a: "#b5603a", b: "#7a3a22", d: "#d08a5a" }, px: ["a...a", ".dba.", ".aba.", "..b.."] },   /* a pot */
};
/** A speech bubble with a little picture, its tail pointing down at (x, y). Drawn at screen scale `k` (1 at true size). */
export function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, icon: number, k: number): void {
  const I = ICONS[icon]; if (!I) return;
  const u = Math.max(1, Math.round(k)), bx = Math.round(x - 4 * u), by = Math.round(y - 9 * u), ink = P.outline;
  const R = (px: number, py: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(bx + px * u, by + py * u, w * u, h * u); };
  R(0, 0, 9, 7, "#fffdf6"); R(-1, 1, 11, 5, "#fffdf6");
  R(0, -1, 9, 1, ink); R(0, 7, 9, 1, ink); R(-1, 0, 1, 1, ink); R(9, 0, 1, 1, ink); R(-2, 1, 1, 5, ink); R(10, 1, 1, 5, ink); R(-1, 6, 1, 1, ink); R(9, 6, 1, 1, ink);
  R(3, 7, 2, 1, "#fffdf6"); R(2, 7, 1, 1, ink); R(5, 7, 1, 1, ink); R(3, 8, 2, 1, ink);
  I.px.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== ".") R(2 + i, 1 + j, 1, 1, I.c[ch]); }));
  if (icon === 14) R(4, 5, 1, 1, I.c.a);
}
