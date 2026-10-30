/*
  Everything that can be carried, kept or traded, in one list: the foods people have always
  had, and the materials the land gives up. A person carries one kind at a time; a band keeps
  a pile of what it has gathered; a household keeps its own pots and wool.
*/

export const Mat = {
  None: 0, Plant: 1, Meat: 2, Fish: 3, Wood: 4, Dried: 5, Milk: 6, Hides: 7,
  Clay: 8, Flint: 9, Stone: 10, Pots: 11, Wool: 12, Reeds: 13, Salt: 14, Copper: 15, Tin: 16, Iron: 17, Gold: 18, Silver: 19, Obsidian: 20, Bronze: 21, Herbs: 22,
} as const;
export type Mat = (typeof Mat)[keyof typeof Mat];

export interface MatDef {
  id: number;
  /** "clay", "a lump of clay", "clay" */
  name: string; plural: string;
  /** whether it is eaten */
  food: boolean;
  /** how much one person can carry of it in a load */
  load: number;
  /** what a band would give for a unit of it, in days of food, before scarcity */
  worth: number;
  /** its color on the map and in the cards */
  color: string;
  /** whether it comes out of the ground (a deposit) */
  dug: boolean;
  /** units in a deposit of it, and whether such deposits come back */
  amount: number; regrows: boolean;
}

export const MATS: MatDef[] = [
  { id: 0, name: "nothing", plural: "nothing", food: false, load: 0, worth: 0, color: "#000000", dug: false, amount: 0, regrows: false },
  { id: 1, name: "plant food", plural: "plant food", food: true, load: 5, worth: 1, color: "#8cb04a", dug: false, amount: 0, regrows: false },
  { id: 2, name: "meat", plural: "meat", food: true, load: 6, worth: 1.2, color: "#a8433a", dug: false, amount: 0, regrows: false },
  { id: 3, name: "fish", plural: "fish", food: true, load: 6, worth: 1, color: "#6a9ab0", dug: false, amount: 0, regrows: false },
  { id: 4, name: "firewood", plural: "firewood", food: false, load: 3, worth: 0.3, color: "#8a6040", dug: false, amount: 0, regrows: false },
  { id: 5, name: "dried meat", plural: "dried meat", food: true, load: 6, worth: 1.5, color: "#7a3a2a", dug: false, amount: 0, regrows: false },
  { id: 6, name: "milk", plural: "milk", food: true, load: 3, worth: 1, color: "#f2eee0", dug: false, amount: 0, regrows: false },
  { id: 7, name: "hide", plural: "hides", food: false, load: 2, worth: 2, color: "#c29a68", dug: false, amount: 0, regrows: false },
  { id: 8, name: "clay", plural: "clay", food: false, load: 6, worth: 0.4, color: "#b5603a", dug: true, amount: 6000, regrows: false },
  { id: 9, name: "flint", plural: "flint", food: false, load: 5, worth: 0.8, color: "#9a9aa0", dug: true, amount: 1500, regrows: false },
  { id: 10, name: "stone", plural: "stone", food: false, load: 4, worth: 0.3, color: "#7b7a75", dug: true, amount: 20000, regrows: false },
  { id: 11, name: "pot", plural: "pots", food: false, load: 4, worth: 3, color: "#a0523a", dug: false, amount: 0, regrows: false },
  { id: 12, name: "wool", plural: "wool", food: false, load: 6, worth: 1.5, color: "#ece4d0", dug: false, amount: 0, regrows: false },
  { id: 13, name: "reeds", plural: "reeds", food: false, load: 6, worth: 0.2, color: "#b6b85a", dug: true, amount: 400, regrows: true },
  { id: 14, name: "salt", plural: "salt", food: false, load: 5, worth: 2, color: "#f4e6ea", dug: true, amount: 3000, regrows: true },
  { id: 15, name: "copper ore", plural: "copper ore", food: false, load: 4, worth: 3, color: "#4f9a86", dug: true, amount: 900, regrows: false },
  { id: 16, name: "tin ore", plural: "tin ore", food: false, load: 4, worth: 5, color: "#b9c0c6", dug: true, amount: 500, regrows: false },
  { id: 17, name: "iron ore", plural: "iron ore", food: false, load: 4, worth: 2, color: "#8a4a2e", dug: true, amount: 3000, regrows: false },
  { id: 18, name: "gold", plural: "gold", food: false, load: 2, worth: 20, color: "#e3b32f", dug: true, amount: 120, regrows: false },
  { id: 19, name: "silver", plural: "silver", food: false, load: 3, worth: 10, color: "#dfe3e8", dug: true, amount: 300, regrows: false },
  { id: 20, name: "obsidian", plural: "obsidian", food: false, load: 4, worth: 3, color: "#2a2a30", dug: true, amount: 600, regrows: false },
  { id: 21, name: "bronze", plural: "bronze", food: false, load: 4, worth: 8, color: "#b07a3a", dug: false, amount: 0, regrows: false },
  { id: 22, name: "herbs", plural: "herbs", food: false, load: 4, worth: 1, color: "#5e8f3e", dug: false, amount: 0, regrows: false },
];
export const MAT_COUNT = MATS.length;
export const isFood = (m: number) => !!MATS[m]?.food;
/** The materials that come out of the ground. */
export const DUG = MATS.filter(m => m.dug).map(m => m.id);
export const matByName = (name: string): number => { const m = MATS.find(d => d.name === name || d.plural === name); if (!m) throw new Error(`no material ${name}`); return m.id; };
