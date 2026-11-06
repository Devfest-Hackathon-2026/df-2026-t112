import type { LlmClient } from "../llm/client.js";
import type { Quiz } from "../quiz/types.js";
import { gradeFree } from "./free.js";
import { summarizeResult } from "./summary.js";
import {
  categoryScores,
  gradeChoice,
  overallScore,
  type Answer,
  type CategoryScores,
  type QuestionResult,
} from "./scoring.js";

export type GradeResult = {
  overall: number;
  categories: CategoryScores;
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
  const freeResults = await gradeFree(
    llm,
    quiz.questions
      .filter((q) => q.type === "free")
      .map((q) => ({ question: q, answer: answers[q.id], snippet: snippets[q.id] ?? "" })),
  );

  const byId = new Map([...choiceResults, ...freeResults].map((r) => [r.id, r]));
  const questions = quiz.questions.map((q) => byId.get(q.id)!);
  const categories = categoryScores(questions);
  const overall = overallScore(categories);
  const summary = await summarizeResult(llm, quiz, questions, categories, overall);
  return { overall, categories, summary, questions };
}
