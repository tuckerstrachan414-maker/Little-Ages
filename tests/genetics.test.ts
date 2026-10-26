import { describe, it, expect } from "vitest";
import { Rng } from "../src/shared/rng.ts";
import { ancestryFor, founderGenome, inherit, looksOf, carries, dose, temperament, hairWord, locusOf, type Genome } from "../src/sim/people/genetics.ts";
import { makeLanguage, personName, placeName } from "../src/sim/people/language.ts";

const noise = (r: Rng) => [r.gauss(), r.gauss(), r.gauss(), r.gauss(), r.gauss()];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };

describe("genetics", () => {
  const r = new Rng(42);
  const tropical = ancestryFor(1, 0, 1, r), polar = ancestryFor(0.12, 0.9, 0.2, r);

  it("founders fit their land: sunny homelands give darker skin, the far north fairer skin and more blue eyes", () => {
    const melT = mean(Array.from({ length: 200 }, () => looksOf(founderGenome(tropical, r), noise(r)).mel));
    const melP = mean(Array.from({ length: 200 }, () => looksOf(founderGenome(polar, r), noise(r)).mel));
    expect(melT).toBeGreaterThan(0.8); expect(melP).toBeLessThan(0.3);
    expect(polar.eyeBlue).toBeGreaterThan(tropical.eyeBlue);
  });

  it("a child of a dark and a light parent lands in between, and siblings differ", () => {
    const mom = founderGenome(tropical, r), dad = founderGenome(polar, r);
    const mMel = looksOf(mom, [0, 0, 0, 0, 0]).mel, dMel = looksOf(dad, [0, 0, 0, 0, 0]).mel;
    const kids = Array.from({ length: 40 }, () => looksOf(inherit(mom, dad, r), noise(r)));
    const kidMel = kids.map(k => k.mel);
    for (const m of kidMel) { expect(m).toBeGreaterThan(Math.min(mMel, dMel)); expect(m).toBeLessThan(Math.max(mMel, dMel)); }
    expect(Math.abs(mean(kidMel) - (mMel + dMel) / 2)).toBeLessThan(0.06);
    expect(sd(kidMel)).toBeGreaterThan(0.01);
    expect(sd(kids.map(k => k.heightG))).toBeGreaterThan(0.05);
  });

  it("each child gets exactly one copy of every locus from each parent", () => {
    const mom = founderGenome(tropical, r), dad = founderGenome(polar, r), kid = inherit(mom, dad, r, 0);
    for (let l = 0; l < kid.length / 2; l++) {
      expect([mom[l * 2], mom[l * 2 + 1]]).toContain(kid[l * 2]);
      expect([dad[l * 2], dad[l * 2 + 1]]).toContain(kid[l * 2 + 1]);
    }
  });

  it("height runs in families: tall parents have tall children", () => {
    const anc = ancestryFor(0.5, 0.4, 0.5, r), pairs: [number, number][] = [];
    for (let k = 0; k < 400; k++) {
      const m = founderGenome(anc, r), d = founderGenome(anc, r), c = inherit(m, d, r);
      pairs.push([(looksOf(m, noise(r)).heightG + looksOf(d, noise(r)).heightG) / 2, looksOf(c, noise(r)).heightG]);
    }
    const mx = mean(pairs.map(p => p[0])), my = mean(pairs.map(p => p[1]));
    const cov = mean(pairs.map(([x, y]) => (x - mx) * (y - my))), vx = mean(pairs.map(([x]) => (x - mx) ** 2));
    const slope = cov / vx;   /* midparent-offspring slope estimates heritability */
    expect(slope).toBeGreaterThan(0.5); expect(slope).toBeLessThan(1.15);
  });

  it("red hair and blue eyes are recessive: they can skip a generation", () => {
    /* two light-haired parents who each carry one red and one blue allele */
    const anc = { ...ancestryFor(0.2, 0.6, 0.3, r), red: 0, eyeBlue: 0, hairDark: 0.3 };
    let mom: Genome, dad: Genome;
    do { mom = founderGenome(anc, r); } while (looksOf(mom, [0, 0, 0, 0, 0]).mel > 0.3);
    do { dad = founderGenome(anc, r); } while (looksOf(dad, [0, 0, 0, 0, 0]).mel > 0.3);
    const setHet = (g: Genome, key: "red" | "eyeBlue") => { const o = locusOf(key); g[o * 2] = 1; g[o * 2 + 1] = 0; };
    setHet(mom, "red"); setHet(dad, "red"); setHet(mom, "eyeBlue"); setHet(dad, "eyeBlue");
    expect(looksOf(mom, [0, 0, 0, 0, 0]).red).toBe(false); expect(carries(mom, "red")).toBe(true);
    const kids = Array.from({ length: 2000 }, () => looksOf(inherit(mom, dad, r, 0), noise(r)));
    const redShare = kids.filter(k => k.red).length / kids.length, blueShare = kids.filter(k => k.eyeName === "blue" || k.eyeName === "gray" || k.eyeName === "green").length / kids.length;
    expect(redShare).toBeGreaterThan(0.17); expect(redShare).toBeLessThan(0.3);
    expect(blueShare).toBeGreaterThan(0.2); expect(blueShare).toBeLessThan(0.3);
  });

  it("temperament is partly inherited", () => {
    const anc = ancestryFor(0.6, 0.3, 0.6, r), xs: number[] = [], ys: number[] = [];
    for (let k = 0; k < 600; k++) { const m = founderGenome(anc, r), d = founderGenome(anc, r), c = inherit(m, d, r); xs.push((temperament(m, r)[0] + temperament(d, r)[0]) / 2); ys.push(temperament(c, r)[0]); }
    const mx = mean(xs), my = mean(ys), cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my))), corr = cov / (sd(xs) * sd(ys));
    expect(corr).toBeGreaterThan(0.1); expect(corr).toBeLessThan(0.6);
    expect(dose(founderGenome(anc, r), "temper", 0, 4)).toBeGreaterThanOrEqual(0);
  });

  it("hair darkens through childhood and grays in old age", () => {
    const l = looksOf(founderGenome(polar, r), [0, 0, 0, 0, 0]);
    expect(["white", "gray"]).toContain(hairWord({ ...l, grayEarly: 1 }, 80));
    expect(hairWord(l, 25)).not.toBe("white");
  });
});

describe("languages", () => {
  it("are deterministic and each sounds like itself", () => {
    const a = makeLanguage(1, 99), b = makeLanguage(1, 99), c = makeLanguage(2, 99);
    expect(a).toEqual(b);
    const r1 = new Rng(1), r2 = new Rng(1);
    expect(personName(a, r1, "f")).toBe(personName(b, r2, "f"));
    const namesA = new Set(Array.from({ length: 60 }, () => personName(a, r1, "m"))), namesC = new Set(Array.from({ length: 60 }, () => personName(c, r1, "m")));
    let shared = 0; for (const n of namesA) if (namesC.has(n)) shared++;
    expect(shared).toBeLessThan(6);
  });

  it("makes names you can say", () => {
    for (let id = 0; id < 30; id++) {
      const l = makeLanguage(id, 7), r = new Rng(id);
      for (let k = 0; k < 40; k++) {
        const n = personName(l, r, k % 2 ? "f" : "m"), p = placeName(l, r);
        for (const w of [n, p]) { expect(w.length).toBeGreaterThanOrEqual(3); expect(w.length).toBeLessThanOrEqual(8); expect(w).toMatch(/^[A-Z][a-z]+$/); expect(w.toLowerCase()).not.toMatch(/[aeiouy]{3}/); }
      }
    }
  });
});
