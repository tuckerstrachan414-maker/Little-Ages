import type { Person } from "../people/person.ts";
import type { Foods } from "../people/band.ts";

/*
  What someone has been eating: plant food, meat and fish, milk, as running shares of their
  meals. A mixed diet keeps people well; a diet of meat alone, or roots alone, wears them
  down slowly. Pots change what plant food is worth: boiled, it goes further, and as
  porridge the toddlers, the old and the sick can eat their fill of it.
*/

export const Diet = { Plant: 0, Meat: 1, Milk: 2 } as const;
export const newDiet = (): Float32Array => Float32Array.from([0.5, 0.5, 0]);

/** A meal eaten: what kinds, how much (days of food). */
export function noteMeal(p: Person, took: Foods, milk = 0): void {
  p.dayDiet[Diet.Plant] += took.plant;
  p.dayDiet[Diet.Meat] += took.meat + took.fish + took.dried;
  p.dayDiet[Diet.Milk] += milk;
}
/** Once a day: today's meals fold into the running shares. A day with nothing eaten changes nothing. */
export function dietDay(p: Person): void {
  const d = p.dayDiet, sum = d[0] + d[1] + d[2];
  if (sum > 0.05) for (let k = 0; k < 3; k++) p.diet[k] = p.diet[k] * 0.85 + (d[k] / sum) * 0.15;
  d[0] = 0; d[1] = 0; d[2] = 0;
}
/** How well a diet keeps someone, 0..1: enough plant food, and enough meat, fish or milk. */
export function dietScore(p: Person): number {
  const plant = p.diet[Diet.Plant], flesh = p.diet[Diet.Meat] + p.diet[Diet.Milk];
  return Math.min(1, plant / 0.35) * Math.min(1, flesh / 0.2);
}
/** How fast health comes back on this diet: well fed on mixed food, a good deal faster than on one thing alone. */
export const recoveryFactor = (p: Person): number => 0.7 + 0.3 * dietScore(p);
/** "eats mostly meat; little plant food" */
export function dietWords(p: Person): string {
  const plant = p.diet[Diet.Plant], flesh = p.diet[Diet.Meat], milk = p.diet[Diet.Milk];
  const main = plant > 0.65 ? "mostly roots, fruit and grain" : flesh > 0.65 ? "mostly meat and fish" : milk > 0.3 ? "meat, plant food and milk" : "a mix of meat, fish and plant food";
  const lack = plant < 0.2 ? "; little plant food" : flesh + milk < 0.12 ? "; hardly any meat or fish" : "";
  return `eats ${main}${lack}`;
}
