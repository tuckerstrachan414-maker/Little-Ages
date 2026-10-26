import { FN, shade } from "../../shared/palette.ts";
import { hash2 } from "../../shared/rng.ts";
import { grid, put, rect, hline, outlined, toCanvas, SpriteCache } from "./grid.ts";

/*
  Camps: the fire everyone gathers at, a shelter for each household in the style of the
  band's culture (hide tents, branch lean-tos, domed huts of poles and grass), the woodpile
  and the food store. Snow settles on roofs in winter. All at 8 pixels per tile.
*/

const cache = new SpriteCache();
const C = { hide: "#a47b52", hideD: "#7d5a3a", hideL: "#c19a6c", pole: "#6b4a2c", poleL: "#8a6040", grass: "#b8a05a", grassD: "#8f7a3e", grassL: "#d2bd78", snow: "#eef1ec", snowD: "#cfd6d2", dark: "#2e2620" };

/** A ring of stones with logs; flames when lit (four frames), embers when low, ash when out. */
export function fireSprite(frame: number, fuel: number): HTMLCanvasElement {
  const level = fuel <= 0.02 ? 0 : fuel < 0.25 ? 1 : 2;
  return cache.get(`fire${level}|${frame & 3}`, () => {
    const g = grid(15, 14), cx = 7, by = 11;
    /* a ring of stones, lit on the top left */
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, x = Math.round(cx + Math.cos(a) * 5.5), y = Math.round(by + Math.sin(a) * 2.2); put(g, x, y, Math.sin(a) > 0.2 ? FN.rockD : Math.cos(a) < -0.3 ? FN.rockL : FN.stone); put(g, x + 1, y, Math.sin(a) > 0.2 ? FN.rockD : FN.stone); }
    /* crossed logs */
    hline(g, cx - 3, by, 7, FN.trunkD); hline(g, cx - 2, by - 1, 5, FN.trunk); put(g, cx - 3, by - 1, FN.woodL); put(g, cx + 3, by + 1, FN.trunkD);
    if (level === 0) { put(g, cx, by - 1, "#6a645c"); put(g, cx - 1, by, "#57524c"); put(g, cx + 1, by - 1, "#7a746a"); return toCanvas(outlined(g)); }
    /* flames: a hot core with tongues that lick up and flicker */
    const tongues = [[0, 4, 7, 3, 5], [0, 3, 6, 5, 4], [0, 5, 8, 4, 3], [0, 4, 5, 6, 4]][frame & 3];
    const scale = level === 1 ? 0.45 : 1;
    [-2, -1, 0, 1, 2].forEach((dx, i) => {
      const h = Math.max(1, Math.round(tongues[i] * scale * (i === 0 ? 0.6 : 1)) + (dx === 0 ? 1 : 0));
      for (let y = 0; y < h; y++) put(g, cx + dx + (y > 3 && frame % 2 ? (dx < 0 ? -1 : 1) * (y > 5 ? 1 : 0) : 0), by - 1 - y, y < h * 0.35 ? "#cf4d2c" : y < h * 0.7 ? FN.fire : FN.fireL);
    });
    put(g, cx, by - 2, FN.fireL); put(g, cx - 1, by - 1, FN.fireL);
    return toCanvas(outlined(g, "#3a1e14"));
  });
}

/** A household's shelter. `v` varies the look within a culture's style. */
export function shelterSprite(kind: "tent" | "leanto" | "dome", v: number, snow: boolean): HTMLCanvasElement {
  return cache.get(`sh${kind}|${v % 4}|${snow ? 1 : 0}`, () => {
    let g;
    if (kind === "tent") {
      /* a cone of sewn hides over poles, the seams showing, door flap on the lit side */
      g = grid(21, 22); const cx = 10, base = 20, H = 18;
      for (let y = 0; y <= H; y++) {
        const half = Math.floor(y * 0.56);
        for (let x = -half; x <= half; x++) {
          let col = x >= half - 1 ? C.hideD : x <= -half + 1 ? C.hideL : C.hide;
          if ((x + 40 + Math.floor(y / 2)) % 5 === 0 && y > 2) col = shade(col, 0.07);
          if (y % 6 === 5 && x % 2 === 0) col = shade(col, 0.1);
          put(g, cx + x, base - H + y, col);
        }
      }
      for (const dx of [-2, -1, 1, 2]) put(g, cx + dx, base - H - 1 - Math.abs(dx) % 2, C.pole);
      put(g, cx, base - H, C.pole);
      rect(g, cx - 1, base - 5, 3, 5, C.dark); put(g, cx + 2, base - 5, C.hideD); put(g, cx + 2, base - 4, C.hideL); put(g, cx + 3, base - 3, C.hideL);
      if (v % 2) for (let y = 4; y < H; y += 4) { put(g, cx + Math.floor(y * 0.25), base - H + y, "#a5503c"); put(g, cx - Math.floor(y * 0.25), base - H + y, "#a5503c"); }
      else for (let x = -6; x <= 6; x += 2) put(g, cx + x, base - 6, "#3d3631");
      if (snow) for (let y = 1; y <= 10; y++) { const half = Math.floor(y * 0.56); for (let x = -half; x <= half - 1; x++) if ((x + y) % 2 === 0 || y < 4) put(g, cx + x, base - H + y, y < 4 ? C.snow : C.snowD); }
    } else if (kind === "leanto") {
      /* seen from the open side: two forked posts hold a ridge pole; leafy branches slope back
         from it to the ground (up the screen), with the shaded space underneath */
      g = grid(22, 17); const by = 15, ridge = 8;
      const leaf = ["#6f8f44", "#5c7a3a", "#86a454", "#8f7a3e"];
      /* the roof slope, narrowing as it goes back, ragged at the top */
      for (let y = 0; y < ridge; y++) {
        const inset = Math.floor((ridge - y) * 0.45), x0 = 2 + inset, x1 = 19 - inset;
        for (let x = x0; x <= x1; x++) {
          if (y === 0 && (x + v) % 3 === 0) continue;
          const lit = x < x0 + 2 || y < 2;
          put(g, x, y + 1, lit ? leaf[2] : (x * 3 + y * 5 + v) % 7 === 0 ? leaf[3] : (x + y) % 4 === 0 ? leaf[1] : leaf[0]);
        }
      }
      /* the open front: dark shelter inside, the floor edge, posts and ridge pole */
      for (let y = ridge + 1; y <= by; y++) for (let x = 2; x <= 19; x++) put(g, x, y, y >= by - 1 ? "#4a3a2c" : C.dark);
      for (let x = 3; x <= 18; x += 3) put(g, x, ridge + 1, leaf[1]);
      for (let y = ridge - 1; y <= by; y++) { put(g, 1, y, C.pole); put(g, 20, y, C.pole); }
      put(g, 0, ridge - 2, C.pole); put(g, 2, ridge - 2, C.pole); put(g, 19, ridge - 2, C.pole); put(g, 21, ridge - 2, C.pole);
      for (let x = 1; x <= 20; x++) put(g, x, ridge, x % 2 ? C.poleL : C.pole);
      rect(g, 6, by - 1, 6, 1, "#cdb688");
      if (snow) for (let y = 0; y < ridge; y++) { const inset = Math.floor((ridge - y) * 0.45); for (let x = 2 + inset; x <= 19 - inset; x++) if (y < 3 || (x + y) % 2 === 0) put(g, x, y + 1, y < 3 ? C.snow : C.snowD); }
    } else {
      /* a dome of bent poles thatched with grass in overlapping rows */
      g = grid(21, 15); const cx = 10, by = 13, R = 9, H = 12;
      for (let y = 0; y < H; y++) {
        const half = Math.round(Math.sqrt(Math.max(0, 1 - ((H - 1 - y) / (H - 0.5)) ** 2)) * R);
        for (let x = -half; x <= half; x++) {
          let col = x >= half - 1 ? C.grassD : x <= -half + 1 && y < H - 3 ? C.grassL : C.grass;
          if (y % 3 === 2) col = shade(col, 0.1); else if ((x * 2 + y + v) % 6 === 0) col = C.grassL;
          put(g, cx + x, by - H + 1 + y, col);
        }
      }
      rect(g, cx - 2, by - 3, 4, 4, C.dark); hline(g, cx - 3, by - 4, 6, C.pole); put(g, cx - 3, by - 3, C.pole); put(g, cx + 2, by - 3, C.pole);
      if (snow) for (let y = 0; y < 6; y++) { const half = Math.round(Math.sqrt(Math.max(0, 1 - ((H - 1 - y) / (H - 0.5)) ** 2)) * R); for (let x = -half; x <= half; x++) if (y < 3 || (x + y) % 2 === 0) put(g, cx + x, by - H + 1 + y, y < 3 ? C.snow : C.snowD); }
    }
    return toCanvas(outlined(g), { w: Math.round(g.w * 0.9), dy: 0 });
  });
}

/** The food store: baskets of plant food, a rack of meat and fish, sized by how much there is. */
export function storeSprite(plant: number, meat: number): HTMLCanvasElement {
  const pb = plant <= 0.5 ? 0 : plant < 15 ? 1 : plant < 60 ? 2 : 3, mb = meat <= 0.5 ? 0 : meat < 20 ? 1 : 2;
  return cache.get(`store${pb}|${mb}`, () => {
    const g = grid(12, 8);
    for (let k = 0; k < pb; k++) { const x = k * 3; rect(g, x, 5, 3, 2, C.grass); hline(g, x, 4, 3, k % 2 ? "#9a2f45" : "#c49e40"); put(g, x + 2, 6, C.grassD); }
    if (mb) { put(g, 9, 1, C.pole); put(g, 9, 2, C.pole); put(g, 9, 3, C.pole); put(g, 9, 4, C.pole); put(g, 9, 5, C.pole); put(g, 9, 6, C.pole); hline(g, 7, 1, 5, C.poleL); put(g, 8, 2, "#a8433a"); put(g, 8, 3, "#cf6a52"); if (mb > 1) { put(g, 10, 2, "#a8433a"); put(g, 10, 3, "#a8433a"); put(g, 11, 2, "#9fb6be"); } }
    return toCanvas(outlined(g));
  });
}
export function woodpileSprite(n: number): HTMLCanvasElement {
  const lv = n < 1 ? 0 : n < 4 ? 1 : 2;
  return cache.get(`wood${lv}`, () => {
    const g = grid(7, 4);
    if (lv) { hline(g, 0, 3, 7, FN.trunkD); hline(g, 1, 2, 5, FN.trunk); if (lv > 1) hline(g, 2, 1, 3, FN.trunkD); put(g, 0, 3, FN.woodL); put(g, 6, 3, FN.woodL); }
    return toCanvas(lv ? outlined(g) : g);
  });
}
/** Little variation for a shelter, from its position. */
export const shelterVariant = (x: number, y: number) => Math.floor(hash2(Math.floor(x * 4), Math.floor(y * 4), 9) * 4);
