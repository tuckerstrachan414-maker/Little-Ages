/*
  The materials as the page knows them: a name and a color for each, kept apart from the
  simulation's table so the renderer and the cards never pull the simulation in.
*/
export const MAT_NAMES = ["nothing", "plant food", "meat", "fish", "firewood", "dried meat", "milk", "hide", "clay", "flint", "stone", "pot", "wool", "reeds", "salt", "copper ore", "tin ore", "iron ore", "gold", "silver", "obsidian", "bronze", "herbs"];
export const MAT_COLORS = ["#000000", "#8cb04a", "#a8433a", "#6a9ab0", "#8a6040", "#7a3a2a", "#f2eee0", "#c29a68", "#b5603a", "#9a9aa0", "#7b7a75", "#a0523a", "#ece4d0", "#b6b85a", "#f4e6ea", "#4f9a86", "#b9c0c6", "#8a4a2e", "#e3b32f", "#dfe3e8", "#2a2a30", "#b07a3a", "#5e8f3e"];
/** How a deposit of each material is spoken of on the map card. */
export const DEPOSIT_WORDS: Record<number, string> = { 8: "a clay bank", 9: "a flint seam", 10: "a stone outcrop", 13: "a reed bed", 14: "a salt pan", 15: "a copper vein", 16: "a tin vein", 17: "an iron seam", 18: "gold in the gravel", 19: "a silver vein", 20: "an obsidian flow" };
