/*
  Depth order for the close-up view. Trees, wildlife and people are each queued with the
  ground row they stand on. Painting in that order means anything further north is drawn
  first, so a creature passes behind a tree that stands in front of it, and in front of a
  tree that stands behind it.
*/

export interface DepthItem { x: number; y: number; f: () => void; }

export function paintInDepth(items: DepthItem[]): void {
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.f();
}
