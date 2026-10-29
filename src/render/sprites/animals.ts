import { FN, shade } from "../../shared/palette.ts";
import { Species } from "../../shared/types.ts";
import { grid, put, rect, hline, outlined, toCanvas, SpriteCache, type Grid } from "./grid.ts";

/*
  Wildlife, side view, at the same 8-pixels-per-tile scale as trees and people; the goats,
  sheep, boar and dogs people come to keep are drawn the same way, at pens and in the fields.
  Frames: 0-1 grazing (head down / up), 2-5 walking or running.
*/

function legs(g: Grid, xs: number[], y: number, h: number, c: string, d: string, f: number, run: boolean) {
  xs.forEach((x, i) => {
    const phase = (i + (f % 2)) % 2, dx = run ? (phase ? 1 : -1) : (phase ? 1 : 0);
    for (let k = 0; k < h; k++) put(g, x + (k === h - 1 ? dx : 0), y + k, i % 2 ? d : c);
  });
}

function build(sp: number, f: number, winter: boolean): HTMLCanvasElement {
  const walking = f >= 2, run = f >= 4, grazing = f === 0;
  let g: Grid;
  switch (sp) {
    case Species.Deer: {
      const c = winter ? shade(FN.deer, 0.05) : FN.deer, d = FN.deerD, l = shade(c, -0.1);
      g = grid(11, 10); rect(g, 2, 4, 6, 3, c); hline(g, 3, 4, 4, l); hline(g, 2, 6, 6, d); put(g, 1, 4, "#e6dccb");
      if (grazing && !walking) { rect(g, 8, 6, 2, 2, c); put(g, 9, 8, d); put(g, 8, 5, c); }
      else { rect(g, 8, 2, 2, 2, c); put(g, 8, 4, c); put(g, 10, 3, d); put(g, 9, 2, FN.outline); put(g, 8, 0, d); put(g, 8, 1, d); put(g, 10, 0, d); put(g, 9, 1, d); }
      legs(g, [2, 3, 6, 7], 7, 3, c, d, f, run); break;
    }
    case Species.Horse: {
      const c = FN.horse, d = shade(c, 0.15), mane = "#3a2a1e";
      g = grid(12, 10); rect(g, 2, 3, 7, 3, c); hline(g, 2, 5, 7, d); hline(g, 3, 3, 5, shade(c, -0.08)); put(g, 1, 3, mane); put(g, 1, 4, mane);
      if (grazing && !walking) { rect(g, 9, 5, 2, 2, c); put(g, 10, 7, d); put(g, 9, 4, mane); }
      else { rect(g, 9, 1, 2, 3, c); put(g, 11, 2, d); put(g, 9, 0, mane); put(g, 8, 2, mane); put(g, 10, 1, FN.outline); }
      legs(g, [2, 3, 7, 8], 6, 4, c, d, f, run); break;
    }
    case Species.Aurochs: {
      const c = FN.aurochs, d = shade(c, 0.12), l = shade(c, -0.12), horn = "#e8e0cc";
      g = grid(13, 10); rect(g, 2, 3, 8, 4, c); hline(g, 3, 3, 6, l); hline(g, 2, 6, 8, d); rect(g, 2, 2, 3, 1, c);
      const hy = grazing && !walking ? 5 : 3; rect(g, 10, hy, 2, 3, c); put(g, 12, hy + 1, d); put(g, 10, hy - 1, horn); put(g, 11, hy - 2, horn); put(g, 11, hy + 1, FN.outline);
      legs(g, [3, 4, 8, 9], 7, 3, c, d, f, run); break;
    }
    case Species.Mammoth: {
      const c = FN.mammoth, d = shade(c, 0.12), l = shade(c, -0.12), tusk = "#efe6d2";
      g = grid(17, 14); rect(g, 2, 2, 11, 7, c); for (let x = 3; x < 12; x++) put(g, x, 1, x < 8 ? l : c); hline(g, 2, 8, 11, d);
      for (let x = 2; x < 13; x += 2) put(g, x, 9, d);   /* shaggy fringe */
      rect(g, 12, 2, 3, 4, c); put(g, 14, 3, FN.outline);
      const tr = grazing && !walking ? 0 : 1; for (let k = 0; k < 5; k++) put(g, 15 - (k > 2 && tr ? 1 : 0), 5 + k, d);
      put(g, 13, 6, tusk); put(g, 14, 7, tusk); put(g, 15, 7, tusk); put(g, 16, 6, tusk);
      legs(g, [3, 4, 10, 11], 9, 4, c, d, f, false); rect(g, 3, 9, 2, 3, c); rect(g, 10, 9, 2, 3, c); break;
    }
    case Species.Wolf: {
      const c = winter ? "#bdbab4" : FN.wolf, d = shade(c, 0.15), l = shade(c, -0.1);
      g = grid(11, 7); rect(g, 2, 2, 6, 2, c); hline(g, 3, 2, 4, l); hline(g, 2, 3, 6, d); put(g, 1, 2, c); put(g, 0, 1 + (f % 2), c);
      rect(g, 8, 1, 2, 2, c); put(g, 10, 2, d); put(g, 8, 0, d); put(g, 9, 0, d); put(g, 9, 1, FN.outline);
      legs(g, [2, 3, 6, 7], 4, 3, c, d, f, run); break;
    }
    case Species.Goat: {
      /* a short body, a beard, horns swept back */
      const c = winter ? "#b8ad98" : "#a89272", d = shade(c, 0.15), l = shade(c, -0.12), horn = "#5a4a3a";
      g = grid(10, 8); rect(g, 2, 3, 5, 3, c); hline(g, 3, 3, 3, l); hline(g, 2, 5, 5, d); put(g, 1, 3, d);
      const hy = grazing && !walking ? 4 : 2; rect(g, 7, hy, 2, 2, c); put(g, 9, hy + 1, d); put(g, 8, hy + 2, d); put(g, 8, hy - 1, horn); put(g, 7, hy - 2, horn); put(g, 8, hy, FN.outline);
      legs(g, [2, 3, 5, 6], 6, 2, c, d, f, run); break;
    }
    case Species.Sheep: {
      /* a woolly oval on dark legs, a dark face */
      const c = winter ? "#efeae0" : "#e4dccb", d = shade(c, -0.12), face = "#3e342c";
      g = grid(10, 8); rect(g, 2, 2, 6, 4, c); hline(g, 3, 2, 4, "#f6f2ea"); hline(g, 2, 5, 6, d); put(g, 1, 3, c); put(g, 1, 4, d);
      const hy = grazing && !walking ? 4 : 2; rect(g, 8, hy, 2, 2, face); put(g, 9, hy, "#5a4e44"); put(g, 8, hy - 1, c);
      legs(g, [2, 3, 6, 7], 6, 2, face, face, f, run); break;
    }
    case Species.Boar: {
      /* dark, humped at the shoulder, a pale tusk */
      const c = "#4a3a2e", d = shade(c, 0.18), l = shade(c, -0.15), tusk = "#efe6d2";
      g = grid(11, 8); rect(g, 2, 3, 6, 3, c); rect(g, 4, 2, 3, 1, c); hline(g, 2, 5, 6, d); hline(g, 4, 2, 2, l); put(g, 1, 4, d);
      const hy = grazing && !walking ? 5 : 4; rect(g, 8, hy - 1, 3, 2, c); put(g, 10, hy, d); put(g, 10, hy + 1, tusk); put(g, 9, hy - 1, FN.outline); put(g, 8, hy - 2, c);
      legs(g, [2, 3, 6, 7], 6, 2, c, d, f, run); break;
    }
    case Species.Dog: {
      /* smaller than a wolf, tail up, ears pricked */
      const c = winter ? "#c8b89a" : "#b89c74", d = shade(c, 0.15), l = shade(c, -0.1);
      g = grid(10, 7); rect(g, 2, 3, 5, 2, c); hline(g, 3, 3, 3, l); hline(g, 2, 4, 5, d); put(g, 1, 2, c); put(g, 0, 1, c);
      rect(g, 7, 2, 2, 2, c); put(g, 9, 3, d); put(g, 7, 1, d); put(g, 8, 1, d); put(g, 8, 2, FN.outline);
      legs(g, [2, 3, 5, 6], 5, 2, c, d, f, run); break;
    }
    default: {   /* bear */
      const c = FN.bear, d = shade(c, 0.12), l = shade(c, -0.12);
      g = grid(13, 9); rect(g, 2, 2, 8, 4, c); hline(g, 3, 2, 6, l); hline(g, 2, 5, 8, d); rect(g, 4, 1, 3, 1, c);
      const hy = grazing && !walking ? 4 : 2; rect(g, 10, hy, 2, 3, c); put(g, 12, hy + 1, d); put(g, 10, hy - 1, c); put(g, 11, hy, FN.outline);
      legs(g, [2, 3, 8, 9], 6, 3, c, d, f, false);
    }
  }
  return toCanvas(outlined(g), { w: g.w - 2, dy: 0 });
}

const cache = new SpriteCache();
export function animalSprite(sp: number, frame: number, winter: boolean): HTMLCanvasElement {
  return cache.get(`${sp}|${frame}|${winter ? 1 : 0}`, () => build(sp, frame, winter));
}
/** Map dot colors for far zooms. */
export const ANIMAL_DOT = ["#a8784a", "#3a2a20", "#5e3e2a", "#b08a5a", "#9a9890", "#4a3020", "#a89272", "#e4dccb", "#4a3a2e", "#b89c74"];

/*
  Birds and small game, tiny on purpose. Flying birds are seen from above, wings up in
  one frame and down in the next; resting birds and rabbits are seen from the side.
*/
function buildBird(kind: number, frame: number, resting: boolean): HTMLCanvasElement {
  let g: Grid;
  if (kind === 0) {   /* goose: grey-brown body, black neck, white cheek */
    const c = "#8c8274", d = "#6a6256", neck = "#26221e";
    if (resting) { g = grid(6, 4); rect(g, 0, 2, 4, 2, c); hline(g, 0, 3, 4, d); put(g, 4, 1, neck); put(g, 4, 0, neck); put(g, 5, 0, "#d8a040"); put(g, 4, 2, neck); if (frame) { put(g, 4, 0, null); put(g, 5, 2, neck); put(g, 5, 1, null); } }
    else { g = grid(7, 4); hline(g, 2, 2, 3, c); put(g, 5, 2, neck); put(g, 6, 2, neck); put(g, 1, 2, d);
      if (frame) { put(g, 1, 0, c); put(g, 2, 1, c); put(g, 5, 0, c); put(g, 4, 1, c); } else { put(g, 0, 3, d); put(g, 1, 3, c); put(g, 2, 3, c); put(g, 4, 3, c); put(g, 5, 3, c); put(g, 6, 3, d); } }
  } else if (kind === 1) {   /* finches and crows: a dark flicker */
    const c = "#3a3430";
    if (resting) { g = grid(3, 2); put(g, 0, 1, c); put(g, 1, 1, c); put(g, frame ? 2 : 1, frame ? 1 : 0, c); }
    else { g = grid(5, 3); put(g, 2, 1, c); if (frame) { put(g, 1, 0, c); put(g, 0, 0, c); put(g, 3, 0, c); put(g, 4, 0, c); } else { put(g, 1, 1, c); put(g, 3, 1, c); put(g, 0, 2, c); put(g, 4, 2, c); } }
  } else {   /* gull: white with grey wingtips */
    const c = "#f2f0ea", t = "#8a8e94";
    if (resting) { g = grid(5, 3); rect(g, 0, 1, 4, 2, c); put(g, 0, 1, t); put(g, 4, 0, c); put(g, 4, 1, "#e0a030"); }
    else { g = grid(9, 3); put(g, 4, 1, c); put(g, 4, 2, c);
      if (frame) { put(g, 3, 1, c); put(g, 2, 0, c); put(g, 1, 0, c); put(g, 0, 1, t); put(g, 5, 1, c); put(g, 6, 0, c); put(g, 7, 0, c); put(g, 8, 1, t); }
      else { put(g, 3, 1, c); put(g, 2, 1, c); put(g, 1, 2, c); put(g, 0, 2, t); put(g, 5, 1, c); put(g, 6, 1, c); put(g, 7, 2, c); put(g, 8, 2, t); } }
  }
  return toCanvas(kind === 1 ? g : outlined(g, "#2a2622"));
}
export function birdSprite(kind: number, frame: number, resting: boolean): HTMLCanvasElement {
  return cache.get(`b${kind}|${frame}|${resting ? 1 : 0}`, () => buildBird(kind, frame, resting));
}
/** A rabbit (frame 0 sitting, 1 mid-hop); hares in the cold turn white for winter. */
export function rabbitSprite(frame: number, white: boolean): HTMLCanvasElement {
  return cache.get(`r${frame}|${white ? 1 : 0}`, () => {
    const c = white ? "#eeeeea" : "#9a7a58", d = white ? "#c8ccd0" : "#76593e", tail = "#f6f4ee";
    let g: Grid;
    if (frame === 0) { g = grid(5, 4); rect(g, 0, 2, 3, 2, c); hline(g, 0, 3, 3, d); rect(g, 3, 1, 2, 2, c); put(g, 3, 0, c); put(g, 4, 0, d); put(g, 4, 1, "#2a2420"); put(g, 0, 2, tail); }
    else { g = grid(6, 3); rect(g, 1, 1, 3, 1, c); hline(g, 0, 2, 2, d); put(g, 4, 2, d); put(g, 5, 2, d); rect(g, 4, 0, 2, 2, c); put(g, 4, 0, c); put(g, 5, 1, "#2a2420"); put(g, 0, 1, tail); }
    return toCanvas(outlined(g, "#2e2620"));
  });
}
