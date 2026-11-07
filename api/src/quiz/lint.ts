import type { RepoFile } from "../github/snapshot.js";
import { CATEGORIES, type Category, type Question } from "./types.js";

export type LintIssue = { severity: "error" | "warn"; questionId?: string; message: string };

/** 生成された問題の機械的な品質チェック。プロンプト調整の指標にも使う。 */
export function lintQuestions(questions: Question[], files: RepoFile[], choicePerCategory = 3): LintIssue[] {
  const issues: LintIssue[] = [];
  const lineCount = new Map(files.map((f) => [f.path, f.content.split("\n").length]));
  const seen = new Set<string>();

  for (const q of questions) {
    const err = (message: string) => issues.push({ severity: "error", questionId: q.id, message });
    const warn = (message: string) => issues.push({ severity: "warn", questionId: q.id, message });

    const lines = lineCount.get(q.codeRef.path);
    if (lines === undefined) err(`codeRef のファイルが存在しません: ${q.codeRef.path}`);
    else if (q.codeRef.endLine < q.codeRef.startLine || q.codeRef.endLine > lines) {
      err(`codeRef の行範囲が不正です: ${q.codeRef.startLine}-${q.codeRef.endLine} (全${lines}行)`);
    }

    const key = q.question.replace(/\s+/g, "");
    if (seen.has(key)) err("同じ問題文が重複しています");
    seen.add(key);

    if (q.type === "choice") {
      if (new Set(q.choices).size !== q.choices.length) err("選択肢が重複しています");
      const answer = q.choices[q.answerIndex];
      if (answer && answer.length >= 6 && q.hint.includes(answer)) warn("ヒントに正解がそのまま含まれています");
      if (answer && answer.length >= 6 && q.question.includes(answer)) warn("問題文に正解がそのまま含まれています");
    }
  }

  const choice = questions.filter((q) => q.type === "choice");
  for (const c of CATEGORIES) {
    const n = choice.filter((q) => q.category === c).length;
    if (n !== choicePerCategory) {
      issues.push({ severity: "warn", message: `カテゴリ ${c} の選択式が ${n} 問です(目安 ${choicePerCategory} 問)` });
    }
  }
  if (!questions.some((q) => q.difficulty === 3)) issues.push({ severity: "warn", message: "難易度 3 の問題がありません" });
  return issues;
}

export function summarize(questions: Question[]) {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const byDifficulty: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  const answerPositions = [0, 0, 0, 0];
  for (const q of questions) {
    byCategory[q.category]++;
    byDifficulty[q.difficulty]++;
    if (q.type === "choice") answerPositions[q.answerIndex]++;
  }
  return { byCategory, byDifficulty, answerPositions };
}
