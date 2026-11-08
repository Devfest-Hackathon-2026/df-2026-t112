import { describe, expect, it } from "vitest";
import { clearProgress, loadProgress, saveProgress, type Saved } from "./persist";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const saved: Saved = {
  session: {
    sessionId: "s1",
    repo: { owner: "o", repo: "r", branch: "main", description: null },
    questions: [],
  },
  answers: { q1: { choice: 2 }, q2: { text: "説明" } },
};

describe("progress persistence", () => {
  it("round-trips progress", () => {
    const storage = memoryStorage();
    saveProgress(saved, storage);
    expect(loadProgress(storage)).toEqual(saved);
  });

  it("returns null when nothing is saved", () => {
    expect(loadProgress(memoryStorage())).toBeNull();
  });

  it("ignores corrupted or unexpected data instead of throwing", () => {
    expect(loadProgress(memoryStorage({ "evc:progress": "{not json" }))).toBeNull();
    expect(loadProgress(memoryStorage({ "evc:progress": JSON.stringify({ session: {} }) }))).toBeNull();
    expect(loadProgress(memoryStorage({ "evc:progress": "null" }))).toBeNull();
  });

  it("clears saved progress", () => {
    const storage = memoryStorage();
    saveProgress(saved, storage);
    clearProgress(storage);
    expect(loadProgress(storage)).toBeNull();
  });

  it("keeps working when storage is unavailable or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => saveProgress(saved, throwing)).not.toThrow();
    expect(loadProgress(throwing)).toBeNull();
    expect(() => clearProgress(throwing)).not.toThrow();
    expect(loadProgress(null)).toBeNull();
    expect(() => saveProgress(saved, null)).not.toThrow();
  });
});
