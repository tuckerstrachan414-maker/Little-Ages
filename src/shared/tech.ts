/* What the page is told about the tree of knowledge: the nodes once, and who knows what as often as the panel asks. */

/** A node of the tree, as the page draws it. */
export interface TechDefLite { id: number; key: string; name: string; how: string; branch: number; era: number; needs: number[]; any: number[]; active: boolean; start: boolean; icon: number; }
/** Whose knowledge to show: everyone's, one people's, or one settlement's. */
export interface TechGroup { kind: "world" | "people" | "settlement"; id: number; }
export interface TechGroupInfo extends TechGroup { name: string; color: string; age: number; }
/** How a node stands for a group. */
export const Known = { None: 0, Reach: 1, Known: 2, Lost: 3 } as const;
export interface TechPanelData {
  group: TechGroupInfo; groups: TechGroupInfo[];
  /** per node: 0 nobody, 1 within reach, 2 known, 3 known once and lost */
  nodes: Uint8Array;
  /** per node: how many of the group know it */
  knowers: Uint16Array;
  /** per node: the group's refinement level */
  refine: Float32Array;
  /** per node: when it was first worked out in this group (0 never) */
  firstT: Float32Array;
  /** the world view: per node, the colors of the peoples that know it */
  colors?: string[][];
}
export interface TechKnower { id: number; name: string; band: string; m: number; }
export interface TechNodeDetail {
  id: number; key: string; name: string; how: string; branch: number; era: number; active: boolean; start: boolean; icon: number;
  status: string;
  needs: { id: number; name: string; known: boolean }[];
  any: { id: number; name: string; known: boolean }[];
  unlocks: { id: number; name: string; known: boolean }[];
  /** who first worked it out anywhere, and in this group */
  first: { who: number; name: string; bandName: string; people: string; t: number; x: number; y: number } | null;
  firstHere: { who: number; name: string; bandName: string; t: number; x: number; y: number } | null;
  times: number; lostAt: number;
  knowers: TechKnower[]; nKnowers: number; bands: number;
  refine: { level: number; uses: number; best: { id: number; name: string } | null } | null;
  /** the wants it answers, in words */
  answers: string[];
}
