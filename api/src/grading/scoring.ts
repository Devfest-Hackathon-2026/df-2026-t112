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

/** 軸ごとの得点率(0〜100)。その軸の問題が無ければ null。 */
export function categoryScores(results: QuestionResult[]): CategoryScores {
  const out = {} as CategoryScores;
  for (const c of CATEGORIES) {
    const rs = results.filter((r) => r.category === c);
    out[c] = rs.length === 0 ? null : Math.round((rs.reduce((n, r) => n + r.score, 0) / rs.length) * 100);
  }
  return out;
}

/** 総合理解度。問題がある軸の平均。 */
export function overallScore(scores: CategoryScores): number {
  const values = CATEGORIES.map((c) => scores[c]).filter((v): v is number => v !== null);
  return values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
