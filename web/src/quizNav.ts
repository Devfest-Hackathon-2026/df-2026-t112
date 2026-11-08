import type { Answer, Answers, PublicQuestion } from "./types";

export function isAnswered(q: PublicQuestion, a: Answer | undefined): boolean {
  return q.type === "choice" ? a?.choice !== undefined : (a?.text ?? "").trim().length > 0;
}

/** 未回答の問題の位置を、前から順に返す。 */
export function unansweredIndexes(questions: PublicQuestion[], answers: Answers): number[] {
  return questions.flatMap((q, i) => (isAnswered(q, answers[q.id]) ? [] : [i]));
}

/** 再読み込み後は、最初の未回答の問題から再開する。全問回答済みなら最後の問題を開く。 */
export function startIndex(questions: PublicQuestion[], answers: Answers): number {
  return unansweredIndexes(questions, answers)[0] ?? Math.max(questions.length - 1, 0);
}
