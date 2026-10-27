import { DAY_SECONDS } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { Mem, Place, type Person } from "./person.ts";
import type { Band } from "./band.ts";
import type { Society } from "./society.ts";
import { close } from "./feuds.ts";

/*
  Friends and kin beyond the band. People keep up ties with the bands their kin married
  into and with friends they made at meetings: every so often they walk over to visit,
  bringing a gift (beads, ochre, a good blade), and come home with news of where the food
  is. Gifts are remembered and returned, the way hunter-gatherers have kept up gift
  partnerships across long distances, and when times are hard at home a family goes to
  live where it has friends.
*/

/** Someone in another band worth the walk to see: close kin, or a good friend, whose camp they know. */
export function visitTarget(s: Society, p: Person): { q: Person; band: Band; w: number; kin: boolean } | null {
  const home = s.band(p);
  let best: { q: Person; band: Band; w: number; kin: boolean } | null = null;
  for (const [id, r] of p.rel) {
    const q = s.byId.get(id);
    if (!q || q.band === p.band || s.age(q) < 12 || q.carrier) continue;
    const kin = close(s, p, q);
    if (!kin && (r.op < 0.45 || r.fam < 0.3)) continue;
    const b = s.bandById.get(q.band); if (!b || b.moving) continue;
    /* they need to know where that band camps now */
    if (!p.places.some(pl => pl.k === Place.Camp && pl.ref === b.id && Math.hypot(pl.x - b.x, pl.y - b.y) < 12)) continue;
    const d = Math.hypot(b.x - home.x, b.y - home.y); if (d > 85 || !s.walkable(home.x, home.y, b.x, b.y)) continue;
    /* a gift received and not yet returned weighs on a person */
    const owes = q.mem.some(m => m.k === Mem.Gift && m.who === p.id) ? 0 : p.mem.some(m => m.k === Mem.Gift && m.who === q.id) ? 0.25 : 0;
    const w = (kin ? 0.6 : 0.2) + r.op * 0.5 + owes - d / 200 + Math.min(1, (s.time - r.seen) / (DAY_SECONDS * 30)) * 0.3;
    if (!best || w > best.w) best = { q, band: b, w, kin };
  }
  return best && best.w > 0.2 ? best : null;
}

const GIFTS = ["a string of shell beads", "a carved bone pendant", "a pouch of red ochre", "a fine flint blade", "a fox-fur collar", "a bundle of eagle feathers", "a necklace of teeth", "a bag of sweet roots"];

/** A gift handed over on a visit: warmth both ways, remembered, and something to return one day. */
export function gift(s: Society, from: Person, to: Person): void {
  const item = GIFTS[(from.id * 7 + to.id * 3 + Math.floor(s.time / DAY_SECONDS)) % GIFTS.length];
  const rf = s.rel(from, to.id), rt = s.rel(to, from.id);
  rf.op = Math.min(1, rf.op + 0.08); rt.op = Math.min(1, rt.op + 0.14); rf.fam = Math.min(1, rf.fam + 0.08); rt.fam = Math.min(1, rt.fam + 0.08);
  /* a gift returned settles the one before it */
  from.mem = from.mem.filter(m => !(m.k === Mem.Gift && m.who === to.id));
  s.remember(to, Mem.Gift, from.id, 0.35);
  from.visitedAt = s.time;
  s.stats.social.gifts++;
  s.bubble(from, Bubble.Gift, 2.5); s.bubble(to, Bubble.Heart, 2);
  const a = s.band(from), b = s.band(to);
  if (a === b) return;
  /* the first gift between two bands is worth telling; between two peoples, more so */
  const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  if (s.giftPairs.has(key)) return;
  s.giftPairs.add(key);
  const peoples = a.culture !== b.culture;
  s.event("gift", Bubble.Gift, `${from.name} of the ${a.name} walked over to the ${b.name} to see ${to.name}, bringing ${item}.${peoples ? ` Gifts are passing between the ${s.cultures[a.culture].lang.name} and the ${s.cultures[b.culture].lang.name}.` : ""}`, to.x, to.y, [from.id, to.id], b.id, peoples ? 1 : 0);
}
