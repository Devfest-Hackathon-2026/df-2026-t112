import { describe, expect, it } from "vitest";
import { lintQuestions, summarize } from "./lint.js";
import { CATEGORIES, type Question } from "./types.js";

const files = [{ path: "src/a.ts", content: "1\n2\n3" }];

function q(over: Partial<Question> = {}): Question {
  return {
    id: "q1",
    type: "choice",
    category: "reading",
    difficulty: 1,
    question: "何をする関数?",
    codeRef: { path: "src/a.ts", startLine: 1, endLine: 2 },
    choices: ["足す", "引く", "掛ける", "割る"],
    answerIndex: 0,
    rubric: "",
    hint: "演算の種類",
    explanation: "e",
    ...over,
  };
}

describe("lintQuestions", () => {
  it("accepts a sane question (apart from distribution warnings)", () => {
    const issues = lintQuestions([q()], files).filter((i) => i.questionId);
    expect(issues).toEqual([]);
  });

  it("flags missing files and bad line ranges", () => {
    const msgs = lintQuestions(
      [q({ id: "a", codeRef: { path: "nope.ts", startLine: 1, endLine: 1 } }), q({ id: "b", question: "別", codeRef: { path: "src/a.ts", startLine: 1, endLine: 99 } })],
      files,
    )
      .filter((i) => i.severity === "error")
      .map((i) => i.questionId);
    expect(msgs).toEqual(["a", "b"]);
  });

  it("flags duplicates and answer leakage", () => {
    const issues = lintQuestions(
      [q({ id: "a" }), q({ id: "b" }), q({ id: "c", question: "別", choices: ["長い正解の文章", "x", "y", "z"], hint: "長い正解の文章です" })],
      files,
    );
    expect(issues.some((i) => i.questionId === "b" && i.message.includes("重複"))).toBe(true);
    expect(issues.some((i) => i.questionId === "c" && i.message.includes("ヒント"))).toBe(true);
  });
});

describe("summarize", () => {
  it("counts categories, difficulties and answer positions", () => {
    const s = summarize([q({ answerIndex: 2 }), q({ id: "q2", category: "design", difficulty: 3 })]);
    expect(s.byCategory.reading).toBe(1);
    expect(s.byCategory.design).toBe(1);
    expect(Object.keys(s.byCategory)).toEqual([...CATEGORIES]);
    expect(s.byDifficulty[3]).toBe(1);
    expect(s.answerPositions).toEqual([1, 0, 1, 0]);
  });
});
