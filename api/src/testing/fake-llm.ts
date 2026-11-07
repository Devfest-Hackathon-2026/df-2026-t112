import type { LlmClient } from "../llm/client.js";
import { CATEGORIES, type Category, type GeneratedQuestion } from "../quiz/types.js";

export function fakeQuestion(i: number, type: "choice" | "free", category?: Category): GeneratedQuestion {
  return {
    type,
    category: category ?? CATEGORIES[i % CATEGORIES.length],
    difficulty: ((i % 3) + 1) as 1 | 2 | 3,
    question: `Q${i} ${type}`,
    codeRef: { path: "src/a.ts", startLine: 1, endLine: 2 },
    choices: type === "choice" ? ["A", "B", "C", "D"] : [],
    answerIndex: type === "choice" ? 1 : 0,
    rubric: type === "free" ? "- 要点" : "",
    hint: "hint",
    explanation: "exp",
  };
}

let counter = 0;

/**
 * 出題プロンプト(「選択式を N 問、記述式を M 問だけ」)の指示どおりの数を返す偽の問題生成。
 * 呼び出しごとに問題文が変わるので、重複しない。
 */
export function fakeQuizResponse(system: string): { questions: GeneratedQuestion[] } {
  const m = system.match(/選択式を (\d+) 問、記述式を (\d+) 問だけ/);
  const choice = Number(m?.[1] ?? 15);
  const free = Number(m?.[2] ?? 3);
  return {
    questions: [
      ...Array.from({ length: choice }, () => fakeQuestion(counter++, "choice")),
      ...Array.from({ length: free }, () => fakeQuestion(counter++, "free")),
    ],
  };
}

/** 出題には指示どおりの数で応答する偽の LLM。採点・総評(1 回の呼び出し)は other に任せる。 */
export function fakeLlm(other?: LlmClient["generateJson"]): LlmClient {
  return {
    async generateJson(req) {
      if (req.system.includes("このリクエストで作る問題")) return fakeQuizResponse(req.system);
      if (other) return other(req);
      return { grades: [], summary: "総評です" };
    },
  };
}
