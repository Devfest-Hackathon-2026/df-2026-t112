import { z } from "zod";
import { LlmError, type LlmClient } from "../llm/client.js";
import { CATEGORIES, CATEGORY_LABELS, type Quiz } from "../quiz/types.js";
import type { CategoryScores, QuestionResult } from "./scoring.js";

const summarySchema = z.object({ summary: z.string().min(1) });

const SYSTEM = `あなたは、AI にコードを書かせた学習者の理解度を講評する、率直で優しい講師です。
採点結果をもとに、総評を日本語で書いてください。

# ルール
- 4〜6 文。良い点を 1 つ挙げたあと、足りない点を具体的に指摘し、次に何を学ぶとよいかを 1〜2 個提案してください。
- 低いカテゴリは名前を出して触れてください。点数が高くても、記述式が弱ければ「説明する力」について指摘してください。
- お世辞や根拠のない断定はしないでください。`;

export async function summarizeResult(
  llm: LlmClient,
  quiz: Quiz,
  results: QuestionResult[],
  categories: CategoryScores,
  overall: number,
): Promise<string> {
  const lines = CATEGORIES.map((c) => `- ${CATEGORY_LABELS[c]}: ${categories[c] ?? "-"}点`).join("\n");
  const wrong = results
    .filter((r) => !r.correct)
    .slice(0, 8)
    .map((r) => {
      const q = quiz.questions.find((x) => x.id === r.id)!;
      return `- [${CATEGORY_LABELS[r.category]}] ${q.question}${r.feedback ? ` / ${r.feedback}` : ""}`;
    })
    .join("\n");

  const user = `リポジトリ: ${quiz.repo.owner}/${quiz.repo.repo}
総合理解度: ${overall}点

カテゴリ別:
${lines}

間違えた・弱かった問題:
${wrong || "(なし)"}`;

  const raw = await llm.generateJson({ system: SYSTEM, user, schema: summarySchema, temperature: 0.6 });
  const parsed = summarySchema.safeParse(raw);
  if (!parsed.success) throw new LlmError("総評を生成できませんでした");
  return parsed.data.summary;
}
