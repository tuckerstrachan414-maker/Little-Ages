import type { Wildlife } from "./wildlife.ts";
import type { Ecology } from "./ecology.ts";
import { DAY_SECONDS, DAYS_PER_SEASON } from "../shared/types.ts";

/*
  A new world's animals are scattered by chance, not by what the land can feed. Before the
  first morning, the wild lives a few years in fast-forward (coarse steps, nothing drawn) so
  herds spread to good pasture, packs find their territories and numbers settle where the
  land holds them. It starts and ends at the beginning of summer.
*/
export function settle(wild: Wildlife, eco: Ecology, years: number, progress: (p: number) => void): void {
  const dt = 4, days = years * 4 * DAYS_PER_SEASON, start = DAYS_PER_SEASON;   /* day 10 is the first day of summer */
  let lastDay = -1;
  for (let t = 0; t < days * DAY_SECONDS; t += dt) {
    const day = start + Math.floor(t / DAY_SECONDS), season = Math.floor(day / DAYS_PER_SEASON) % 4;
    wild.update(dt, season, -1 - day);   /* negative day numbers never collide with the real calendar */
    if (day !== lastDay) { lastDay = day; eco.daily(season); if ((day & 7) === 0) progress((day - start) / days); }
  }
  progress(1);
}
