import { Biome, Flag, Species, Tree, DAY_SECONDS } from "../../shared/types.ts";
import { Bubble } from "../../shared/people.ts";
import { storeDays, storeFood, estimate } from "./band.ts";
import { Goal, Know, Place, St, Skill, step, type KnownPlace, type Person, type Step } from "./person.ts";
import { MEAT, compass, type Society } from "./society.ts";

/*
  Deciding what to do. A person looks at everything they could do right now and gives
  each a value: how badly they need what it brings, how much their temperament cares
  about it, how likely it is to work from what they know, and what it costs (distance,
  danger, effort). They take the best, with a little randomness, and turn it into a plan of
  steps. The reasons that won are kept, in plain words, as the person's "why".
*/

interface Option { g: Goal; v: number; plan: () => Step[] | null; why: () => string; icon?: number; }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const she = (p: Person) => (p.sex === "f" ? "she" : "he");
export const her = (p: Person) => (p.sex === "f" ? "her" : "his");
const Her = (p: Person) => (p.sex === "f" ? "Her" : "His");
const herObj = (p: Person) => (p.sex === "f" ? "her" : "him");

/** Goals that can be dropped any time something better comes up. */
export function isInterruptible(g: Goal): boolean {
  return g === Goal.Rest || g === Goal.Play || g === Goal.Toddle || g === Goal.Follow || g === Goal.Warm || g === Goal.None || g === Goal.Tend || g === Goal.Visit;
}

export function decide(s: Society, p: Person, forced?: Goal): void {
  p.plan = []; p.si = 0; p.path = null; p.pi = 0;
  const st = s.stage(p), b = s.band(p);
  if (p.party && !(forced === undefined && p.goal === Goal.Hunt)) p.party = 0;
  const opts: Option[] = [];
  const add = (o: Option) => { if (o.v > 0) opts.push(o); };

  if (forced === Goal.Flee) {
    const [fx, fy] = s.fireSpot(p);
    commit(s, p, { g: Goal.Flee, v: 9, plan: () => [step(St.Go, fx, fy, 0, 0, { run: true }), step(St.Sit, fx, fy, 0, 4)], why: () => `${p.name} is running back to camp because ${she(p)} saw ${dangerSeen(p)} nearby.`, icon: Bubble.Fear });
    return;
  }
  if (s.time < p.lost || !s.walker.reach(p.x, p.y, b.x, b.y) && !(b.moving && s.walker.reach(p.x, p.y, b.moving.x, b.moving.y))) { stranded(s, p); return; }
  if (b.moving) {
    const m = b.moving, lead = s.byId.get(m.by);
    /* the band carries its food with it: a hungry walker eats on the way */
    if (p.food < 0.7 && storeFood(b.store) > 0.3) { commit(s, p, { g: Goal.Eat, v: 9, plan: () => [step(St.Eat, p.x, p.y, 0, 2)], why: () => `${p.name} is eating on the way, from the food the band is carrying.`, icon: Bubble.Meat }); return; }
    const [mx, my] = s.dryNear(m.x + Math.cos(p.id) * 2, m.y + Math.sin(p.id) * 1.6);
    if (p.water > 0.12) commit(s, p, { g: Goal.Migrate, v: 9, plan: () => [step(St.Go, mx, my, 0, 0, { a: 1 })], why: () => p.id === m.by ? `${p.name} is leading the ${b.name} ${compass(m.x - p.x, m.y - p.y)} to ${m.name}, where ${she(p)} found ${siteReason(s, p, m.x, m.y)}.` : `${p.name} is walking with the ${b.name} to ${m.name}, because ${lead?.name ?? "the band"} said there is ${siteReason(s, lead ?? p, m.x, m.y)} there.`, icon: Bubble.Move });
    if (p.water > 0.12) return;
  }
  if ((p.sick > 0.5 || p.injury > 0.6) && p.water > 0.12) {
    const [hx, hy] = s.homeSpot(p);
    commit(s, p, { g: Goal.Sick, v: 9, plan: () => [step(St.Go, hx, hy), step(St.Sit, hx, hy, 0, 14, { a: 1 })], why: () => p.injury > 0.6 ? `${p.name} is lying down because ${she(p)} is badly hurt.` : `${p.name} is lying down because ${she(p)} is sick with a fever.`, icon: Bubble.Sad });
    return;
  }

  const age = s.age(p), T = s.tempC(p.x, p.y);
  const hunger = clamp01(1 - p.food / 1.4), thirst = clamp01(1 - p.water), tired = 1 - p.rest, cold = 1 - p.warmth, lonely = 1 - p.company;
  const tr = p.traits, night = s.sun < 0.12, dusk = s.dayFrac() > 0.76 || s.dayFrac() < 0.2, dark = night || dusk;
  const dc = Math.hypot(p.x - b.x, p.y - b.y);
  /* how much the band's store is short of what people feel it should hold: more before a cold winter */
  const leanWinter = (s.season === 2 || (s.season === 3 && s.dayFrac() < 2)) && s.tempC(b.x, b.y, s.time + 900) < 8;
  const short = clamp01(1 - storeDays(b) / (leanWinter ? 7 : 2.5));
  const kids = p.children.map(id => s.byId.get(id)).filter((c): c is Person => !!c && c.band === p.band && s.age(c) < 14 && s.age(c) >= 2);
  const kidsHungry = kids.reduce((m, c) => Math.max(m, clamp01(1 - c.food / 1.4)), 0);
  const worker = st === "teen" || st === "adult" || st === "elder";
  const elderly = age > 64 ? 0.55 : 1;
  /* providing: each adult means to bring home enough for themselves and the children they feed */
  const feeds = 1 + kids.filter(c => s.age(c) < 12).length * 0.7 + (p.baby ? 0.3 : 0);
  const plenty = clamp01(1 - (storeDays(b) - (leanWinter ? 8 : 4)) / 6);
  const provide = clamp01(1 - p.gaveToday / (1.4 * feeds)) * (0.35 + 0.45 * tr[7] + 0.2 * tr[1]) * (worker ? elderly : 0.4) * plenty;
  const foodDrive = Math.max(hunger, kidsHungry * 1.05, short * (0.6 + 0.3 * tr[7] + 0.2 * tr[1]) * (worker ? elderly : 0.45), provide);
  const busy = (g: Goal) => b.busy.get(g) ?? 0;
  const [fx, fy] = s.fireSpot(p), [hx, hy] = s.homeSpot(p);

  /* --- sleep --- */
  /* the evening is spent at the fire; bed comes once it is properly dark. Caught far out on a mild night, they sleep where they are */
  const bedtime = s.dayFrac() > 0.87 || s.dayFrac() < 0.21;
  const [ox, oy] = s.dryNear(p.x, p.y), far = dc > 40 && T > 6;
  const bed = (dur: number, out: boolean) => out ? [step(St.Sleep, ox, oy, 0, dur)] : [step(St.Go, hx, hy), step(St.Sleep, hx, hy, 0, dur)];
  const rough = (out: boolean) => out ? `, out under the sky because camp is too far to walk back to` : "";
  if (bedtime) add({ g: Goal.Sleep, v: 1.15 + tired, plan: () => bed(40, far), why: () => `${p.name} is sleeping because it is night${rough(far)}${cold > 0.4 ? ` and ${she(p)} is huddled against the cold` : ""}.`, icon: Bubble.Zzz });
  else if (dusk && dc < 30) add({ g: Goal.Sleep, v: 0.1 + tired * tired * 1.1, plan: () => bed(40, false), why: () => `${p.name} is turning in early, tired out from the day.`, icon: Bubble.Zzz });
  else if (p.rest < 0.3) add({ g: Goal.Sleep, v: tired * tired * 1.3, plan: () => bed(14, far), why: () => `${p.name} is napping because ${she(p)} is worn out${rough(far)}.`, icon: Bubble.Zzz });

  /* --- toddlers stay close to their mother or whoever minds them --- */
  if (st === "toddler") {
    const minder = s.byId.get(p.mother) ?? s.byId.get(p.guardian) ?? s.byId.get(p.father);
    if (minder && minder.band === p.band) add({ g: Goal.Toddle, v: 0.6, plan: () => [step(St.Follow, 0, 0, minder.id, 16)], why: () => `${p.name} is toddling after ${her(p)} ${minder.id === p.mother ? "mother" : minder.id === p.father ? "father" : "minder"}, ${minder.name}.` });
    add({ g: Goal.Play, v: 0.4 + tr[5] * 0.2, plan: () => [step(St.Play, b.x + Math.cos(p.id * 3) * 1.5, b.y + Math.sin(p.id * 3) * 1.2, 0, 8)], why: () => `${p.name} is playing by the fire.`, icon: Bubble.Sun });
    if (hunger > 0.3 && storeFood(b.store) > 0.3 && dc < 8) add({ g: Goal.Eat, v: hunger * 1.6, plan: () => [step(St.Go, fx, fy), step(St.Eat, fx, fy, 0, 3)], why: () => `${p.name} is eating because ${she(p)} is hungry.`, icon: Bubble.Meat });
    return pick(s, p, opts);
  }

  /* --- water --- */
  if (thirst > 0.55 || (thirst > 0.4 && p.skin < 0.2)) {
    const wp = nearestWater(s, p);
    if (wp) add({ g: Goal.Drink, v: Math.pow(thirst, 1.3) * 2.3, plan: () => [step(St.Go, wp[0], wp[1]), step(St.Drink, wp[0], wp[1], 0, 1.5)], why: () => `${p.name} is going for a drink because ${she(p)} is thirsty${T > 28 ? " in the heat" : ""}.`, icon: Bubble.Drop });
  }

  /* --- food --- */
  if (hunger > 0.3) {
    if (p.carryAmt > 0 && p.carryKind > 0 && p.carryKind < 4) add({ g: Goal.Eat, v: hunger * 1.9, plan: () => [step(St.Eat, p.x, p.y, 0, 3, { a: 1 })], why: () => `${p.name} is eating some of the ${foodWord(p.carryKind)} ${she(p)} is carrying, because ${she(p)} is hungry.`, icon: Bubble.Meat });
    if (storeFood(b.store) > 0.4) {
      const cook = (b.store.meat + b.store.fish > 0.5) && worker && b.fire > 0.05;
      add({ g: Goal.Eat, v: hunger * 1.8 / (1 + dc / 40), plan: () => [step(St.Go, fx, fy), ...(cook ? [step(St.Cook, fx, fy, 0, 2.5)] : []), step(St.Eat, fx, fy, 0, 2.5)], why: () => eatWhy(s, p, cook), icon: Bubble.Meat });
    }
  }

  /* --- warmth --- */
  if (cold > 0.35 && b.fire > 0.05) add({ g: Goal.Warm, v: Math.pow(cold, 1.2) * 1.7 / (1 + dc / 30), plan: () => [step(St.Go, fx, fy), step(St.Sit, fx, fy, 0, 18, { a: 2 })], why: () => `${p.name} is warming up by the fire because ${she(p)} is ${cold > 0.7 ? "freezing" : "cold"}${s.clothesNow(p) === 0 && T < 10 ? ` and has nothing warm to wear` : ""}.`, icon: Bubble.Cold });

  /* --- work for food: gather, fish, snare, hunt, haul --- */
  if ((worker || (st === "child" && age >= 7)) && !dark && !(p.baby && s.age(s.byId.get(p.baby)!) < 0.3 && dc > 20)) {
    /* late in the day only short trips are worth starting */
    const late = clamp01((s.dayFrac() - 0.6) / 0.14);
    const range = (st === "child" ? 10 : p.baby ? 18 : 30) * (1 - late * 0.7);
    const carry = st === "child" ? 2 : 5;
    let bestPlant: KnownPlace | null = null, bp = 0, bestFish: KnownPlace | null = null, bf = 0, bestRab: KnownPlace | null = null, br = 0, bestGame: KnownPlace | null = null, bg = 0, bestCarc: KnownPlace | null = null, bc = 0;
    for (const pl of p.places) {
      const d = Math.hypot(pl.x - p.x, pl.y - p.y), dfromCamp = Math.hypot(pl.x - b.x, pl.y - b.y);
      if (dfromCamp > range) continue;
      const dF = 1 / (1 + (d + dfromCamp * 0.6) / 16), e = estimate(pl, s.time);
      if (pl.k === Place.Plants) { const E = Math.min(carry, e * 0.35) * (0.6 + p.skills[Skill.Gather] * 0.6), v = E / (E + 1.5) * dF; if (v > bp) { bp = v; bestPlant = pl; } }
      else if (pl.k === Place.Fish && p.knows & Know.Fishing && st !== "child") { const E = Math.min(carry, e * 0.3) * (0.5 + p.skills[Skill.Fish] * 0.8), v = E / (E + 1.5) * dF; if (v > bf) { bf = v; bestFish = pl; } }
      else if (pl.k === Place.Rabbits && p.knows & Know.Snares) { const E = Math.min(2, e * 0.4) * (0.5 + p.skills[Skill.Hunt] * 0.5), v = E / (E + 1.5) * dF; if (v > br) { br = v; bestRab = pl; } }
      else if (pl.k === Place.Game && pl.sp !== undefined && canHunt(s, p, age) && s.time - pl.t < DAY_SECONDS * 1.5) {
        const sp = pl.sp, E = HUNT_P[sp] * (0.5 + p.skills[Skill.Hunt]) * Math.min(MEAT[sp], b.appetite * 3 + 12);
        const v = E / (E + 6) * dF * (0.5 + tr[0] * 0.5 + p.skills[Skill.Hunt] * 0.3) - DANGER[sp] * (1 - tr[0]) * 3;
        if (v > bg) { bg = v; bestGame = pl; }
      }
      else if (pl.k === Place.Carcass && worker && e > 2) {
        /* only worth the walk if the meat is not already spoken for by others on their way */
        const going = b.members.reduce((n, id) => { const q = s.byId.get(id); return n + (q && q.goal === Goal.Haul && q.plan.some(k => k.k === St.Butcher && k.id === pl.ref) ? 1 : 0); }, 0);
        const E = Math.min(6, e - going * 6), v = E > 1 ? E / (E + 2) * dF : 0; if (v > bc) { bc = v; bestCarc = pl; }
      }
    }
    const damp = (g: Goal, k: number) => 1 / (1 + busy(g) * k);
    if (bestPlant) { const pl = bestPlant; add({ g: Goal.Gather, v: foodDrive * bp * 2.1 * damp(Goal.Gather, 0.03), plan: () => gatherPlan(s, p, pl, carry), why: () => workWhy(s, p, Goal.Gather, pl, hunger, kidsHungry, short), icon: Bubble.Berries }); }
    if (bestFish) { const pl = bestFish; add({ g: Goal.Fish, v: foodDrive * bf * 2.1 * damp(Goal.Fish, 0.05), plan: () => fishPlan(s, p, pl), why: () => workWhy(s, p, Goal.Fish, pl, hunger, kidsHungry, short), icon: Bubble.Fish }); }
    if (bestRab) { const pl = bestRab; add({ g: Goal.Snare, v: foodDrive * br * 1.7 * damp(Goal.Snare, 0.12), plan: () => snarePlan(s, p, pl), why: () => workWhy(s, p, Goal.Snare, pl, hunger, kidsHungry, short) }); }
    if (bestGame) { const pl = bestGame; add({ g: Goal.Hunt, v: (foodDrive * 0.9 + tr[3] * 0.22 + tr[0] * 0.12) * bg * 2.1 * damp(Goal.Hunt, 0.04), plan: () => huntPlan(s, p, pl), why: () => workWhy(s, p, Goal.Hunt, pl, hunger, kidsHungry, short), icon: pl.sp === Species.Mammoth ? Bubble.Mammoth : Bubble.Deer }); }
    if (bestCarc) { const pl = bestCarc; add({ g: Goal.Haul, v: (foodDrive + tr[1] * 0.2) * bc * 2 * damp(Goal.Haul, 0.15), plan: () => [step(St.Go, pl.x, pl.y), step(St.Butcher, pl.x, pl.y, pl.ref, 5), step(St.Go, fx, fy), step(St.Drop, fx, fy)], why: () => `${p.name} is fetching meat from the ${SPECIES_SHORT[pl.sp ?? 0]} ${pl.src ? `${s.byId.get(pl.src)?.name ?? "someone"} killed` : "killed"} ${compass(pl.x - b.x, pl.y - b.y)} of camp, before it spoils.`, icon: Bubble.Meat }); }
  }

  /* --- wood for the fire --- */
  if (worker && !night) {
    /* the fire needs feeding, and a woodpile for the night */
    const need = clamp01((0.7 - b.fire) * 1.6 + (4 - b.store.wood) / 6) * (0.5 + clamp01((18 - s.tempC(b.x, b.y)) / 18) + (dusk ? 0.3 : 0));
    if (need > 0.05) {
      const spot = woodSpot(s, b.x, b.y);
      if (spot) add({ g: Goal.Wood, v: need * (0.6 + tr[7] * 0.5) / (1 + busy(Goal.Wood) * 1.3), plan: () => [step(St.Go, spot[0], spot[1]), step(St.Wood, spot[0], spot[1], 0, 6), step(St.Go, fx, fy), step(St.Drop, fx, fy)], why: () => `${p.name} is gathering firewood because ${b.fire < 0.25 ? "the fire is nearly out" : "the woodpile is low"}${s.tempC(b.x, b.y) < 8 ? ` and the nights are cold` : ""}.`, icon: Bubble.Fire });
    }
  }

  /* --- other people --- */
  /* evenings at the fire are for talk */
  const evening = dusk && !bedtime && dc < 10;
  if (!bedtime && (lonely > 0.2 || evening) && st !== "baby") {
    const t = talkTarget(s, p);
    /* an empty belly crowds out a chat in daylight; evenings at the fire are another matter */
    if (t) add({ g: Goal.Talk, v: (lonely * (0.3 + tr[5] * 0.6) * (1 - 0.75 * Math.max(hunger, kidsHungry)) + (evening ? 0.35 + tr[5] * 0.2 : 0)) * 0.8 + (p.moveWish > 0.5 ? 0.1 : 0), plan: () => [step(St.Go, t.x, t.y, t.id), step(St.Talk, 0, 0, t.id, 6)], why: () => talkWhy(s, p, t), icon: Bubble.Sun });
  }
  if (!bedtime && st === "adult" && !p.partner && p.longing > 0.25) {
    const c = courtTarget(s, p);
    /* nobody to court at home: go and visit a band of one's own people */
    if (!c && p.longing > 0.45 && !dark && !p.baby) {
      const other = p.places.filter(pl => pl.k === Place.Camp && pl.ref !== p.band && s.bandById.has(pl.ref)).map(pl => s.bandById.get(pl.ref)!).sort((a, c2) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(c2.x - p.x, c2.y - p.y))[0];
      if (other && Math.hypot(other.x - p.x, other.y - p.y) < 110 && s.walkable(b.x, b.y, other.x, other.y)) {
        const [vx, vy] = s.dryNear(other.x + Math.cos(p.id) * 2, other.y + Math.sin(p.id) * 1.5);
        add({ g: Goal.Visit, v: p.longing * (0.45 + tr[5] * 0.35) * (1 - 0.8 * hunger), plan: () => [step(St.Go, vx, vy), step(St.Sit, vx, vy, 0, 12)], why: () => `${p.name} is visiting the ${other.name}, hoping to find someone to marry. There is nobody for ${herObj(p)} at home.`, icon: Bubble.Heart });
      }
    }
    if (c) add({ g: Goal.Court, v: p.longing * c.a * (0.65 + tr[5] * 0.5) * 1.3 * (1 - 0.6 * hunger), plan: () => [step(St.Go, c.q.x, c.q.y, c.q.id), step(St.Talk, 0, 0, c.q.id, 7, { a: 1 })], why: () => `${p.name} is spending time with ${c.q.name} because ${she(p)} is sweet on ${herObj(c.q)}${s.op(c.q, p.id) > 0.3 ? `, and ${c.q.name} seems to like ${herObj(p)} back` : ""}.`, icon: Bubble.Heart });
  }
  if (worker && !night) {
    const sickOne = tendTarget(s, p);
    if (sickOne) add({ g: Goal.Tend, v: sickOne.v / (1 + busy(Goal.Tend) * 1.2), plan: () => [step(St.Go, sickOne.q.x, sickOne.q.y, sickOne.q.id), step(St.Tend, 0, 0, sickOne.q.id, 14)], why: () => `${p.name} is looking after ${sickOne.q.name}, who is ${sickOne.q.sick > 0 ? "sick" : "hurt"}${sickOne.kin ? `, because family looks after family` : `, because ${she(p)} is kind-hearted`}.`, icon: Bubble.Heart });
  }

  /* --- children: play, and tag along to learn --- */
  if ((st === "child" || (st === "teen" && age < 14)) && !dark) {
    add({ g: Goal.Play, v: 0.48 + (1 - tr[7]) * 0.14 + tr[5] * 0.16, plan: () => [step(St.Play, b.x + Math.cos(p.id * 7 + s.time / 60) * 3, b.y + Math.sin(p.id * 7 + s.time / 60) * 2.2, 0, 9)], why: () => playWhy(s, p), icon: Bubble.Sun });
    const parent = [s.byId.get(p.mother), s.byId.get(p.father)].find(q => q && q.band === p.band && (q.goal === Goal.Gather || q.goal === Goal.Fish || q.goal === Goal.Snare || q.goal === Goal.Wood || q.goal === Goal.Craft));
    if (parent && age >= 5) add({ g: Goal.Follow, v: 0.42 + tr[4] * 0.3, plan: () => [step(St.Follow, 0, 0, parent.id, 24)], why: () => `${p.name} is tagging along with ${her(p)} ${parent.id === p.mother ? "mother" : "father"} to learn ${LEARN[parent.goal] ?? "how things are done"}.` });
  }

  /* --- making things --- */
  if (worker && !night && p.knows & Know.Hides && b.store.hides >= 1) {
    const who = needsClothes(s, p);
    if (who) add({ g: Goal.Craft, v: 0.55 * (0.4 + tr[7] * 0.6), plan: () => [step(St.Go, fx, fy), step(St.Craft, fx, fy, who.id, 14)], why: () => `${p.name} is sewing ${s.tempC(b.x, b.y) < 0 ? "furs" : "hide clothes"} for ${who === p ? "${her}self".replace("${her}", her(p)) : who.name} because ${who === p ? `${her(p)} own are worn thin` : `${who.name} has nothing warm to wear`}.` });
  }
  if (age >= 14 && age <= 62 && p.spear < 0.25 && p.knows & Know.Spear && !night && !p.pregnantBy) add({ g: Goal.Spear, v: 0.4 + tr[3] * 0.15 + tr[7] * 0.15, plan: () => [step(St.Go, fx, fy), step(St.Knap, fx, fy, 0, 10)], why: () => p.spear <= 0 && s.age(p) < 18 ? `${p.name} is knapping ${her(p)} first spear point, old enough now to hunt.` : `${p.name} is knapping a new spear point because ${her(p)} old spear ${p.spear <= 0 ? "broke" : "is falling apart"}.` });

  /* --- exploring --- */
  if (worker && !dark && age < 60 && p.injury < 0.2 && !(p.baby && s.age(s.byId.get(p.baby)!) < 1)) {
    const food = p.places.filter(pl => pl.k === Place.Plants || pl.k === Place.Fish).length;
    const v = tr[4] * 0.26 * (1 - p.fear) * (foodDrive < 0.5 ? 1 : 0.4) + Math.max(p.moveWish, p.leaveWish) * 0.45 + (food < 4 ? 0.1 : 0) + short * 0.12;
    add({ g: Goal.Explore, v: v / (1 + busy(Goal.Explore) * 1.2), plan: () => explorePlan(s, p), why: () => exploreWhy(p), icon: Bubble.Question });
  }

  /* --- resting at camp --- */
  add({ g: Goal.Rest, v: 0.14 + tired * 0.3 + (age > 60 ? 0.15 : 0) + (p.baby ? 0.12 : 0), plan: () => [step(St.Go, fx, fy), step(St.Sit, fx, fy, 0, 10)], why: () => restWhy(s, p), icon: p.baby ? Bubble.Baby : undefined });

  pick(s, p, opts);
}

/*
  Cut off from the band by water: the ice went out under a winter crossing, or the band
  moved on. Someone stranded with nobody to wait for goes to live with a band they know
  and can walk to. Otherwise they live off the land where they are, drinking where they
  can, eating what they gather and sleeping rough, until the ice comes back.
*/
function stranded(s: Society, p: Person): void {
  const b = s.band(p), age = s.age(p);
  const family = b.members.some(id => id === p.partner || (p.children.includes(id) && s.age(s.byId.get(id)!) < 14));
  if (!family || age < 14) {
    const camps = p.places.filter(pl => pl.k === Place.Camp && pl.ref !== b.id).map(pl => s.bandById.get(pl.ref)).filter((o): o is NonNullable<typeof o> => !!o && !o.moving && s.walker.reach(p.x, p.y, o.x, o.y));
    const to = camps.sort((a, c) => (a.culture === b.culture ? 0 : 80) + Math.hypot(a.x - p.x, a.y - p.y) - (c.culture === b.culture ? 0 : 80) - Math.hypot(c.x - p.x, c.y - p.y))[0];
    if (to) {
      s.moveTo(p, to);
      s.event("leave", Bubble.Home, `${p.name}, ${s.time < p.lost ? "unable to find the way back to" : "cut off by the water from"} the ${b.name}, went to live with the ${to.name}.`, p.x, p.y, [p.id], to.id);
      p.lost = 0;
      decide(s, p); return;
    }
  }
  const opts: Option[] = [];
  const add = (o: Option) => { if (o.v > 0) opts.push(o); };
  const hunger = clamp01(1 - p.food / 1.4), thirst = clamp01(1 - p.water), tired = 1 - p.rest;
  const night = s.dayFrac() > 0.87 || s.dayFrac() < 0.21;
  const alone = s.time < p.lost && s.walker.reach(p.x, p.y, b.x, b.y) ? `${p.name} cannot find the way back to the ${b.name}` : `${p.name} is cut off from the ${b.name} by the water`;
  const w = s.waterNear(p.x, p.y, 14);
  if (w && thirst > 0.35 && s.walker.reach(p.x, p.y, w[0], w[1])) add({ g: Goal.Drink, v: thirst * 2.3, plan: () => [step(St.Go, w[0], w[1]), step(St.Drink, w[0], w[1], 0, 1.5)], why: () => `${alone}, and is going for a drink.`, icon: Bubble.Drop });
  if (night || p.rest < 0.3) add({ g: Goal.Sleep, v: (night ? 1.15 : 0) + tired, plan: () => [step(St.Sleep, p.x, p.y, 0, night ? 40 : 14)], why: () => `${alone}, and is sleeping rough.`, icon: Bubble.Zzz });
  if (!night) {
    if (p.carryAmt > 0 && p.carryKind > 0 && p.carryKind < 4 && hunger > 0.2) add({ g: Goal.Eat, v: hunger * 1.9, plan: () => [step(St.Eat, p.x, p.y, 0, 3, { a: 1 })], why: () => `${alone}, and is eating the ${foodWord(p.carryKind)} ${she(p)} found.`, icon: Bubble.Meat });
    let patch: [number, number] = [p.x, p.y], bv = s.eco.plantsAt(p.x, p.y) * 0.06;
    for (const pl of p.places) if (pl.k === Place.Plants) { const d = Math.hypot(pl.x - p.x, pl.y - p.y); const v = estimate(pl, s.time) / (1 + d / 10); if (d < 25 && v > bv && s.walker.reach(p.x, p.y, pl.x, pl.y)) { bv = v; patch = [pl.x, pl.y]; } }
    add({ g: Goal.Gather, v: 0.2 + hunger * 1.5, plan: () => [step(St.Go, patch[0], patch[1]), step(St.Gather, patch[0], patch[1], 0, 4.5, { a: 3 }), step(St.Eat, patch[0], patch[1], 0, 3, { a: 1 })], why: () => `${alone}, and is living off the land, gathering what ${she(p)} can find to eat.`, icon: Bubble.Berries });
    add({ g: Goal.Explore, v: 0.15 + p.traits[4] * 0.2, plan: () => [step(St.Look, p.x, p.y, 0, 3)], why: () => `${alone}, and is looking for a way back.`, icon: Bubble.Question });
  }
  add({ g: Goal.Rest, v: 0.1, plan: () => [step(St.Sit, p.x, p.y, 0, 8)], why: () => `${alone}, and is resting${family && s.time >= p.lost ? `, waiting for the ice to come back` : ""}.` });
  for (const o of opts) o.v *= 0.92 + s.rng.next() * 0.16;
  opts.sort((a, c) => c.v - a.v);
  for (const o of opts) if (commit(s, p, o)) return;
}

function pick(s: Society, p: Person, opts: Option[]): void {
  /* a little noise so people are not perfectly predictable */
  for (const o of opts) o.v *= 0.92 + s.rng.next() * 0.16;
  opts.sort((a, c) => c.v - a.v);
  for (const o of opts.slice(0, 4)) if (commit(s, p, o)) return;
  const [fx, fy] = s.fireSpot(p);
  commit(s, p, { g: Goal.Rest, v: 0.1, plan: () => [step(St.Go, fx, fy), step(St.Sit, fx, fy, 0, 6)], why: () => restWhy(s, p) });
}
const TRIPS = new Set<Goal>([Goal.Gather, Goal.Fish, Goal.Snare, Goal.Hunt, Goal.Haul, Goal.Wood, Goal.Explore, Goal.Visit]);
function commit(s: Society, p: Person, o: Option): boolean {
  const plan = o.plan(); if (!plan || !plan.length) return false;
  const b = s.band(p), dc = Math.hypot(p.x - b.x, p.y - b.y);
  /* before a trip out, a drink and a full water skin from the camp's water */
  const [wx, wy] = b.water;
  if (TRIPS.has(o.g) && dc < 8 && s.age(p) >= 12 && (p.skin < 0.5 || p.water < 0.75) && s.walker.reach(p.x, p.y, wx, wy)) plan.unshift(step(St.Go, wx, wy), step(St.Drink, wx, wy, 0, 1.5));
  /* anything carried goes into the store first, unless the plan is to eat it, haul more, or drink */
  if (p.carryAmt > 0 && o.g !== Goal.Eat && o.g !== Goal.Flee && o.g !== Goal.Migrate && o.g !== Goal.Drink && !plan.some(k => k.k === St.Drop || k.k === St.Eat)) {
    if (dc < 40 && s.walker.reach(p.x, p.y, b.x, b.y)) { const [fx, fy] = s.fireSpot(p); plan.unshift(step(St.Go, fx, fy), step(St.Drop, fx, fy)); }
  }
  p.plan = plan; p.si = 0; p.goal = o.g; p.why = o.why(); p.whyAt = s.time;
  /* a picture over their head only for the moments that matter, not every drink of water */
  if (o.icon && (o.g === Goal.Flee || o.g === Goal.Sick || (o.g === Goal.Warm && p.warmth < 0.35) || (o.g === Goal.Eat && p.food < 0.3) || (o.g === Goal.Migrate && s.rng.chance(0.15)))) s.bubble(p, o.icon, 2.5);
  return true;
}

/* ---------------- plans ---------------- */

function gatherPlan(s: Society, p: Person, pl: KnownPlace, carry: number): Step[] {
  const [fx, fy] = s.fireSpot(p);
  const n = carry > 2 ? 2 : 1;
  const out = [step(St.Go, pl.x, pl.y)];
  for (let k = 0; k < n; k++) out.push(step(St.Gather, pl.x + (k ? 0.7 : 0), pl.y, 0, 4.5, { a: carry }));
  out.push(step(St.Go, fx, fy), step(St.Drop, fx, fy));
  return out;
}
function fishPlan(s: Society, p: Person, pl: KnownPlace): Step[] {
  const [fx, fy] = s.fireSpot(p);
  return [step(St.Go, pl.x, pl.y), step(St.Fish, pl.x, pl.y, 0, 10), step(St.Go, fx, fy), step(St.Drop, fx, fy)];
}
function snarePlan(s: Society, p: Person, pl: KnownPlace): Step[] {
  const [fx, fy] = s.fireSpot(p);
  return [step(St.Go, pl.x, pl.y), step(St.Snare, pl.x, pl.y, 0, 8), step(St.Go, fx, fy), step(St.Drop, fx, fy)];
}
/** A hunt: gather a party at camp if anyone will come, go where the herd was, stalk it, strike, butcher, carry the meat home. */
function huntPlan(s: Society, p: Person, pl: KnownPlace): Step[] {
  const [fx, fy] = s.fireSpot(p);
  p.party = p.id;
  recruit(s, p, pl);
  return [step(St.Go, pl.x, pl.y), step(St.Stalk, pl.x, pl.y, pl.ref, 40), step(St.Butcher, 0, 0, 0, 6), step(St.Go, fx, fy), step(St.Drop, fx, fy)];
}
function recruit(s: Society, lead: Person, pl: KnownPlace): void {
  const big = pl.sp === Species.Mammoth || pl.sp === Species.Aurochs ? 3 : pl.sp === Species.Horse ? 2 : 1;
  let joined = 0;
  for (const q of s.near(lead.x, lead.y, 9)) {
    if (joined >= big || q === lead || q.band !== lead.band || q.party || !isInterruptible(q.goal) && q.goal !== Goal.None) continue;
    const age = s.age(q); if (!canHunt(s, q, age) || q.food < 0.3 || q.water < 0.3) continue;
    const willing = 0.25 + s.op(q, lead.id) * 0.5 + q.traits[0] * 0.3 + q.traits[7] * 0.15 - (q.baby ? 0.4 : 0);
    if (s.rng.next() > willing) continue;
    q.plan = [step(St.Go, pl.x + (s.rng.next() - 0.5) * 2, pl.y + (s.rng.next() - 0.5) * 2), step(St.Stalk, pl.x, pl.y, pl.ref, 40), step(St.Butcher, 0, 0, 0, 6), step(St.Go, ...s.fireSpot(q)), step(St.Drop, ...s.fireSpot(q))];
    q.si = 0; q.path = null; q.goal = Goal.Hunt; q.party = lead.id; q.whyAt = s.time;
    q.why = `${q.name} is hunting ${SPECIES_SHORT[pl.sp ?? 0]} with ${lead.name}, because ${lead.name} asked for help and the band needs meat.`;
    joined++;
  }
}
function explorePlan(s: Society, p: Person): Step[] | null {
  const b = s.band(p), [fx, fy] = s.fireSpot(p);
  /* head somewhere new: away from the places already known */
  let bx = 0, by = 0, n = 0;
  for (const pl of p.places) { bx += pl.x - b.x; by += pl.y - b.y; n++; }
  const away = n ? Math.atan2(-by, -bx) : s.rng.next() * Math.PI * 2;
  for (let tries = 0; tries < 8; tries++) {
    const a = away + (s.rng.next() - 0.5) * 2.4, d = s.rng.range(14, 28);
    const x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
    if (!s.walker.dry(x, y)) continue;
    return [step(St.Go, x, y), step(St.Look, x, y, 0, 4), step(St.Go, fx, fy)];
  }
  return null;
}

/* ---------------- helpers ---------------- */

export const HUNT_P = [0.42, 0.24, 0.17, 0.32, 0, 0.12];
export const DANGER = [0.004, 0.04, 0.05, 0.01, 0, 0.12];
export const SPECIES_SHORT = ["deer", "aurochs", "mammoth", "horses", "wolves", "bear"];
const LEARN: Partial<Record<number, string>> = { [Goal.Gather]: "which plants are good to eat", [Goal.Fish]: "how to fish", [Goal.Snare]: "how to set snares", [Goal.Wood]: "how to keep a fire", [Goal.Craft]: "how to work hides" };

function canHunt(s: Society, p: Person, age: number): boolean {
  if (age < 15 || age > 62 || p.spear < 0.1 || !(p.knows & Know.Spear) || p.injury > 0.25) return false;
  if (p.pregnantBy && s.time > p.due - 2400 * 0.4) return false;
  if (p.baby) { const b = s.byId.get(p.baby); if (b && b.carrier === p.id) return false; }
  return true;
}
/**
  Where to drink: water close by that they can see, or the nearest water they know of,
  favoring water on the way home over water that takes them further off. Everyone knows
  where their own camp draws its water.
*/
function nearestWater(s: Society, p: Person): [number, number] | null {
  const b = s.band(p), [hx, hy] = b.moving ? [b.moving.x, b.moving.y] : [b.x, b.y], dHome = Math.hypot(hx - p.x, hy - p.y);
  const cost = (x: number, y: number) => Math.hypot(x - p.x, y - p.y) + 0.6 * Math.max(0, Math.hypot(hx - x, hy - y) - dHome);
  let best: [number, number] | null = null, bc = 1e9;
  const consider = (x: number, y: number) => { const c = cost(x, y); if (c < bc && s.walker.reach(p.x, p.y, x, y)) { bc = c; best = [x, y]; } };
  for (const pl of p.places) if (pl.k === Place.Water) consider(pl.x, pl.y);
  consider(b.water[0], b.water[1]);
  if (bc > 4) {
    const w = s.waterNear(p.x, p.y, 16);
    if (w && cost(w[0], w[1]) < bc && s.walker.reach(p.x, p.y, w[0], w[1])) { s.learnPlace(p, Place.Water, w[0], w[1], 1, 0, 0); best = w; }
  }
  return best;
}
export function woodSpot(s: Society, x: number, y: number): [number, number] | null {
  const W = s.w.w;
  let best: [number, number] | null = null, bd = 1e9;
  for (let k = 0; k < 40; k++) {
    const a = s.rng.next() * Math.PI * 2, r = 2 + s.rng.next() * 16, tx = Math.floor(x + Math.cos(a) * r), ty = Math.floor(y + Math.sin(a) * r);
    if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= s.w.h - 1) continue;
    const t = s.w.tree[ty * W + tx]; if (!t || t === Tree.Reeds || t === Tree.Cactus) continue;
    /* stand beside the tree, on dry ground */
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) { const sx = tx + dx + 0.5, sy = ty + dy + 0.5; if (s.walker.dry(sx, sy)) { const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = [sx, sy]; } break; } }
  }
  return best;
}
function talkTarget(s: Society, p: Person): Person | null {
  let best: Person | null = null, bv = -1;
  const pAge = s.age(p);
  for (const q of s.near(p.x, p.y, 14)) {
    if (q === p || q.carrier || q.goal === Goal.Sleep || q.goal === Goal.Flee || q.goal === Goal.Sick || q.goal === Goal.Migrate) continue;
    const qAge = s.age(q); if (qAge < 4) continue;
    if ((pAge < 13) !== (qAge < 13) && !(q.id === p.mother || q.id === p.father || p.id === q.mother || p.id === q.father)) continue;
    const r = p.rel.get(q.id); if (!r && q.band !== p.band) continue;
    const v = (r?.op ?? 0) + (r?.fam ?? 0) * 0.3 + (q.id === p.partner ? 0.35 : 0) + (isInterruptible(q.goal) ? 0.3 : -0.4) - Math.hypot(q.x - p.x, q.y - p.y) * 0.02 + s.rng.next() * 0.3;
    if (v > bv) { bv = v; best = q; }
  }
  return bv > -0.2 ? best : null;
}
/** Who someone single is drawn to: of an age to suit, not close kin, healthy, respected, kind, and liked. */
export function attraction(s: Society, p: Person, q: Person): number {
  if (q.sex === p.sex || q.partner || s.kin(p, q, s.culture(p).cousins ? 1 : 2)) return 0;
  const a = s.age(p), b = s.age(q);
  if (b < 16 || b > 52) return 0;
  const pref = p.sex === "m" ? -2 : 2, fit = Math.exp(-(((b - a - pref) / 7) ** 2));
  return fit * (0.45 + q.health * 0.2 + Math.min(1, q.prestige) * 0.2 + q.traits[1] * 0.15) * (0.55 + s.op(p, q.id) * 0.6);
}
function courtTarget(s: Society, p: Person): { q: Person; a: number } | null {
  let best: Person | null = null, ba = 0.12;
  for (const q of s.near(p.x, p.y, 30)) {
    if (q.goal === Goal.Sleep || q.carrier) continue;
    if (q.band !== p.band && !p.rel.has(q.id)) continue;
    const a = attraction(s, p, q); if (a > ba) { ba = a; best = q; }
  }
  return best ? { q: best, a: ba } : null;
}
function tendTarget(s: Society, p: Person): { q: Person; v: number; kin: boolean } | null {
  let best: { q: Person; v: number; kin: boolean } | null = null;
  for (const id of s.band(p).members) {
    const q = s.byId.get(id); if (!q || q === p || (q.sick <= 0 && q.injury < 0.3)) continue;
    const kin = s.kin(p, q, 1) || q.id === p.partner;
    const v = (q.sick > 0 ? 0.65 : q.injury) * (0.25 + p.traits[1] * 0.8) * (kin ? 1.4 : 0.5 + s.op(p, q.id));
    if (!best || v > best.v) best = { q, v, kin };
  }
  return best;
}
function needsClothes(s: Society, p: Person): Person | null {
  const b = s.band(p), winter = s.tempC(b.x, b.y, s.time + 1200);
  const want = winter < -2 ? 2 : winter < 10 ? 1 : 0;
  let best: Person | null = null, bv = 0;
  for (const id of b.members) {
    const q = s.byId.get(id); if (!q || q.carrier) continue;
    const gap = want - q.clothes + (q.clothesWear < 0.25 ? 0.5 : 0);
    const v = gap * (q === p ? 1 : s.kin(p, q, 1) || q.id === p.partner ? 0.9 : 0.25 + p.traits[1] * 0.4);
    if (v > bv) { bv = v; best = q; }
  }
  return bv >= 0.5 ? best : null;
}

/* ---------------- why ---------------- */

function dangerSeen(p: Person): string {
  const d = p.places.filter(pl => pl.k === Place.Danger).sort((a, c) => c.t - a.t)[0];
  return d && d.sp === Species.Bear ? "a bear" : "wolves";
}
function foodWord(kind: number): string { return kind === 2 ? "meat" : kind === 3 ? "fish" : "food"; }
/** What grows at a place in this season, in words. */
export function plantWord(s: Society, x: number, y: number): string {
  const i = (y | 0) * s.w.w + (x | 0), t = s.w.tree[i], b = s.w.biome[i], season = s.season;
  if (s.w.flags[i] & Flag.Coast && (b === Biome.Beach || b === Biome.Shingle)) return "shellfish";
  if (t === Tree.BerryBush) return season === 0 ? "fresh shoots" : season === 3 ? "dried berries and roots" : "berries";
  if (t === Tree.Oak) return season === 2 ? "acorns" : "roots and greens";
  if (t === Tree.Beech) return season === 2 ? "beechnuts" : "roots and greens";
  if (t === Tree.Palm) return "dates and coconuts";
  if (t === Tree.Baobab) return "baobab fruit";
  if (t === Tree.Reeds) return "cattail roots";
  if (b === Biome.Grassland || b === Biome.ColdSteppe || b === Biome.Savanna) return season === 2 ? "seeds and tubers" : "roots and tubers";
  if (b === Biome.TropicalForest || b === Biome.Rainforest) return "fruit and tubers";
  if (b === Biome.Taiga || b === Biome.Tundra) return season === 1 || season === 2 ? "berries" : "lichen and roots";
  return season === 2 ? "nuts and mushrooms" : season === 3 ? "roots" : "greens and berries";
}
function where(s: Society, p: Person, x: number, y: number): string {
  const b = s.band(p), d = Math.hypot(x - b.x, y - b.y), i = (y | 0) * s.w.w + (x | 0);
  const W = s.w.w; let river = false, lake = false, sea = false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const f = s.w.flags[i + dy * W + dx]; if (f & Flag.River) river = true; if (f & Flag.Lake) lake = true; if (f & Flag.Ocean) sea = true; }
  const by = sea ? "on the shore" : lake ? "by the lake" : river ? "by the river" : "";
  if (d < 9) return by ? `${by} near camp` : "near camp";
  return `${by ? by + " " : ""}${d < 22 ? "a short walk" : "a long walk"} ${compass(x - b.x, y - b.y)} of camp`;
}
function heard(s: Society, p: Person, pl: KnownPlace): string {
  if (!pl.src) return "";
  const who = s.byId.get(pl.src)?.name ?? s.archive.get(pl.src)?.name;
  return who ? ` ${who} told ${herObj(p)} about it.` : "";
}
function workWhy(s: Society, p: Person, g: Goal, pl: KnownPlace, hunger: number, kidsHungry: number, short: number): string {
  const kids = p.children.map(id => s.byId.get(id)).filter((c): c is Person => !!c && s.age(c) < 14);
  const reason = kidsHungry > Math.max(hunger, short) && kids.length ? `${her(p)} ${kids.length > 1 ? "children are" : (kids[0].sex === "f" ? "daughter is" : "son is")} hungry`
    : hunger > short ? `${she(p)} is hungry` : short > 0.5 ? `there is little left to eat at camp` : `the band will need food tomorrow`;
  const place = where(s, p, pl.x, pl.y);
  switch (g) {
    case Goal.Gather: return `${p.name} is gathering ${plantWord(s, pl.x, pl.y)} ${place}, because ${reason}.${heard(s, p, pl)}`;
    case Goal.Fish: return `${p.name} is fishing ${place} because ${reason}${pl.src ? "" : ` and the fish were biting there`}.${heard(s, p, pl)}`;
    case Goal.Snare: return `${p.name} is setting snares for rabbits ${place}, because ${reason}.${heard(s, p, pl)}`;
    default: {
      const sp = SPECIES_SHORT[pl.sp ?? 0];
      return `${p.name} is hunting ${sp} ${place}, because ${reason}${p.traits[3] > 0.6 ? ` and a big kill would earn ${herObj(p)} respect` : ""}.${pl.src ? heard(s, p, pl) : ` ${She(p)} saw the herd there.`}`;
    }
  }
}
const She = (p: Person) => (p.sex === "f" ? "She" : "He");
function eatWhy(s: Society, p: Person, cook: boolean): string {
  const b = s.band(p);
  const what = b.store.meat > b.store.plant && b.store.meat > b.store.fish ? "meat" : b.store.fish > b.store.plant ? "fish" : "food";
  return `${p.name} is ${cook ? "cooking and eating" : "eating"} ${what} from the band's store, because ${she(p)} is hungry.`;
}
function talkWhy(s: Society, p: Person, q: Person): string {
  const op = s.op(p, q.id), kin = q.id === p.partner ? (p.sex === "f" ? "her husband" : "his wife") : q.id === p.mother ? `${her(p)} mother` : q.id === p.father ? `${her(p)} father` : q.mother === p.id || q.father === p.id ? `${her(p)} ${q.sex === "f" ? "daughter" : "son"}` : "";
  const who = kin ? `${kin}, ${q.name}` : q.name;
  return `${p.name} is chatting with ${who} because ${she(p)} ${op > 0.5 ? `is fond of ${herObj(q)}` : op > 0.2 ? "likes the company" : "wanted someone to talk to"}${p.moveWish > 0.5 ? `, and wants to talk about moving camp` : ""}.`;
}
function playWhy(s: Society, p: Person): string {
  const kids = s.near(p.x, p.y, 8).filter(q => q !== p && s.age(q) >= 3 && s.age(q) < 13);
  return kids.length ? `${p.name} is playing with ${kids.slice(0, 2).map(k => k.name).join(" and ")}${kids.length > 2 ? " and the others" : ""}.` : `${p.name} is playing near camp.`;
}
function exploreWhy(p: Person): string {
  if (p.leaveWish > 0.5) return `${p.name} is scouting for a place of ${her(p)} own, because the band has grown crowded.`;
  if (p.moveWish > 0.45) return `${p.name} is scouting for a better camp, because the food around this one is running out.`;
  return `${p.name} is exploring, because ${she(p)} wants to see what lies beyond the places ${she(p)} knows.`;
}
function restWhy(s: Society, p: Person): string {
  const baby = p.baby ? s.byId.get(p.baby) : null;
  if (baby && baby.carrier === p.id) return `${p.name} is sitting by the fire with ${her(p)} baby, ${baby.name}.`;
  if (s.age(p) > 60) return `${p.name} is resting by the fire. ${Her(p)} legs are not what they were.`;
  return `${p.name} is resting by the fire because there is nothing pressing to do.`;
}
function siteReason(s: Society, p: Person, x: number, y: number): string {
  let plants = 0, fish = 0, game = 0;
  for (const pl of p.places) { if (Math.hypot(pl.x - x, pl.y - y) > 30) continue; if (pl.k === Place.Plants) plants += pl.q; else if (pl.k === Place.Fish) fish += pl.q; else if (pl.k === Place.Game) game += pl.q; }
  const best = Math.max(plants, fish, game * 2);
  return best === 0 ? "fresh land" : best === plants ? `plenty of ${plantWord(s, x, y)} to gather` : best === fish ? "good fishing" : "game to hunt";
}
