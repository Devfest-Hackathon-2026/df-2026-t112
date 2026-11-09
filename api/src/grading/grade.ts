import type { LlmClient } from "../llm/client.js";
import type { Quiz } from "../quiz/types.js";
import { reviewQuiz } from "./review.js";
import {
  categoryScores,
  explanationScore,
  gradeChoice,
  overallScore,
  type Answer,
  type CategoryScores,
  type QuestionResult,
} from "./scoring.js";

export type GradeResult = {
  overall: number;
  categories: CategoryScores;
  /** 説明力(記述式の平均)。記述式が無ければ null。 */
  explanation: number | null;
  summary: string;
  questions: QuestionResult[];
};

export async function gradeQuiz(
  quiz: Quiz,
  snippets: Record<string, string>,
  answers: Record<string, Answer>,
  llm: LlmClient,
): Promise<GradeResult> {
  const choiceResults = quiz.questions.filter((q) => q.type === "choice").map((q) => gradeChoice(q, answers[q.id]));

  // 記述式の採点と総評は、Gemini 1 回の呼び出しにまとめる(無料枠の回数を節約するため)
  const { freeResults, summary } = await reviewQuiz(
    llm,
    quiz,
    quiz.questions
      .filter((q) => q.type === "free")
      .map((q) => ({ question: q, answer: answers[q.id], snippet: snippets[q.id] ?? "" })),
    choiceResults,
  );

  const byId = new Map([...choiceResults, ...freeResults].map((r) => [r.id, r]));
  const questions = quiz.questions.map((q) => byId.get(q.id)!);
  const categories = categoryScores(questions);
  return { overall: overallScore(categories), categories, explanation: explanationScore(questions), summary, questions };
}
