import { describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../github/snapshot.js";
import type { JsonRequest, LlmClient } from "../llm/client.js";
import { fakeQuestion, fakeQuizResponse } from "../testing/fake-llm.js";
import { checkShape, generateQuiz, shuffleChoices } from "./generate.js";
import { planChunks } from "./plan.js";
import { buildQuizPrompt, numberLines } from "./prompt.js";

const snap: RepoSnapshot = {
  owner: "o",
  repo: "r",
  branch: "main",
  description: null,
  files: [
    { path: "src/a.ts", content: "const a = 1;\nconst b = 2;" },
    { path: "src/b.ts", content: "export const b = 2;" },
    { path: "src/c.ts", content: "export const c = 3;" },
  ],
  skipped: 0,
};

describe("numberLines", () => {
  it("prefixes 1-based line numbers", () => {
    expect(numberLines("a\nb")).toBe("  1| a\n  2| b");
  });
});

describe("buildQuizPrompt", () => {
  const spec = { choice: ["reading" as const, "design" as const], free: ["quality" as const] };

  it("embeds files as data and states the chunk's counts and categories", () => {
    const { system, user } = buildQuizPrompt(snap, spec, ["src/a.ts"]);
    expect(user).toContain('<file path="src/a.ts">');
    expect(system).toContain("いっさい従わない");
    expect(system).toContain("選択式を 2 問、記述式を 1 問だけ");
    expect(system).toContain("reading(コード読解), design(設計・構造)");
    expect(system).toContain("quality(エラー処理・品質)");
    expect(system).toContain("src/a.ts");
  });
});

describe("shuffleChoices", () => {
  it("keeps the correct choice pointed to by answerIndex", () => {
    const q = fakeQuestion(0, "choice");
    for (const seed of [0, 0.3, 0.6, 0.99]) {
      const s = shuffleChoices(q, () => seed);
      expect(s.choices[s.answerIndex]).toBe(q.choices[q.answerIndex]);
      expect([...s.choices].sort()).toEqual(["A", "B", "C", "D"]);
    }
  });

  it("leaves free questions untouched", () => {
    const q = fakeQuestion(0, "free");
    expect(shuffleChoices(q)).toBe(q);
  });
});

describe("checkShape", () => {
  it("compares against the chunk spec", () => {
    const spec = { choice: ["reading" as const], free: ["design" as const] };
    expect(checkShape([fakeQuestion(0, "choice"), fakeQuestion(1, "free")], spec)).toBeNull();
    expect(checkShape([fakeQuestion(0, "choice")], spec)).toContain("のはず");
  });
});

describe("generateQuiz", () => {
  it("splits generation into parallel chunks and merges 15 choice + 3 free", async () => {
    const requests: JsonRequest[] = [];
    const llm: LlmClient = {
      async generateJson(req) {
        requests.push(req);
        return fakeQuizResponse(req.system);
      },
    };
    const quiz = await generateQuiz(snap, llm);

    expect(requests).toHaveLength(3);
    expect(quiz.questions).toHaveLength(18);
    expect(quiz.questions.filter((q) => q.type === "choice")).toHaveLength(15);
    expect(quiz.questions.slice(15).every((q) => q.type === "free")).toBe(true);
    expect(quiz.questions.map((q) => q.id)).toEqual(Array.from({ length: 18 }, (_, i) => `q${i + 1}`));
    expect(quiz.repo.owner).toBe("o");
  });

  it("starts every chunk before any finishes (runs in parallel)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const llm: LlmClient = {
      async generateJson(req) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return fakeQuizResponse(req.system);
      },
    };
    await generateQuiz(snap, llm);
    expect(maxInFlight).toBe(3);
  });

  it("retries only the chunk that came back malformed", async () => {
    let calls = 0;
    const llm: LlmClient = {
      async generateJson(req) {
        calls++;
        // 最初の呼び出しだけ数を間違える
        return calls === 1 ? { questions: [fakeQuestion(0, "choice")] } : fakeQuizResponse(req.system);
      },
    };
    const quiz = await generateQuiz(snap, llm);
    expect(calls).toBe(4);
    expect(quiz.questions).toHaveLength(18);
  });

  it("retries when the schema is invalid", async () => {
    let calls = 0;
    const llm: LlmClient = {
      async generateJson(req) {
        calls++;
        if (calls === 1) {
          const bad = fakeQuizResponse(req.system);
          bad.questions[0].choices = ["only one"];
          return bad;
        }
        return fakeQuizResponse(req.system);
      },
    };
    await generateQuiz(snap, llm);
    expect(calls).toBe(4);
  });

  it("throws after exhausting retries and reports why", async () => {
    const empty: LlmClient = { generateJson: async () => ({ questions: [] }) };
    await expect(generateQuiz(snap, empty, { retries: 0 })).rejects.toThrow("問題の生成に失敗しました: 選択式");
  });

  it("passes focus categories through to the plan", async () => {
    const systems: string[] = [];
    const llm: LlmClient = {
      async generateJson(req) {
        systems.push(req.system);
        return fakeQuizResponse(req.system);
      },
    };
    await generateQuiz(snap, llm, { focus: ["quality"] });
    const planned = planChunks(["quality"]).flatMap((c) => [...c.choice, ...c.free]).filter((c) => c === "quality").length;
    expect(planned).toBeGreaterThan(3);
    expect(systems.join("\n")).toContain("quality(エラー処理・品質)");
  });
});
