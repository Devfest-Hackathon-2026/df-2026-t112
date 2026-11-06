import { describe, expect, it } from "vitest";
import type { GradeResult } from "../grading/grade.js";
import { MemorySessionStore, type Session } from "./session.js";
import { deserializeSession, serializeSession } from "./firestore.js";
import { MemoryStatsStore } from "./stats.js";

const quiz = {
  repo: { owner: "o", repo: "r", branch: "main", description: null },
  questions: [],
};

const result = (categories: Partial<GradeResult["categories"]>): GradeResult => ({
  overall: 0,
  categories: { reading: null, design: null, knowledge: null, quality: null, overall: null, ...categories },
  summary: "s",
  questions: [],
});

describe("session serialization", () => {
  it("round-trips with and without a result", () => {
    const base: Session = { id: "abc", createdAt: 1000, quiz, snippets: { q1: "code" } };
    expect(deserializeSession("abc", serializeSession(base))).toEqual(base);

    const graded = { ...base, result: result({ reading: 80 }) };
    expect(deserializeSession("abc", serializeSession(graded))).toEqual(graded);
  });

  it("sets an expiry in the future for the TTL policy", () => {
    const d = serializeSession({ id: "a", createdAt: 1000, quiz, snippets: {} });
    expect(d.expireAt.getTime()).toBeGreaterThan(1000);
    expect(d.repo).toBe("o/r");
  });
});

describe("MemorySessionStore", () => {
  it("expires old sessions and stores results", async () => {
    let t = 0;
    const store = new MemorySessionStore(100, 10, () => t);
    const s = await store.create({ quiz, snippets: {} });
    await store.saveResult(s.id, result({ design: 50 }));
    expect((await store.get(s.id))?.result?.categories.design).toBe(50);
    t = 101;
    expect(await store.get(s.id)).toBeUndefined();
  });

  it("evicts the oldest session beyond capacity", async () => {
    const store = new MemorySessionStore(1000, 2, () => 0);
    const a = await store.create({ quiz, snippets: {} });
    await store.create({ quiz, snippets: {} });
    await store.create({ quiz, snippets: {} });
    expect(await store.get(a.id)).toBeUndefined();
  });
});

describe("MemoryStatsStore", () => {
  it("averages per category and skips empty categories", async () => {
    const stats = new MemoryStatsStore();
    await stats.record(result({ reading: 100, design: 20 }));
    await stats.record(result({ reading: 50 }));
    expect(await stats.get()).toEqual({
      count: 2,
      averages: { reading: 75, design: 20, knowledge: null, quality: null, overall: null },
    });
  });
});
