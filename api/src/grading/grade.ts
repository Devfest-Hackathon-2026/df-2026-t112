import type { LlmClient } from "../llm/client.js";
import type { Quiz } from "../quiz/types.js";
import type { MistakeDraft } from "../store/mistakes.js";
import { reviewQuiz } from "./review.js";
import {
  categoryScores,
  currentCategory,
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

/** 採点結果と、間違えた問題集に入れる内容。mistakes は画面に返さない。 */
export type GradedQuiz = GradeResult & { mistakes: Omit<MistakeDraft, "sessionId">[] };

export async function gradeQuiz(
  quiz: Quiz,
  snippets: Record<string, string>,
  answers: Record<string, Answer>,
  llm: LlmClient,
  deadline?: number,
): Promise<GradedQuiz> {
  const choiceResults = quiz.questions.filter((q) => q.type === "choice").map((q) => gradeChoice(q, answers[q.id]));

  // 記述式の採点と総評は、Gemini 1 回の呼び出しにまとめる(無料枠の回数を節約するため)
  const { freeResults, summary, reviewItems } = await reviewQuiz(
    llm,
    quiz,
    quiz.questions
      .filter((q) => q.type === "free")
      .map((q) => ({ question: q, answer: answers[q.id], snippet: snippets[q.id] ?? "" })),
    choiceResults,
    deadline,
    snippets,
  );

  const byId = new Map([...choiceResults, ...freeResults].map((r) => [r.id, r]));
  const questions = quiz.questions.map((q) => byId.get(q.id)!);
  const categories = categoryScores(questions);

  const rewritten = new Map(reviewItems.map((item) => [item.id, item]));
  const mistakes = questions
    .filter((r) => !r.correct)
    .flatMap((r) => {
      const q = quiz.questions.find((x) => x.id === r.id);
      if (!q) return [];
      const review = q.type === "choice" ? rewritten.get(q.id) : undefined;
      return [
        {
          repo: { owner: quiz.repo.owner, name: quiz.repo.repo },
          type: q.type,
          category: currentCategory(q.category),
          question: q.question,
          // 記述式はそのまま。選択式は、作り変えが無ければ元の問題から作る
          reviewQuestion:
            q.type === "free"
              ? q.question
              : (review?.reviewQuestion ?? `${q.question}\n\n選択肢はありません。理由も含めて、自分の言葉で説明してください。`),
          rubric: q.type === "free" ? q.rubric : (review?.rubric ?? `- ${r.correctAnswer}\n- ${q.explanation}`),
          explanation: q.explanation,
          codeRef: q.codeRef,
          snippet: snippets[q.id] ?? "",
        },
      ];
    });

  return { overall: overallScore(categories), categories, explanation: explanationScore(questions), summary, questions, mistakes };
}
