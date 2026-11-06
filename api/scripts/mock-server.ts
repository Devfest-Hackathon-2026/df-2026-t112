/**
 * Gemini / GitHub を使わずに UI を確認するための開発用サーバー。
 *
 *   npm run dev:mock -w api
 */
import { serve } from "@hono/node-server";
import { createApp } from "../src/app.js";
import type { RepoSnapshot } from "../src/github/snapshot.js";
import type { LlmClient } from "../src/llm/client.js";
import { CATEGORIES, type GeneratedQuestion } from "../src/quiz/types.js";

const code = `export function add(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error("invalid input");
  }
  return a + b;
}
`;

const snapshot: RepoSnapshot = {
  owner: "mock",
  repo: "calculator",
  branch: "main",
  description: "モックデータのリポジトリ",
  files: [{ path: "src/add.ts", content: code }],
  skipped: 0,
};

const question = (i: number, type: "choice" | "free"): GeneratedQuestion => ({
  type,
  category: CATEGORIES[i % 5],
  difficulty: ((i % 3) + 1) as 1 | 2 | 3,
  question: type === "choice" ? `add 関数について正しい説明はどれ?(${i + 1})` : "add 関数が例外を投げる理由と条件を説明してください。",
  codeRef: { path: "src/add.ts", startLine: 1, endLine: 6 },
  choices: type === "choice" ? ["2つの数を足す", "2つの数を掛ける", "文字列を連結する", "配列を並べ替える"] : [],
  answerIndex: type === "choice" ? 0 : 0,
  rubric: type === "free" ? "- 入力が有限数でない場合に例外\n- 不正な計算結果(NaN など)を防ぐため" : "",
  hint: "関数名と return 文を見てみましょう",
  explanation: "return a + b; で 2 つの引数を足しています。",
});

const llm: LlmClient = {
  async generateJson(req) {
    await new Promise((r) => setTimeout(r, 800));
    if (req.user.includes("次のリポジトリ")) {
      return {
        questions: [
          ...Array.from({ length: 15 }, (_, i) => question(i, "choice")),
          ...Array.from({ length: 3 }, (_, i) => question(i + 1, "free")),
        ],
      };
    }
    if (req.user.includes("<item")) {
      return {
        grades: [...req.user.matchAll(/<item id="(q\d+)">/g)].map((m, i) => ({
          id: m[1],
          score: [1, 0.5, 0][i % 3],
          feedback: "要点の一部を説明できています。",
        })),
      };
    }
    return { summary: "これはモックの総評です。コード読解は良好ですが、エラー処理の説明が弱めでした。" };
  },
};

const app = createApp({ llm, fetchSnapshot: async () => snapshot });
const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () => console.log(`mock api listening on :${port}`));
