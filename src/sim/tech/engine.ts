import { Flag } from "../../shared/types.ts";
import type { Person } from "../people/person.ts";
import type { Society } from "../people/society.ts";
import { compass } from "../people/society.ts";
import type { Ctx, TechDef } from "./defs.ts";
import { Problem, PROBLEM_WORDS, CTX_PROBLEMS, strongest, type ProblemKey } from "./problems.ts";

/*
  The generic side of working things out: for a node with no hand-written hook, how badly
  it is wanted is the band's problems weighed by what the node answers, and the story of its
  finding is a template with the moment filled in.
*/

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** How badly someone needs a node, from the band's wants and the moment: 0..1. */
export function genericPressure(s: Society, p: Person, d: TechDef, c: Ctx): number {
  if (!d.problems) return 0;
  const b = s.band(p);
  let v = 0;
  for (const k of Object.keys(d.problems) as ProblemKey[]) {
    const w = d.problems[k] ?? 0;
    const fromCtx = CTX_PROBLEMS[k]?.(c);
    v += w * (fromCtx ?? b.problems[Problem[k]]);
  }
  return clamp01(v);
}

/** The words for the flags of the moment. */
const CTX_WORDS: [keyof Ctx, string][] = [
  ["full", "with more in the patch than {she} could carry"], ["poor", "with little to show for the day"], ["roots", "digging for roots in hard ground"],
  ["river", "at the river's shallows"], ["big", "with more meat from the kill than anyone could eat"],
];
const SEASON_WORDS = ["in spring", "in the heat of summer", "in autumn", "in the dead of winter"];

function whereWord(s: Society, x: number, y: number): string {
  const W = s.w.w, i = (y | 0) * W + (x | 0); let river = false, lake = false, sea = false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const f = s.w.flags[i + dy * W + dx] ?? 0; if (f & Flag.River) river = true; if (f & Flag.Lake) lake = true; if (f & Flag.Ocean) sea = true; }
  return sea ? "on the shore" : lake ? "by the lake" : river ? "by the river" : "by the camp";
}

/** A story from a template: "{name} of the {band}, {problem}, ..." with the moment filled in. Clauses that have nothing to say drop out with their commas. */
export function fillStory(s: Society, p: Person, d: TechDef, c: Ctx, template: string): string {
  const b = s.band(p), she = p.sex === "f" ? "she" : "he";
  const key = d.problems ? strongest(b, d.problems) : null;
  const problem = key ? PROBLEM_WORDS[key] : "";
  const ctx = CTX_WORDS.filter(([k]) => c[k]).map(([, w]) => w.replace("{she}", she)).join(", ");
  const vars: Record<string, string> = {
    name: p.name, band: b.name, she, She: she === "she" ? "She" : "He", her: p.sex === "f" ? "her" : "his", herObj: p.sex === "f" ? "her" : "him",
    problem, context: ctx, season: SEASON_WORDS[s.season], where: whereWord(s, p.x, p.y), how: d.how, dir: compass(p.x - b.x, p.y - b.y),
  };
  let out = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  /* an empty slot leaves ", ," or " ,": close the gap */
  out = out.replace(/,\s*,/g, ",").replace(/\s+,/g, ",").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/,\s*\./g, ".");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
