import { CATEGORIES, type Category, type Question } from "../quiz/types.js";

export type Answer = { choice?: number; text?: string };

export type QuestionResult = {
  id: string;
  category: Category;
  type: Question["type"];
  /** 0〜1。選択式は 0 か 1、記述式は部分点あり。 */
  score: number;
  correct: boolean;
  userAnswer: string;
  correctAnswer: string;
  explanation: string;
  feedback: string;
};

export type CategoryScores = Record<Category, number | null>;

export function gradeChoice(q: Question, a: Answer | undefined): QuestionResult {
  const correct = a?.choice === q.answerIndex;
  return {
    id: q.id,
    category: q.category,
    type: "choice",
    score: correct ? 1 : 0,
    correct,
    userAnswer: a?.choice === undefined ? "(未回答)" : (q.choices[a.choice] ?? "(未回答)"),
    correctAnswer: q.choices[q.answerIndex],
    explanation: q.explanation,
    feedback: "",
  };
}

/** 記述式は選択式より明らかに難しいので、1 問で苦手と判定されないよう重みを半分にする。 */
export const FREE_WEIGHT = 0.5;

/** カテゴリ統合前に作られたクイズの「全体理解」は、統合先の設計・全体理解として数える。 */
export function currentCategory(category: string): Category {
  return (category === "overall" ? "design" : category) as Category;
}

/** 軸ごとの得点率(0〜100)。その軸の問題が無ければ null。 */
export function categoryScores(results: QuestionResult[]): CategoryScores {
  const out = {} as CategoryScores;
  for (const c of CATEGORIES) {
    const rs = results.filter((r) => currentCategory(r.category) === c);
    const weight = (r: QuestionResult) => (r.type === "free" ? FREE_WEIGHT : 1);
    const total = rs.reduce((n, r) => n + weight(r), 0);
    out[c] = rs.length === 0 ? null : Math.round((rs.reduce((n, r) => n + r.score * weight(r), 0) / total) * 100);
  }
  return out;
}

/** 説明力(0〜100)。記述式の平均で、カテゴリとは別に見せる。記述式が無ければ null。 */
export function explanationScore(results: QuestionResult[]): number | null {
  const free = results.filter((r) => r.type === "free");
  return free.length === 0 ? null : Math.round((free.reduce((n, r) => n + r.score, 0) / free.length) * 100);
}

/** 総合理解度。問題がある軸の平均。 */
export function overallScore(scores: CategoryScores): number {
  const values = CATEGORIES.map((c) => scores[c]).filter((v): v is number => v !== null);
  return values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
