import { describe, expect, it } from "vitest";
import { CHUNKS, choiceCounts, planChunks, primaryFiles } from "./plan.js";
import { CATEGORIES } from "./types.js";

const total = (chunks: ReturnType<typeof planChunks>, key: "choice" | "free") =>
  chunks.reduce((n, c) => n + c[key].length, 0);

describe("planChunks", () => {
  it("splits 15 choice + 3 free into balanced chunks, 3 per category", () => {
    const chunks = planChunks();
    expect(chunks).toHaveLength(CHUNKS);
    expect(total(chunks, "choice")).toBe(15);
    expect(total(chunks, "free")).toBe(3);
    for (const c of chunks) {
      expect(c.choice).toHaveLength(5);
      expect(c.free).toHaveLength(1);
    }
    for (const cat of CATEGORIES) {
      expect(chunks.flatMap((c) => c.choice).filter((x) => x === cat)).toHaveLength(3);
    }
    expect(new Set(chunks.flatMap((c) => c.free)).size).toBe(3);
  });

  it("shifts questions toward focus categories without changing the total", () => {
    const counts = choiceCounts(["design", "quality"]);
    expect(counts.design).toBe(4);
    expect(counts.quality).toBe(4);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(15);

    const chunks = planChunks(["design", "quality"]);
    expect(total(chunks, "choice")).toBe(15);
    expect(total(chunks, "free")).toBe(3);
    expect(chunks.flatMap((c) => c.free)).toEqual(expect.arrayContaining(["design", "quality"]));
  });
});

describe("primaryFiles", () => {
  it("gives each chunk a disjoint share that covers every file", () => {
    const paths = ["a", "b", "c", "d", "e"];
    const shares = Array.from({ length: CHUNKS }, (_, i) => primaryFiles(paths, i));
    expect(shares.flat().sort()).toEqual(paths);
  });
});
