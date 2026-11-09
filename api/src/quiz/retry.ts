import type { QuestionResult } from "../grading/scoring.js";
import { currentCategory } from "../grading/scoring.js";
import type { ChunkSpec } from "./plan.js";
import type { AskedQuestion, Category, GeneratedQuestion, Quiz } from "./types.js";

/** 再挑戦の問題数。間違えた数に合わせるが、短く済むように上限を設ける。 */
export const RETRY_MIN = 3;
export const RETRY_MAX = 6;

const MAX_TEXT_CHARS = 500;

/** 除外する履歴の上限。プロンプトが長くなりすぎないようにする。 */
const MAX_ASKED = 60;

export type MissedQuestion = {
  category: Category;
  question: string;
  correctAnswer: string;
  userAnswer: string;
  path: string;
  startLine: number;
  endLine: number;
};

/** 採点結果から、間違えた問題を取り出す。 */
export function missedQuestions(quiz: Quiz, results: QuestionResult[]): MissedQuestion[] {
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  return results
    .filter((r) => !r.correct)
    .flatMap((r) => {
      const q = byId.get(r.id);
      if (!q) return [];
      return [
        {
          category: currentCategory(r.category),
          question: q.question,
          correctAnswer: r.correctAnswer,
          userAnswer: r.userAnswer,
          path: q.codeRef.path,
          startLine: q.codeRef.startLine,
          endLine: q.codeRef.endLine,
        },
      ];
    });
}

/**
 * 問題数の上限があっても、間違えた分野が漏れないように選ぶ。
 * 多く間違えた分野から順に、分野ごとに 1 問ずつ取り出すことを繰り返す。
 */
export function pickMissed<T extends { category: Category }>(missed: T[]): T[] {
  const byCategory = new Map<Category, T[]>();
  for (const m of missed) byCategory.set(m.category, [...(byCategory.get(m.category) ?? []), m]);
  const queues = [...byCategory.values()].sort((a, b) => b.length - a.length);

  const picked: T[] = [];
  while (picked.length < RETRY_MAX && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && picked.length < RETRY_MAX) picked.push(next);
    }
  }
  return picked;
}

/** 再挑戦の内訳。半分を記述式、残りを選択式にし、多く間違えた分野から記述式に割り当てる。 */
export function planRetry(missed: Pick<MissedQuestion, "category">[]): ChunkSpec {
  const total = Math.min(Math.max(missed.length, RETRY_MIN), RETRY_MAX);
  const picked = pickMissed(missed);
  const ordered = Array.from({ length: total }, (_, i) => picked[i % picked.length].category);
  const freeCount = Math.ceil(total / 2);
  return { free: ordered.slice(0, freeCount), choice: ordered.slice(freeCount) };
}

export function renderMissed(missed: MissedQuestion[]): string {
  const clip = (s: string) => s.slice(0, MAX_TEXT_CHARS);
  const items = pickMissed(missed).map((m) =>
    [
      `<missed>`,
      `問題: ${clip(m.question)}`,
      `正解: ${clip(m.correctAnswer)}`,
      `学習者の回答: ${clip(m.userAnswer)}`,
      `該当コード: ${m.path} L${m.startLine}-${m.endLine}`,
      `</missed>`,
    ].join("\n"),
  );
  return `<missed_questions>\n${items.join("\n")}\n</missed_questions>`;
}

/** これまでの履歴に、今回のクイズの問題を足す(新しいものを残す)。 */
export function collectAsked(prior: AskedQuestion[] | undefined, quiz: Quiz): AskedQuestion[] {
  return [...(prior ?? []), ...quiz.questions.map(toAsked)].slice(-MAX_ASKED);
}

export function toAsked(q: Pick<GeneratedQuestion, "question" | "codeRef">): AskedQuestion {
  return { question: q.question, path: q.codeRef.path, startLine: q.codeRef.startLine, endLine: q.codeRef.endLine };
}

export function renderAsked(asked: AskedQuestion[]): string {
  const items = asked.map((a) => `- [${a.path} L${a.startLine}-${a.endLine}] ${a.question.slice(0, MAX_TEXT_CHARS)}`);
  return `<asked_questions>\n${items.join("\n")}\n</asked_questions>`;
}
