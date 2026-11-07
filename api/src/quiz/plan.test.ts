import { describe, expect, it } from "vitest";
import { choiceCounts, planChunks, primaryFiles } from "./plan.js";
import { PROFILES, profileFromEnv } from "./profile.js";
import { CATEGORIES } from "./types.js";

const total = (chunks: ReturnType<typeof planChunks>, key: "choice" | "free") =>
  chunks.reduce((n, c) => n + c[key].length, 0);

describe("planChunks (full)", () => {
  const full = PROFILES.full;

  it("splits 15 choice + 3 free into balanced chunks, 3 per category", () => {
    const chunks = planChunks([], full);
    expect(chunks).toHaveLength(3);
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
    const counts = choiceCounts(15, ["design", "quality"]);
    expect(counts.design).toBe(4);
    expect(counts.quality).toBe(4);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(15);

    const chunks = planChunks(["design", "quality"], full);
    expect(total(chunks, "choice")).toBe(15);
    expect(total(chunks, "free")).toBe(3);
    expect(chunks.flatMap((c) => c.free)).toEqual(expect.arrayContaining(["design", "quality"]));
  });
});

describe("planChunks (mini)", () => {
  const mini = PROFILES.mini;

  it("makes a single request with one choice question per category plus one free question", () => {
    const chunks = planChunks([], mini);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choice).toEqual([...CATEGORIES]);
    expect(chunks[0].free).toHaveLength(1);
  });

  it("keeps one choice question per category and applies focus to the free question only", () => {
    const [chunk] = planChunks(["quality"], mini);
    expect(chunk.choice).toEqual([...CATEGORIES]);
    expect(chunk.free).toEqual(["quality"]);
  });
});

describe("choiceCounts", () => {
  it("spreads a remainder over the first categories", () => {
    const counts = choiceCounts(7, []);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(7);
    expect(counts.reading).toBe(2);
    expect(counts.overall).toBe(1);
  });
});

describe("primaryFiles", () => {
  it("gives each chunk a disjoint share that covers every file", () => {
    const paths = ["a", "b", "c", "d", "e"];
    const shares = [0, 1, 2].map((i) => primaryFiles(paths, i, 3));
    expect(shares.flat().sort()).toEqual(paths);
  });

  it("does not restrict files when there is only one chunk", () => {
    expect(primaryFiles(["a", "b"], 0, 1)).toEqual([]);
  });
});

describe("profileFromEnv", () => {
  it("defaults to mini and switches to full only when asked", () => {
    expect(profileFromEnv(undefined).name).toBe("mini");
    expect(profileFromEnv("whatever").name).toBe("mini");
    expect(profileFromEnv("FULL").name).toBe("full");
  });

  it("mini sends far less code than full", () => {
    expect(PROFILES.mini.limits.maxTotalChars).toBeLessThan(PROFILES.full.limits.maxTotalChars / 4);
    expect(PROFILES.mini.limits.maxFiles).toBeLessThan(PROFILES.full.limits.maxFiles);
  });
});
