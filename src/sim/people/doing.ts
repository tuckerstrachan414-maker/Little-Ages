import { Species, Flag, DAY_SECONDS } from "../../shared/types.ts";
import { Anim, Bubble } from "../../shared/people.ts";
import { Food, Goal, Mem, Place, St, Skill, YEAR, step, type Person, type Step } from "./person.ts";
import { MEAT, type Society } from "./society.ts";
import { HUNT_P, DANGER, SPECIES_SHORT, attraction, she, unhappy } from "./mind.ts";
import { deposit, answer, eat, hearthOf, pass } from "./sharing.ts";
import { endFight, talkRound, grievance } from "./feuds.ts";
import { mock } from "./leaders.ts";
import { gift } from "./friends.ts";
import { storeFood, homeOf } from "./band.ts";
import { IDEAS, Idea, knows, practice, inspire, inUse, learn, ready, shown, tellIdea, riverAt, rootsAt } from "./ideas.ts";
import { Work, emptyWeir, buildWeir, sow, resow, seedLine, cropAt, workById, worksAround } from "./works.ts";
import { raise, digPit, storeInPit, fetchFromPit, pitOf } from "./homes.ts";

/*
  Doing things. Each plan is a list of steps (walk there, gather, walk back, put it in the
  store); this carries out the current step a little each tick and moves on when it is
  done. Walking follows routes around water; work takes time and draws on what the land
  actually holds; talking changes what two people think of each other and what they know.
*/

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Drops whatever someone was doing. */
export function abandon(_s: Society, p: Person): void {
  p.plan = []; p.si = 0; p.path = null; p.pi = 0; p.party = 0; p.goal = Goal.None;
}
function next(p: Person): void { p.si++; p.path = null; p.pi = 0; }
/** Gives up on a plan that cannot go on, and waits a moment before deciding again. */
function fail(s: Society, p: Person, why?: string): void {
  abandon(s, p);
  p.plan = [step(St.Wait, p.x, p.y, 0, 1.5)];
  if (why) { p.why = why; p.whyAt = s.time; }
}

export function doStep(s: Society, p: Person, dt: number): void {
  const st = p.plan[p.si];
  if (!st) { p.anim = p.baby && s.byId.get(p.baby)?.carrier === p.id ? Anim.HoldBaby : Anim.Idle; return; }
  switch (st.k) {
    case St.Go: go(s, p, st, dt); break;
    case St.Gather: work(s, p, st, dt, s.season === 3 || s.season === 0 ? Anim.Dig : Anim.Gather); break;
    case St.Fish: work(s, p, st, dt, Anim.Fish); break;
    case St.Snare: work(s, p, st, dt, Anim.Dig); break;
    case St.Stalk: stalk(s, p, st, dt); break;
    case St.Butcher: work(s, p, st, dt, Anim.Butcher); break;
    case St.Wood: work(s, p, st, dt, Anim.Chop); break;
    case St.Drop: drop(s, p); next(p); break;
    case St.Eat: work(s, p, st, dt, Anim.Eat); break;
    case St.Drink: work(s, p, st, dt, Anim.Drink); break;
    case St.Cook: work(s, p, st, dt, Anim.Cook); break;
    case St.Sleep: {
      p.anim = Anim.Sleep; st.t += dt;
      if ((p.rest > 0.97 && s.sun > 0.25) || st.t > st.dur * (s.sun < 0.12 ? 3 : 1)) next(p);
      break;
    }
    case St.Sit: {
      st.t += dt;
      p.anim = st.a === 1 ? Anim.Sick : p.baby && s.byId.get(p.baby)?.carrier === p.id ? Anim.HoldBaby : Anim.Sit;
      faceFire(s, p);
      if (st.t >= st.dur || (st.a === 2 && p.warmth > 0.9)) next(p);
      break;
    }
    case St.Talk: talk(s, p, st, dt); break;
    case St.Play: play(s, p, st, dt); break;
    case St.Follow: follow(s, p, st, dt); break;
    case St.Look: work(s, p, st, dt, Anim.Wave); break;
    case St.Craft: work(s, p, st, dt, Anim.Sew); break;
    case St.Knap: work(s, p, st, dt, Anim.Knap); break;
    case St.Tend: tend(s, p, st, dt); break;
    case St.Wait: case St.Feed: p.anim = Anim.Idle; st.t += dt; if (st.t >= st.dur) next(p); break;
    case St.Ask: ask(s, p, st, dt); break;
    case St.Fight: fight(s, p, st, dt); break;
    case St.Kindle: work(s, p, st, dt, Anim.Knap); break;
    case St.Ember: work(s, p, st, dt, Anim.Wave); break;
    case St.Dry: work(s, p, st, dt, Anim.Butcher); break;
    case St.Build: work(s, p, st, dt, Anim.Chop); break;
    case St.Sow: work(s, p, st, dt, Anim.Dig); break;
    case St.Raise: work(s, p, st, dt, Anim.Build); break;
    case St.Pit: work(s, p, st, dt, Anim.Dig); break;
    case St.Store: work(s, p, st, dt, Anim.Gather); break;
    case St.Fetch: work(s, p, st, dt, Anim.Dig); break;
  }
}

/* ---------------- walking ---------------- */

export function speedOf(s: Society, p: Person, run: boolean): number {
  const age = s.age(p);
  let v = age < 4 ? 0.75 : age < 10 ? 1.2 : age < 60 ? 1.5 : age < 70 ? 1.2 : 0.9;
  v *= 1 - p.injury * 0.5;
  if (p.carryAmt > 3) v *= 0.85;
  if (p.pregnantBy && s.time > p.due - YEAR * 0.25) v *= 0.85;
  if (s.sun < 0.15) v *= 0.85;
  return run ? v * 1.9 : v;
}

function go(s: Society, p: Person, st: Step, dt: number): void {
  const target = st.id ? s.byId.get(st.id) : null;
  if (st.id && !target) { next(p); return; }
  let tx = st.x, ty = st.y;
  if (target) { tx = target.x; ty = target.y; if (Math.hypot(tx - p.x, ty - p.y) < 1.4) { next(p); return; } }
  if (!p.path || (target && st.t > 2)) {
    st.t = 0;
    const b = s.band(p);
    if (st.a === 1 && b.moving?.route) {
      /* the band walks one route together: join it at the nearest point ahead, then follow it */
      const r = b.moving.route;
      let k0 = 0, bd = Math.hypot(p.x - b.x, p.y - b.y);
      for (let k = 0; k < r.length; k += 2) { const d = Math.hypot(r[k] - p.x, r[k + 1] - p.y); if (d < bd) { bd = d; k0 = k + 2; } }
      const join = k0 === 0 ? [b.x, b.y] : [r[k0 - 2], r[k0 - 1]];
      const lead = bd > 3 ? s.walker.route(p.x, p.y, join[0], join[1]) : [];
      /* no way onto the band's track from here: find their own way to the new camp */
      p.path = lead ? [...lead, ...r.slice(k0), tx, ty] : s.walker.route(p.x, p.y, tx, ty, 40000);
    } else {
      /* the way home may be long (round a lake that thawed under them): for that, search as far as it takes */
      const home = Math.hypot(tx - b.x, ty - b.y) < 8;
      p.path = s.walker.route(p.x, p.y, tx, ty, home ? 40000 : 9000, home);
      if (!p.path && home && s.walker.reach(p.x, p.y, tx, ty)) p.lost = s.time + DAY_SECONDS * 2;
    }
    p.pi = 0;
    if (!p.path) {
      /* somewhere they cannot get to: forget it as a place to go */
      p.places = p.places.filter(pl => pl.k === Place.Camp || Math.hypot(pl.x - tx, pl.y - ty) > 0.6);
      fail(s, p); return;
    }
  }
  st.t += dt;
  if (walkPath(s, p, speedOf(s, p, !!st.run) * dt)) next(p);
  /* passing water: a quick drink and a full skin on the way */
  if (p.water < 0.8 && s.isFresh(p.x + 1, p.y) || p.water < 0.8 && s.isFresh(p.x - 1, p.y) || p.water < 0.8 && s.isFresh(p.x, p.y + 1) || p.water < 0.8 && s.isFresh(p.x, p.y - 1)) { p.water = 1; if (s.age(p) >= 6) p.skin = 1; }
  p.anim = st.run ? Anim.Run : p.carryAmt > 0 && p.carryKind !== Food.Wood ? Anim.Carry : s.age(p) > 70 || p.injury > 0.4 ? Anim.CaneWalk : Anim.Walk;
  if (p.carryKind === Food.Wood && p.carryAmt > 0) p.anim = Anim.Carry;
}
/** Moves along the current path; returns true on arriving at its end. */
function walkPath(s: Society, p: Person, budget: number): boolean {
  const path = p.path!;
  while (budget > 0 && p.pi * 2 < path.length) {
    const wx = path[p.pi * 2], wy = path[p.pi * 2 + 1], dx = wx - p.x, dy = wy - p.y, d = Math.hypot(dx, dy);
    const cost = Math.max(1, Math.min(8, s.walker.at(p.x, p.y)));
    const stepLen = budget / cost;
    const nx = d <= stepLen ? wx : p.x + dx / d * stepLen, ny = d <= stepLen ? wy : p.y + dy / d * stepLen;
    /* the way is blocked after all (ice gave way, the season turned): stop and find another */
    if (!s.walker.passable(nx, ny)) {
      /* blocked: try stepping around the obstacle to either side before giving up on this path */
      const a = Math.atan2(dy, dx);
      for (const turn of [0.8, -0.8, 1.6, -1.6]) { const sx = p.x + Math.cos(a + turn) * stepLen, sy = p.y + Math.sin(a + turn) * stepLen; if (s.walker.passable(sx, sy)) { p.x = sx; p.y = sy; return false; } }
      p.path = null; return false;
    }
    if (d <= stepLen) { p.x = wx; p.y = wy; budget -= d * cost; p.pi++; }
    else { p.x = nx; p.y = ny; budget = 0; }
    if (d > 0.01) p.dir = Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 1 : 3) : dy > 0 ? 0 : 2;
  }
  return p.pi * 2 >= path.length;
}
function moveToward(s: Society, p: Person, tx: number, ty: number, v: number, stopAt: number): boolean {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (d <= stopAt) return true;
  const len = Math.min(d - stopAt, v / Math.max(1, Math.min(8, s.walker.at(p.x, p.y))));
  const nx = p.x + dx / d * len, ny = p.y + dy / d * len;
  if (s.walker.passable(nx, ny)) { p.x = nx; p.y = ny; }
  p.dir = Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 1 : 3) : dy > 0 ? 0 : 2;
  return false;
}
function face(p: Person, x: number, y: number): void { const dx = x - p.x, dy = y - p.y; p.dir = Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx > 0 ? 1 : 3) : dy > 0 ? 0 : 2; }
function faceFire(s: Society, p: Person): void { const b = s.band(p); if (Math.hypot(b.x - p.x, b.y - p.y) < 4) face(p, b.x, b.y); }
function faceWater(s: Society, p: Person): void {
  const W = s.w.w, x = p.x | 0, y = p.y | 0;
  for (const [dx, dy, d] of [[0, 1, 0], [1, 0, 1], [0, -1, 2], [-1, 0, 3]]) if (s.w.flags[(y + dy) * W + x + dx] & Flag.Water) { p.dir = d; return; }
}

/* ---------------- work that takes time and then pays off ---------------- */

function work(s: Society, p: Person, st: Step, dt: number, anim: number): void {
  p.anim = anim; st.t += dt;
  if (st.k === St.Fish || st.k === St.Build) faceWater(s, p);
  if (st.k === St.Eat || st.k === St.Cook || st.k === St.Kindle) faceFire(s, p);
  if (st.t < st.dur) return;
  const b = s.band(p);
  switch (st.k) {
    case St.Gather: {
      /* a household's own crop, sown in the spring */
      if (st.id) {
        const w = workById(s, st.id); if (w && w.kind !== Work.Plot) break;
        if (w && w.state >= 1 && w.food > 0) {
          const got = Math.min(w.food, Math.max(0, (st.a ?? 5) - p.carryAmt));
          w.food -= got; load(p, Food.Plant, got); s.stats.food.crop += got; s.stats.food.plant += got;
          practice(p, Idea.Planting, 0.01);
          if (w.band === b.id) seedLine(s, p, w);
          harvest(s, p, w);
        }
        break;
      }
      /* roots and tubers come up for a digging stick that hands cannot reach */
      const roots = rootsAt(s, p.x, p.y), dig = roots && knows(p, Idea.Digging);
      const want = Math.max(0, (st.a ?? 5) - p.carryAmt) * (0.7 + p.skills[Skill.Gather] * 0.6) * (dig ? 1.25 : 1);
      const got = s.eco.gather(p.x, p.y, want, dig ? 0.085 : 0.06);
      load(p, Food.Plant, got);
      p.skills[Skill.Gather] = Math.min(1, p.skills[Skill.Gather] + 0.004);
      s.stats.food.plant += got;
      if (dig) practice(p, Idea.Digging, 0.005);
      if (knows(p, Idea.Baskets)) practice(p, Idea.Baskets, 0.004);
      s.learnPlace(p, Place.Plants, st.x, st.y, s.eco.plantsAt(p.x, p.y) * 0.06, 0, 0);
      inspire(s, p, St.Gather, { full: p.carryAmt >= (st.a ?? 5) - 0.2 && s.eco.plantsAt(p.x, p.y) * 0.06 > 1.5, poor: got < want * 0.4, roots });
      /* a bare patch is not worth a second try */
      if (got < 0.4 && p.plan[p.si + 1]?.k === St.Gather) p.si++;
      break;
    }
    case St.Fish: {
      /* a weir's trap: the fish are there for the taking */
      if (st.id) {
        const w = workById(s, st.id); if (w && w.kind !== Work.Weir) break;
        if (w) { const got = emptyWeir(w, Math.max(0, 6 - (p.carryKind === Food.Fish ? p.carryAmt : 0))); load(p, Food.Fish, got); s.stats.food.fish += got; if (got > 1.5) s.bubble(p, Bubble.Fish, 2); }
        break;
      }
      const nets = knows(p, Idea.Nets);
      const got = s.eco.catchFish(p.x, p.y, 2.6 * (0.45 + p.skills[Skill.Fish] * 0.9) * (nets ? 1.45 + p.know[Idea.Nets] * 0.3 : 1), nets ? 0.045 : 0.03);
      load(p, Food.Fish, got);
      p.skills[Skill.Fish] = Math.min(1, p.skills[Skill.Fish] + 0.005);
      if (nets) practice(p, Idea.Nets, 0.006);
      s.stats.food.fish += got;
      s.learnPlace(p, Place.Fish, st.x, st.y, Math.min(20, s.eco.fishAt(p.x, p.y) * 0.1), 0, 0);
      if (got > 1.5) s.bubble(p, Bubble.Fish, 2);
      inspire(s, p, St.Fish, { poor: got < 1, river: riverAt(s, p.x, p.y) });
      break;
    }
    case St.Snare: {
      const got = s.eco.snare(p.x, p.y, 1.6 * (0.5 + p.skills[Skill.Hunt] * 0.6));
      load(p, Food.Meat, got);
      p.skills[Skill.Hunt] = Math.min(1, p.skills[Skill.Hunt] + 0.002);
      s.stats.food.small += got;
      s.learnPlace(p, Place.Rabbits, st.x, st.y, s.eco.rabbitsAt(p.x, p.y) * 0.3, 0, 0);
      break;
    }
    case St.Butcher: {
      const c = s.carcasses.find(k => k.id === st.id);
      if (c && Math.hypot(c.x - p.x, c.y - p.y) < 4) {
        /* keen blades cut cleaner and faster: more meat off the bone in the time */
        const blades = knows(p, Idea.Blades), big = c.meat > 40;
        const take = Math.min(c.meat, (blades ? 7.5 : 6) - (p.carryKind === Food.Meat ? p.carryAmt : 0));
        if (blades) practice(p, Idea.Blades, 0.005);
        inspire(s, p, St.Butcher, { big });
        c.meat -= take; load(p, Food.Meat, take); s.stats.food.meat += take;
        if (c.hides > 0) { c.hides--; p.hides++; }
        /* tell yourself where the rest is, to come back for it or send others */
        if (c.meat > 3) s.learnPlace(p, Place.Carcass, c.x, c.y, c.meat, c.id, c.by === p.id ? 0 : c.by, s.time, c.sp);
      }
      break;
    }
    case St.Wood: {
      /* an axe brings down dead wood that hands can only break off a stick at a time */
      const axe = knows(p, Idea.Axe);
      load(p, Food.Wood, axe ? 5 : 3);
      if (axe) practice(p, Idea.Axe, 0.005);
      inspire(s, p, St.Wood);
      break;
    }
    case St.Eat: {
      const greedy = p.traits[2] > 0.65 ? 1.2 : 1;
      if (st.a === 1 && p.carryAmt > 0 && p.carryKind < Food.Wood) { const e = Math.min(p.carryAmt, Math.max(0.3, 1.6 - p.food)); p.carryAmt -= e; p.food = Math.min(2.5, p.food + e); if (p.carryAmt <= 0.01) { p.carryAmt = 0; p.carryKind = 0; } }
      else {
        /* with the fire dead, meat and fish are eaten raw, and raw they go less far */
        const raw = b.fire <= 0 && s.atCamp(p, 8);
        let share = 0;
        if (raw) { const h = b.hearths.get(homeOf(p, s.byId, s.time)); const mf = (h ? h.meat + h.fish : 0) + b.store.meat + b.store.fish, all = (h ? storeFood(h) : 0) + storeFood(b.store); share = all > 0 ? Math.min(1, mf / all * 1.5) : 0; }
        const got = s.eatFromStore(p, b, Math.min(1.6, Math.max(0.3, 2 - p.food)) * greedy);
        if (raw && got > 0) p.food = Math.max(0, p.food - got * 0.15 * share);
      }
      /* feed a hungry small child at your side */
      for (const cid of p.children) { const c = s.byId.get(cid); if (c && s.age(c) >= 1 && s.age(c) < 7 && c.food < 1 && Math.hypot(c.x - p.x, c.y - p.y) < 3) s.eatFromStore(c, b, 0.8); }
      break;
    }
    case St.Drink: p.water = 1; if (s.age(p) >= 6) p.skin = 1; break;
    case St.Look: {
      s.learnSurroundings(p, 26);
      const wat = s.waterNear(p.x, p.y, 6);
      if (wat) {
        const here = s.siteValueFor(p, p.x, p.y);
        s.learnPlace(p, Place.Site, wat[0], wat[1], here * 0.2, 0, 0);
        if (here > 30) s.remember(p, Mem.Found, 0, 0.3);
      }
      break;
    }
    case St.Craft: {
      const who = s.byId.get(st.id);
      inspire(s, p, St.Craft);
      if (who && b.store.hides >= 1) {
        /* hides scraped clean with good blades make clothes that last */
        b.store.hides -= 1; who.clothes = Math.min(2, who.clothes + 1); who.clothesWear = knows(p, Idea.Blades) ? 1.3 : 1; s.dirty.add(who.id);
        p.skills[Skill.Craft] = Math.min(1, p.skills[Skill.Craft] + 0.01);
        if (who !== p) { s.rel(who, p.id).op += 0.12; s.remember(who, Mem.Helped, p.id, 0.4); p.prestige += 0.04; }
      }
      break;
    }
    case St.Knap: inspire(s, p, St.Knap); p.spear = 1; p.skills[Skill.Craft] = Math.min(1, p.skills[Skill.Craft] + 0.005); if (knows(p, Idea.Blades)) practice(p, Idea.Blades, 0.01); break;
    case St.Cook: inspire(s, p, St.Cook); break;
    case St.Kindle: kindle(s, p, st); break;
    case St.Ember: {
      /* at the other band's fire: they give a smoldering ember to carry home */
      const host = s.bandById.get(st.id);
      if (!host || host.fire <= 0.03 || Math.hypot(host.x - p.x, host.y - p.y) > 6) { fail(s, p, `${p.name} went to fetch fire, but the fire there was out too.`); return; }
      p.ember = s.time; p.emberFrom = host.id;
      const lead = s.byId.get(host.respected); if (lead) { const r = s.rel(p, lead.id); r.op = Math.min(1, r.op + 0.08); r.fam = Math.max(r.fam, 0.2); }
      s.bubble(p, Bubble.Fire, 2.5);
      p.why = `${p.name} is carrying an ember home from the ${host.name}'s fire, wrapped in moss, to light the ${b.name}'s fire again.`; p.whyAt = s.time;
      break;
    }
    case St.Dry: {
      /* strips of meat and fish over the smoke: from the family's hearth, or the band's pot */
      const src = st.a === 1 ? hearthOf(s, p) : b.store;
      const amt = Math.min(src.meat + src.fish, 8 * (0.6 + p.know[Idea.Drying] * 0.6));
      const m = Math.min(src.meat, amt), f = Math.min(src.fish, amt - m);
      src.meat -= m; src.fish -= f; src.dried += (m + f) * 0.92;
      s.stats.food.dried += (m + f) * 0.92;
      practice(p, Idea.Drying, 0.01);
      break;
    }
    case St.Build: {
      const mend = st.id ? workById(s, st.id) ?? null : null;
      if (!mend && worksAround(s, st.a ?? st.x, st.o ?? st.y, 7).some(w => w.kind === Work.Weir && Math.hypot(w.wx - (st.a ?? 0), w.wy - (st.o ?? 0)) < 5)) break;
      buildWeir(s, p, { x: st.x, y: st.y, wx: st.a ?? st.x, wy: st.o ?? st.y }, mend);
      break;
    }
    case St.Raise: raise(s, p, st); break;
    case St.Pit: digPit(s, p, st); break;
    case St.Store: storeInPit(s, p, st); break;
    case St.Fetch: fetchFromPit(s, p, st); break;
    case St.Sow: {
      /* the seed comes from the household's own store of plant food, or what it put by in its pit */
      const h = hearthOf(s, p), pit = pitOf(s, b, homeOf(p, s.byId, s.time)), field = st.id ? workById(s, st.id) : undefined;
      /* a field someone else has sown again meanwhile needs no more seed */
      if (field && (field.kind !== Work.Plot || !field.fallow)) break;
      const crop = field ? field.crop : cropAt(s, st.x, st.y);
      const seed = h.plant + (pit && pit.foods ? pit.foods.plant : 0);
      if (seed < 1 || !crop) break;
      let need = 2; const t = Math.min(need, h.plant); h.plant -= t; need -= t;
      if (need > 0 && pit && pit.foods) { const u = Math.min(need, pit.foods.plant); pit.foods.plant -= u; b.pit = Math.max(0, b.pit - u); }
      if (field) resow(s, p, field); else sow(s, p, { x: st.x, y: st.y, crop });
      break;
    }
  }
  next(p);
}

/** Lighting the fire: someone who can make fire makes it; someone carrying an ember blows it into flame; anyone else tries, and may work it out. */
function kindle(s: Society, p: Person, st: Step): void {
  const b = s.band(p);
  if (b.fire > 0) { p.ember = 0; return; }
  if (st.a === 1) {
    if (!p.ember || s.time - p.ember > DAY_SECONDS * 1.6) { p.ember = 0; p.why = `${p.name} carried an ember home, but it died on the way.`; p.whyAt = s.time; return; }
    const host = s.bandById.get(p.emberFrom);
    p.ember = 0; s.relight(b); s.stats.fire.embers++;
    s.bubble(p, Bubble.Fire, 3);
    s.event("ember", Bubble.Fire, `The ${b.name}'s fire had gone out, and none of them could make fire. ${p.name} walked to ${host ? `the camp of the ${host.name}` : "another band's camp"} and carried fire home in a smoldering bundle of moss.`, p.x, p.y, [p.id], b.id);
    return;
  }
  if (knows(p, Idea.MakeFire)) { s.relight(b); practice(p, Idea.MakeFire, 0.02); s.stats.fire.kindled++; s.bubble(p, Bubble.Fire, 2.5); return; }
  if (inspire(s, p, St.Kindle)) { s.relight(b); s.stats.fire.kindled++; }
}

/** A household's first harvest, and the band's: a moment worth telling. */
function harvest(s: Society, p: Person, w: { band: number; by: number; crop: string; x: number; y: number; id: number }): void {
  const b = s.band(p);
  s.remember(p, Mem.Harvest, w.by, 0.3);
  if (s.harvested.has(b.id)) return;
  s.harvested.add(b.id);
  const first = s.harvested.size === 1, sower = s.byId.get(w.by)?.name ?? s.archive.get(w.by)?.name;
  s.event("harvest", Bubble.Berries, `The ${b.name} brought in their first harvest: ${w.crop} from the patch ${sower ? `${sower} sowed` : "sown"} by camp in the spring.${first ? " Nobody anywhere has harvested what they planted before." : ""}`, w.x, w.y, [p.id, w.by].filter(id => s.byId.has(id)), b.id, first ? 1 : 0);
}
function load(p: Person, kind: number, amt: number): void {
  if (amt <= 0) return;
  if (p.carryKind !== kind) { p.carryKind = kind; p.carryAmt = 0; }
  p.carryAmt += amt;
}

/** Back at camp: everything carried goes into the band's store, and the band hears where the rest of a kill lies. */
function drop(s: Society, p: Person): void {
  const b = s.band(p);
  if (p.hides) { b.store.hides += p.hides; p.hides = 0; }
  if (p.carryAmt <= 0 || !p.carryKind) { p.carryAmt = 0; p.carryKind = 0; return; }
  const amt = p.carryAmt, kind = p.carryKind;
  if (kind === Food.Wood) b.store.wood += amt;
  else {
    if (kind === Food.Plant) b.today.plant += amt; else if (kind === Food.Fish) b.today.fish += amt; else b.today.meat += amt;
    /* some into the band's pot, the rest to the household's own hearth */
    deposit(s, p, kind, amt);
    p.gave = p.gave * 0.98 + amt * 0.02 * 40; p.gaveToday += amt;
    p.tripYield = p.tripYield * 0.7 + amt * 0.3;
    const big = s.carcasses.find(c => c.meat > 3 && (c.by === p.id || c.by === p.party) && Math.hypot(c.x - b.x, c.y - b.y) < 60);
    if (big && kind === Food.Meat && amt >= 4) mock(s, p, big);
    for (const q of s.near(b.x, b.y, 7)) {
      if (q === p || q.band !== p.band) continue;
      if (q.food < 0.7) s.rel(q, p.id).op = Math.min(1, s.rel(q, p.id).op + 0.02);
      if (big) s.learnPlace(q, Place.Carcass, big.x, big.y, big.meat, big.id, p.id, s.time, big.sp);
    }
    if (kind === Food.Meat && amt >= 4) s.bubble(p, Bubble.Meat, 2.5);
  }
  p.carryAmt = 0; p.carryKind = 0;
}

/* ---------------- hunting ---------------- */

function stalk(s: Society, p: Person, st: Step, dt: number): void {
  st.t += dt;
  const lead = p.party && p.party !== p.id ? s.byId.get(p.party) : p;
  if (!lead || lead.goal !== Goal.Hunt) { giveUpHunt(s, p); return; }
  let h = s.wild.herds.find(k => k.id === st.id && k.n > 0);
  if (!h) {
    /* the herd is not where it was: look for any other within sight */
    h = s.herdsNear(p.x, p.y, 12).find(k => k.sp !== Species.Wolf && k.sp !== Species.Bear);
    if (h) st.id = h.id;
  }
  if (!h || st.t > st.dur) {
    if (p === lead) {
      p.places = p.places.filter(pl => !(pl.k === Place.Game && pl.ref === st.id));
      p.why = `${p.name} is heading home empty-handed. The ${SPECIES_SHORT[h?.sp ?? 0]} got away.`; p.whyAt = s.time;
      p.tripYield *= 0.7;
    }
    giveUpHunt(s, p); return;
  }
  const d = Math.hypot(h.x - p.x, h.y - p.y);
  const close = d < 9;
  /* creep up slowly once close; the others stay a little behind the leader */
  moveToward(s, p, h.x, h.y, speedOf(s, p, false) * (close ? 0.55 : 1) * dt, p === lead ? 2.2 : 3.4);
  p.anim = close ? Anim.Walk : Anim.Walk;
  if (p !== lead || d > 2.6) return;
  /* strike */
  p.anim = Anim.Throw; face(p, h.x, h.y);
  st.a = (st.a ?? 0) + 1;
  const party = s.near(p.x, p.y, 6).filter(q => q.party === p.id);
  const cover = s.w.tree[(h.y | 0) * s.w.w + (h.x | 0)] ? 0.85 : 1;
  const chance = HUNT_P[h.sp] * (0.5 + p.skills[Skill.Hunt]) * (1 + 0.45 * (party.length - 1)) * (h.cond < 0.6 ? 1.3 : 1) * cover;
  /* a point struck as a blade breaks less often */
  p.spear -= knows(p, Idea.Blades) ? 0.075 : 0.12;
  /* the big ones fight back */
  const hurt = DANGER[h.sp] * Math.max(0.3, 1 - 0.25 * (party.length - 1));
  if (s.rng.chance(hurt)) {
    const victim = s.rng.pick(party.length ? party : [p]), sev = s.rng.range(0.25, 0.9);
    victim.injury = Math.min(1, victim.injury + sev); victim.health -= sev * 0.6;
    s.remember(victim, Mem.Injured, 0, -0.6, h.sp);
    /* someone hurt on another's hunt may blame the one who led it */
    if (victim !== p && s.op(victim, p.id) < 0.4) { s.rel(victim, p.id).op -= 0.15; grievance(s, victim, p, 0.4, `led the hunt where ${victim.sex === "f" ? "she" : "he"} was hurt`); }
    if (victim.health <= 0) s.die(victim, `hunting ${h.sp === Species.Mammoth ? "a mammoth" : h.sp === Species.Bear ? "a bear" : h.sp === Species.Aurochs ? "an aurochs" : "game"}`);
    else s.event("hurt", Bubble.Sad, `${victim.name} was hurt by ${h.sp === Species.Aurochs ? "an aurochs" : h.sp === Species.Mammoth ? "a mammoth" : "the animal"} on a hunt.`, victim.x, victim.y, [victim.id], victim.band);
  }
  if (!s.byId.has(p.id)) return;
  if (s.rng.chance(chance)) kill(s, p, h, party);
  else {
    /* missed: the herd bolts; try once more if they can catch up */
    h.state = 2; h.timer = 10; const a = Math.atan2(h.y - p.y, h.x - p.x); h.tx = h.x + Math.cos(a) * 24; h.ty = h.y + Math.sin(a) * 24;
    if (st.a >= 3 || p.spear <= 0) {
      p.why = `${p.name} is heading home empty-handed. The ${SPECIES_SHORT[h.sp]} got away.`; p.whyAt = s.time;
      p.tripYield *= 0.7; giveUpHunt(s, p);
      for (const q of party) if (q !== p) giveUpHunt(s, q);
    }
  }
}
function giveUpHunt(s: Society, p: Person): void {
  /* skip ahead to walking home */
  const home = p.plan.findIndex((k, i) => i > p.si && k.k === St.Go);
  if (home < 0) { abandon(s, p); return; }
  p.si = home; p.path = null; p.pi = 0;
  p.plan.splice(home + 1, p.plan.length, step(St.Drop, p.plan[home].x, p.plan[home].y));
}
function kill(s: Society, lead: Person, h: { id: number; sp: number; x: number; y: number; n: number }, party: Person[]): void {
  h.n--;
  s.stats.kills[h.sp]++;
  const c = { id: s.nextId++, x: h.x, y: h.y, sp: h.sp, meat: MEAT[h.sp], hides: h.sp === Species.Mammoth ? 2 : 1, t: s.time, by: lead.id };
  /* the carcass lies on dry ground */
  if (!s.walker.dry(c.x, c.y)) { c.x = lead.x; c.y = lead.y; }
  s.carcasses.push(c);
  const crew = party.length ? party : [lead];
  for (const q of crew) {
    q.skills[Skill.Hunt] = Math.min(1, q.skills[Skill.Hunt] + 0.02);
    q.prestige += MEAT[h.sp] / 120 * (q === lead ? 1.5 : 1);
    s.remember(q, Mem.Kill, lead.id, 0.5, h.sp);
    const bi = q.plan.findIndex(k => k.k === St.Butcher);
    if (bi >= 0) { q.si = bi; q.plan[bi].id = c.id; q.plan[bi].x = c.x; q.plan[bi].y = c.y; q.path = null; q.pi = 0; q.plan.splice(bi, 0, step(St.Go, c.x, c.y)); }
    q.why = `${q.name} is butchering the ${SPECIES_SHORT[h.sp]} ${q === lead ? `${she(q)} brought down` : `${lead.name} brought down`}, to carry the meat home.`; q.whyAt = s.time;
    s.bubble(q, h.sp === Species.Mammoth ? Bubble.Mammoth : Bubble.Deer, 3);
  }
  if (h.sp === Species.Mammoth || h.sp === Species.Aurochs || h.sp === Species.Bear) {
    const names = crew.map(q => q.name);
    const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    s.event("kill", h.sp === Species.Mammoth ? Bubble.Mammoth : Bubble.Deer, `${who} of the ${s.band(lead).name} brought down ${h.sp === Species.Mammoth ? "a mammoth" : h.sp === Species.Aurochs ? "an aurochs" : "a bear"}. There will be meat for days.`, c.x, c.y, crew.map(q => q.id), lead.band, h.sp);
  }
}

/* ---------------- people together ---------------- */

/** Talking: step `a` has bit 1 for courting and bit 2 for the one being talked to. */
function talk(s: Society, p: Person, st: Step, dt: number): void {
  const q = s.byId.get(st.id);
  if (!q || q.band !== p.band && !p.rel.has(q.id)) { next(p); return; }
  const listener = ((st.a ?? 0) & 2) !== 0;
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  if (listener) {
    const other = q.plan[q.si];
    if (!other || other.k !== St.Talk || other.id !== p.id) { next(p); return; }
  } else if (st.t === 0) {
    /* walk up to them, then see whether they will stop to talk */
    if (d > 1.8) { moveToward(s, p, q.x, q.y, speedOf(s, p, false) * dt, 1.2); p.anim = Anim.Walk; st.w = (st.w ?? 0) + dt; if (st.w > 8) fail(s, p); return; }
    const cur = q.plan[q.si];
    const free = !cur || q.goal === Goal.None || (q.goal !== Goal.Sleep && q.goal !== Goal.Flee && q.goal !== Goal.Sick && q.goal !== Goal.Migrate && q.goal !== Goal.Hunt && q.goal !== Goal.Fight && (cur.k === St.Sit || cur.k === St.Wait || cur.k === St.Play || cur.k === St.Follow || cur.k === St.Go && (q.goal === Goal.Rest || q.goal === Goal.Talk)));
    if (!free || q.carrier) {
      /* someone who walked all the way over with a gift waits a while for them */
      if ((st.a ?? 0) & 4 && (st.w ?? 0) < 30 && q.goal !== Goal.Migrate) { st.w = (st.w ?? 0) + dt; p.anim = Anim.Idle; face(p, q.x, q.y); return; }
      fail(s, p); return;
    }
    const a = st.a ?? 0;
    q.plan = [step(St.Talk, 0, 0, p.id, st.dur, { a: (a & 1) | 2 | (a & 16), o: st.o })]; q.si = 0; q.path = null;
    q.goal = a & 1 ? Goal.Court : a & 16 ? Goal.Learn : Goal.Talk; q.whyAt = s.time;
    const other = a & 8 ? s.byId.get(st.o ?? 0) : undefined;
    q.why = a & 1 ? `${q.name} is talking with ${p.name}, who has been seeking ${q.sex === "f" ? "her" : "him"} out.`
      : a & 16 ? `${q.name} is learning ${IDEAS[st.o ?? 0].how} from ${p.name}, watching closely and trying it.`
      : other ? `${q.name} is listening to ${p.name}, who is trying to make peace between ${q.sex === "f" ? "her" : "him"} and ${other.name}.`
      : a & 4 ? `${q.name} is welcoming ${p.name} of the ${s.band(p).name}, who has come visiting.`
      : `${q.name} is talking with ${p.name}, who came over to chat.`;
  }
  st.t += dt;
  /* showing how: the one who knows works at it, the one learning watches and tries */
  const lesson = ((st.a ?? 0) & 16) !== 0;
  p.anim = lesson ? (listener ? (Math.floor(st.t / 2) % 2 ? IDEAS[st.o ?? 0].anim : Anim.Sit) : IDEAS[st.o ?? 0].anim) : Anim.Talk; face(p, q.x, q.y);
  p.company = Math.min(1, p.company + 0.1 * dt);
  if (listener) { if (st.t > st.dur + 4) next(p); return; }
  /* topics come up as they talk */
  if (st.t % 2.2 < dt) s.bubble(p, topicIcon(s, p, q, st), 1.8);
  if (st.t >= st.dur) { converse(s, p, q, st); next(p); }
}
function topicIcon(s: Society, p: Person, q: Person, st: Step): number {
  if ((st.a ?? 0) & 1) return Bubble.Heart;
  if ((st.a ?? 0) & 8) return Bubble.Peace;
  if ((st.a ?? 0) & 16) return IDEAS[st.o ?? 0]?.icon ?? Bubble.Star;
  if ((st.a ?? 0) & 4 && st.t < 3) return Bubble.Gift;
  if (p.moveWish > 0.5) return Bubble.Move;
  const r = s.rng.next();
  const pl = p.places.filter(k => k.k !== Place.Water && k.k !== Place.Camp && k.src === 0).sort((a, c) => c.t - a.t)[0];
  if (r < 0.5 && pl) return pl.k === Place.Fish ? Bubble.Fish : pl.k === Place.Game ? (pl.sp === Species.Mammoth ? Bubble.Mammoth : Bubble.Deer) : pl.k === Place.Site ? Bubble.Home : Bubble.Berries;
  if (p.baby || q.baby) return Bubble.Baby;
  return r < 0.75 ? Bubble.Sun : Bubble.Fire;
}

/**
  What a conversation does: they get to know each other, warm to each other or quarrel,
  pass on what they know about where food is, spread what they think of others, and
  talk over moving camp. Courting is a conversation where hearts are at stake.
*/
function converse(s: Society, a: Person, b: Person, st: Step): void {
  const flags = st.a ?? 0, court = (flags & 1) !== 0;
  const ra = s.rel(a, b.id), rb = s.rel(b, a.id);
  ra.fam = Math.min(1, ra.fam + 0.06); rb.fam = Math.min(1, rb.fam + 0.06); ra.seen = rb.seen = s.time;
  a.company = Math.min(1, a.company + 0.3); b.company = Math.min(1, b.company + 0.3);
  /* a go-between talking one side of a feud round */
  if (flags & 8) { talkRound(s, a, b, st.o ?? 0); share(s, a, b); return; }
  /* a lesson: whether it took */
  if (flags & 16) { shown(s, a, b, st.o ?? 0); return; }
  /* a visit: a gift handed over, then the news, and now and then a new way of doing things */
  if (flags & 4) { gift(s, a, b); share(s, a, b); share(s, b, a); share(s, a, b); tellIdea(s, a, b); return; }
  const stress = (a.food < 0.4 ? 0.1 : 0) + (b.food < 0.4 ? 0.1 : 0);
  const quarrel = 0.025 + a.traits[6] * b.traits[6] * 0.22 + (ra.op < -0.1 ? 0.15 : 0) + stress - (a.traits[1] + b.traits[1]) * 0.03;
  if (s.rng.chance(quarrel)) {
    ra.op = Math.max(-1, ra.op - 0.12 - a.traits[6] * 0.08); rb.op = Math.max(-1, rb.op - 0.12 - b.traits[6] * 0.08);
    s.remember(a, Mem.Argued, b.id, -0.3); s.remember(b, Mem.Argued, a.id, -0.3);
    s.bubble(a, Bubble.Angry, 2.5); s.bubble(b, Bubble.Angry, 2.5);
    a.why = `${a.name} just quarreled with ${b.name}.`; a.whyAt = s.time;
    /* quarrels that keep coming back add up */
    grievance(s, a, b, 0.15, `keeps picking quarrels with ${a.sex === "f" ? "her" : "him"}`);
    grievance(s, b, a, 0.15, `keeps picking quarrels with ${b.sex === "f" ? "her" : "him"}`);
    return;
  }
  const warm = 0.04 + (a.traits[5] + b.traits[5]) * 0.02 + (a.traits[1] + b.traits[1]) * 0.015;
  ra.op = Math.min(1, ra.op + warm); rb.op = Math.min(1, rb.op + warm);
  if (s.rng.chance(0.15)) { s.remember(a, Mem.NiceTalk, b.id, 0.15); s.remember(b, Mem.NiceTalk, a.id, 0.15); }
  share(s, a, b); share(s, b, a);
  /* gossip: dislike spreads to friends */
  for (const [id, r] of a.rel) if (r.op < -0.35 && id !== b.id && rb.op > 0.2) { const rc = s.rel(b, id); rc.op = Math.max(-1, rc.op - 0.05); break; }
  /* talk of moving camp */
  if (a.moveWish > 0.45) {
    b.moveWish = clamp01(b.moveWish + 0.12 * (0.5 + rb.op) * (0.6 + a.prestige * 0.4));
    const site = a.places.filter(pl => pl.k === Place.Site).sort((x, y) => y.q - x.q)[0];
    if (site) s.learnPlace(b, Place.Site, site.x, site.y, site.q, 0, a.id, site.t);
  }
  if (court) courtship(s, a, b, ra, rb);
}
/** Pass on the most useful thing one knows that the other doesn't (or knows less freshly). */
function share(s: Society, from: Person, to: Person): void {
  let best = null as Person["places"][number] | null, bv = 0;
  for (const pl of from.places) {
    if (pl.k === Place.Water || pl.k === Place.Danger) continue;
    if (pl.k === Place.Camp && pl.ref === to.band) continue;
    const theirs = to.places.find(o => o.k === pl.k && (pl.ref ? o.ref === pl.ref : Math.hypot(o.x - pl.x, o.y - pl.y) < 8));
    if (theirs && theirs.t >= pl.t - 30) continue;
    const v = (pl.k === Place.Game ? pl.q * 3 : pl.k === Place.Site ? 20 : pl.q) * (pl.k === Place.Camp ? 0.5 : 1) - (s.time - pl.t) / 120;
    if (v > bv) { bv = v; best = pl; }
  }
  if (!best) return;
  s.learnPlace(to, best.k, best.x, best.y, best.q, best.ref, from.id, best.t, best.sp);
}
function courtship(s: Society, a: Person, b: Person, ra: { court: number; op: number }, rb: { court: number; op: number }): void {
  const back = attraction(s, b, a);
  if (back > 0.18 && (!b.partner || unhappy(s, b)) && (!a.partner || unhappy(s, a))) {
    ra.court = Math.min(1, ra.court + 0.22 + back * 0.3); rb.court = Math.min(1, rb.court + 0.18 + back * 0.3);
    ra.op = Math.min(1, ra.op + 0.06); rb.op = Math.min(1, rb.op + 0.06);
    s.bubble(b, Bubble.Heart, 2.5);
    if (ra.court >= 1 && rb.court >= 1) { const [f, m] = a.sex === "f" ? [a, b] : [b, a]; s.pair(f, m); }
  } else {
    ra.court = Math.max(0, ra.court - 0.25); ra.op = Math.max(-1, ra.op - 0.03); a.longing *= 0.7;
    s.remember(a, Mem.Rejected, b.id, -0.25);
    s.bubble(a, Bubble.Sad, 2);
  }
}

function play(s: Society, p: Person, st: Step, dt: number): void {
  st.t += dt; p.anim = Anim.Play;
  const r = 1.2 + (p.id % 3) * 0.4, a = st.t * 1.6 + p.id;
  moveToward(s, p, st.x + Math.cos(a) * r, st.y + Math.sin(a) * r * 0.7, speedOf(s, p, true) * dt, 0.1);
  p.company = Math.min(1, p.company + 0.03 * dt);
  if (st.t >= st.dur) next(p);
}
/** Children (and toddlers) keep close to someone, and learn by watching what they do. */
function follow(s: Society, p: Person, st: Step, dt: number): void {
  st.t += dt;
  const q = s.byId.get(st.id);
  if (!q || q.goal === Goal.Sleep || q.goal === Goal.Migrate || st.t > st.dur) { next(p); return; }
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  if (d > 1.8) { moveToward(s, p, q.x - 0.8, q.y + 0.4, speedOf(s, p, d > 6) * dt, 0.9); p.anim = d > 6 ? Anim.Run : Anim.Walk; return; }
  p.anim = q.anim === Anim.Sit || q.anim === Anim.HoldBaby ? Anim.Sit : q.anim === Anim.Gather || q.anim === Anim.Dig ? Anim.Gather : Anim.Idle;
  face(p, q.x, q.y);
  /* watching and copying is how children learn */
  const g = q.goal, sk = g === Goal.Gather || g === Goal.Sow || g === Goal.Pit ? Skill.Gather : g === Goal.Fish || g === Goal.Build ? Skill.Fish : g === Goal.Snare || g === Goal.Hunt ? Skill.Hunt : g === Goal.Craft || g === Goal.Dry || g === Goal.Kindle || g === Goal.Hut ? Skill.Craft : -1;
  if (sk >= 0 && q.plan[q.si]?.k !== St.Go) p.skills[sk] = Math.min(q.skills[sk], p.skills[sk] + 0.0012 * (0.5 + p.traits[4]) * dt);
  if (q.plan[q.si]?.k !== St.Go && s.age(p) >= 5) for (const id of inUse(q)) {
    if (p.know[id] > 0 || s.age(p) < IDEAS[id].age || !ready(p, id)) continue;
    if (s.rng.chance(0.004 * dt * (0.5 + p.traits[4]))) { learn(s, p, id, q, "watch"); break; }
  }
}
/** At another household's hearth, asking for food. `id` is the household, `o` the one asked. */
function ask(s: Society, p: Person, st: Step, dt: number): void {
  const g = s.byId.get(st.o ?? 0);
  if (!g || g.band !== p.band || Math.hypot(g.x - p.x, g.y - p.y) > 3.5) { p.askedAt = s.time + DAY_SECONDS * 0.08; fail(s, p, `${p.name} went to ask for food, but there was nobody at the hearth.`); return; }
  st.t += dt; p.anim = Anim.Talk; face(p, g.x, g.y);
  if (st.t < st.dur) { if (st.t < dt * 1.5) s.bubble(p, Bubble.Ask, 2); return; }
  if (answer(s, g, p, st.id) <= 0) { fail(s, p); return; }
  next(p);
}
/** Two people come to blows: a scuffle of shoves and shouting, until others pull them apart. */
function fight(s: Society, p: Person, st: Step, dt: number): void {
  const q = s.byId.get(st.id);
  if (!q) { next(p); return; }
  st.t += dt;
  if (Math.hypot(q.x - p.x, q.y - p.y) > 1.1) moveToward(s, p, q.x, q.y, speedOf(s, p, false) * dt, 0.9);
  p.anim = Math.floor(st.t * 4 + p.id) % 3 === 0 ? Anim.Throw : Anim.Wave; face(p, q.x, q.y);
  if (st.t < st.dur) return;
  /* whichever of the two finishes first settles it for both */
  if (st.a !== 1) { const qs = q.plan[q.si]; if (qs && qs.k === St.Fight && qs.id === p.id) qs.a = 1; endFight(s, p, q); }
  next(p);
}

function tend(s: Society, p: Person, st: Step, dt: number): void {
  st.t += dt;
  const q = s.byId.get(st.id);
  if (!q || (q.sick <= 0 && q.injury < 0.25) || st.t > st.dur) { next(p); return; }
  if (Math.hypot(q.x - p.x, q.y - p.y) > 1.6) { moveToward(s, p, q.x + 0.9, q.y, speedOf(s, p, false) * dt, 0.6); p.anim = Anim.Walk; return; }
  p.anim = Anim.Sit; face(p, q.x, q.y);
  q.injury = Math.max(0, q.injury - 0.0008 * dt);
  /* carers bring water and food to the sick */
  q.water = Math.max(q.water, 0.7);
  if (q.food < 0.8 && s.eatFromStore(q, s.band(q), 0.02 * dt) <= 0 && q.band === p.band) {
    /* nothing at their hearth or in the pot: the carer feeds them from their own */
    const mine = hearthOf(s, p), theirs = hearthOf(s, q);
    if (mine !== theirs && storeFood(mine) > 0.5 && pass(mine, theirs, 0.02 * dt) > 0) eat(s, q, s.band(q), 0.02 * dt);
  }
  const r = s.rel(q, p.id); r.op = Math.min(1, r.op + 0.004 * dt);
  if (st.t + dt >= st.dur) s.remember(q, Mem.Helped, p.id, 0.35);
}
