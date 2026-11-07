/**
 * 問題品質の検証 CLI。
 *
 *   npm run eval -w api -- <repo-url>... [--prompt-only] [--dump] [--full]
 *
 * --prompt-only: Gemini を呼ばず、取得したコードとプロンプトのサイズだけ確認する。
 * --dump:        生成結果を api/eval-out/ に JSON で保存する。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchRepoSnapshot } from "../src/github/snapshot.js";
import { createGeminiClient } from "../src/llm/client.js";
import { generateQuiz } from "../src/quiz/generate.js";
import { lintQuestions, summarize } from "../src/quiz/lint.js";
import { planChunks } from "../src/quiz/plan.js";
import { profileFromEnv } from "../src/quiz/profile.js";
import { buildQuizPrompt } from "../src/quiz/prompt.js";

try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // .env が無くても、環境変数が直接設定されていれば動く
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const urls = args.filter((a) => !a.startsWith("--"));
if (urls.length === 0) {
  console.error("usage: npm run eval -w api -- <repo-url>... [--prompt-only] [--dump] [--full]");
  process.exit(1);
}

const profile = flags.has("--full") ? profileFromEnv("full") : profileFromEnv();
console.log(`profile: ${profile.name} (選択式 ${profile.choice} + 記述式 ${profile.free}, ${profile.chunks} 回に分割)`);

const llm = flags.has("--prompt-only") ? null : createGeminiClient();

for (const url of urls) {
  console.log(`\n=== ${url}`);
  const snap = await fetchRepoSnapshot(url, { token: process.env.GITHUB_TOKEN, limits: profile.limits });
  const chars = snap.files.reduce((n, f) => n + f.content.length, 0);
  console.log(`files: ${snap.files.length} (skipped ${snap.skipped}), chars: ${chars}`);

  if (!llm) {
    // 分割した呼び出しのうち 1 回分のプロンプト(各回ほぼ同じ大きさ)
    const { system, user } = buildQuizPrompt(snap, planChunks([], profile)[0]);
    console.log(`prompt chars per request: system ${system.length} + user ${user.length} (x${profile.chunks} requests)`);
    continue;
  }

  const started = Date.now();
  const quiz = await generateQuiz(snap, llm, { profile, log: (m) => console.log(`  ${m}`) });
  console.log(`generated ${quiz.questions.length} questions in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(summarize(quiz.questions));
  const issues = lintQuestions(quiz.questions, snap.files, profile.choice / 5);
  for (const i of issues) console.log(`[${i.severity}] ${i.questionId ?? "-"} ${i.message}`);
  console.log(`issues: ${issues.filter((i) => i.severity === "error").length} errors, ${issues.filter((i) => i.severity === "warn").length} warnings`);

  if (flags.has("--dump")) {
    const dir = new URL("../eval-out/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(`${snap.owner}__${snap.repo}.json`, dir), JSON.stringify(quiz, null, 2));
  }
}
