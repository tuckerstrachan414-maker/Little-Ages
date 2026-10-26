import { describe, it, expect } from "vitest";
import { paintInDepth } from "../src/render/depth.ts";

describe("depth order", () => {
  it("paints what stands further north first, so trees in front cover creatures behind them", () => {
    const painted: string[] = [];
    paintInDepth([
      { x: 0, y: 12.9, f: () => painted.push("tree in front") },
      { x: 0, y: 10.5, f: () => painted.push("deer behind") },
      { x: 0, y: 11.2, f: () => painted.push("person between") },
      { x: 0, y: 9.1, f: () => painted.push("tree behind") },
    ]);
    expect(painted).toEqual(["tree behind", "deer behind", "person between", "tree in front"]);
  });
});
