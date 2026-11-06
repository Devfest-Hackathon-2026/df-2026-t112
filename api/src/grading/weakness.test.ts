import { describe, expect, it } from "vitest";
import type { Category } from "../quiz/types.js";
import { analyzeWeakness } from "./weakness.js";

const cats = (o: Partial<Record<Category, number | null>>) => ({
  categories: { reading: null, design: null, knowledge: null, quality: null, overall: null, ...o },
});

describe("analyzeWeakness", () => {
  it("averages across sessions and lists the weakest below the threshold", () => {
    const w = analyzeWeakness([
      cats({ reading: 90, design: 40, quality: 50, knowledge: 100 }),
      cats({ reading: 70, design: 20, quality: 60 }),
    ]);
    expect(w.sessions).toBe(2);
    expect(w.averages).toEqual({ reading: 80, design: 30, knowledge: 100, quality: 55, overall: null });
    expect(w.weakest).toEqual(["design", "quality"]);
  });

  it("returns no weak categories when all are strong, and handles empty history", () => {
    expect(analyzeWeakness([cats({ reading: 90 })]).weakest).toEqual([]);
    const empty = analyzeWeakness([]);
    expect(empty.sessions).toBe(0);
    expect(empty.weakest).toEqual([]);
  });

  it("caps the weakest list at two", () => {
    const w = analyzeWeakness([cats({ reading: 10, design: 20, knowledge: 30, quality: 40 })]);
    expect(w.weakest).toEqual(["reading", "design"]);
  });
});
