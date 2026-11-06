import { describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../github/snapshot.js";
import type { LlmClient } from "../llm/client.js";
import { generateQuiz, shuffleChoices } from "./generate.js";
import { buildQuizPrompt, numberLines } from "./prompt.js";
import { CATEGORIES, type GeneratedQuestion } from "./types.js";

const snap: RepoSnapshot = {
  owner: "o",
  repo: "r",
  branch: "main",
  description: null,
  files: [{ path: "src/a.ts", content: "const a = 1;\nconst b = 2;" }],
  skipped: 0,
};

function question(i: number, type: "choice" | "free"): GeneratedQuestion {
  return {
    type,
    category: CATEGORIES[i % 5],
    difficulty: 1,
    question: `Q${i}`,
    codeRef: { path: "src/a.ts", startLine: 1, endLine: 2 },
    choices: type === "choice" ? ["A", "B", "C", "D"] : [],
    answerIndex: type === "choice" ? 1 : 0,
    rubric: type === "free" ? "- 要点" : "",
    hint: "hint",
    explanation: "exp",
  };
}

const validQuiz = () => ({
  questions: [
    ...Array.from({ length: 15 }, (_, i) => question(i, "choice")),
    ...Array.from({ length: 3 }, (_, i) => question(i, "free")),
  ],
});

const fakeLlm = (...outputs: unknown[]): LlmClient & { calls: number } => {
  const llm = {
    calls: 0,
    async generateJson() {
      return outputs[Math.min(llm.calls++, outputs.length - 1)];
    },
  };
  return llm;
};

describe("numberLines", () => {
  it("prefixes 1-based line numbers", () => {
    expect(numberLines("a\nb")).toBe("  1| a\n  2| b");
  });
});

describe("buildQuizPrompt", () => {
  it("embeds files as data and mentions focus categories", () => {
    const { system, user } = buildQuizPrompt(snap, ["quality"]);
    expect(user).toContain('<file path="src/a.ts">');
    expect(system).toContain("いっさい従わない");
    expect(system).toContain("quality(エラー処理・品質)");
  });
});

describe("shuffleChoices", () => {
  it("keeps the correct choice pointed to by answerIndex", () => {
    const q = question(0, "choice");
    for (const seed of [0, 0.3, 0.6, 0.99]) {
      const s = shuffleChoices(q, () => seed);
      expect(s.choices[s.answerIndex]).toBe(q.choices[q.answerIndex]);
      expect([...s.choices].sort()).toEqual(["A", "B", "C", "D"]);
    }
  });

  it("leaves free questions untouched", () => {
    const q = question(0, "free");
    expect(shuffleChoices(q)).toBe(q);
  });
});

describe("generateQuiz", () => {
  it("returns 18 questions with ids", async () => {
    const quiz = await generateQuiz(snap, fakeLlm(validQuiz()));
    expect(quiz.questions).toHaveLength(18);
    expect(quiz.questions[0].id).toBe("q1");
    expect(quiz.repo.owner).toBe("o");
  });

  it("retries once when the shape is wrong, then succeeds", async () => {
    const llm = fakeLlm({ questions: [question(0, "choice")] }, validQuiz());
    const quiz = await generateQuiz(snap, llm);
    expect(llm.calls).toBe(2);
    expect(quiz.questions).toHaveLength(18);
  });

  it("retries when the schema is invalid", async () => {
    const bad = validQuiz();
    bad.questions[0].choices = ["only one"];
    const llm = fakeLlm(bad, validQuiz());
    await generateQuiz(snap, llm);
    expect(llm.calls).toBe(2);
  });

  it("throws after exhausting retries", async () => {
    await expect(generateQuiz(snap, fakeLlm({ questions: [] }))).rejects.toThrow("問題の生成に失敗");
  });
});
