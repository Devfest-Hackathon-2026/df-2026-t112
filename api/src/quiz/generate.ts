import type { RepoSnapshot } from "../github/snapshot.js";
import { LlmError, type LlmClient } from "../llm/client.js";
import { buildQuizPrompt } from "./prompt.js";
import {
  QUIZ_SHAPE,
  generatedQuizSchema,
  type Category,
  type GeneratedQuestion,
  type Question,
  type Quiz,
} from "./types.js";

type Rng = () => number;

/** 正解位置の偏りを消すため、選択肢を並べ替えて answerIndex を付け替える。 */
export function shuffleChoices(q: GeneratedQuestion, rng: Rng = Math.random): GeneratedQuestion {
  if (q.type !== "choice") return q;
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, choices: order.map((i) => q.choices[i]), answerIndex: order.indexOf(q.answerIndex) };
}

export function checkShape(questions: GeneratedQuestion[]): string | null {
  const choice = questions.filter((q) => q.type === "choice").length;
  const free = questions.length - choice;
  if (choice !== QUIZ_SHAPE.choice || free !== QUIZ_SHAPE.free) {
    return `選択式 ${QUIZ_SHAPE.choice} 問・記述式 ${QUIZ_SHAPE.free} 問のはずが、選択式 ${choice} 問・記述式 ${free} 問でした`;
  }
  return null;
}

export type GenerateOptions = {
  focus?: Category[];
  rng?: Rng;
  /** 形式不正のときに再試行する回数。 */
  retries?: number;
};

export async function generateQuiz(snap: RepoSnapshot, llm: LlmClient, opts: GenerateOptions = {}): Promise<Quiz> {
  const { system, user } = buildQuizPrompt(snap, opts.focus);
  const retries = opts.retries ?? 1;
  let lastProblem = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    const prompt = attempt === 0 ? user : `${user}\n\n前回の出力には問題がありました: ${lastProblem}\n修正して出力してください。`;
    const raw = await llm.generateJson({ system, user: prompt, schema: generatedQuizSchema });
    const parsed = generatedQuizSchema.safeParse(raw);
    if (!parsed.success) {
      lastProblem = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      continue;
    }
    const shape = checkShape(parsed.data.questions);
    if (shape) {
      lastProblem = shape;
      continue;
    }
    const questions: Question[] = parsed.data.questions.map((q, i) => ({
      ...shuffleChoices(q, opts.rng),
      id: `q${i + 1}`,
    }));
    return {
      repo: { owner: snap.owner, repo: snap.repo, branch: snap.branch, description: snap.description },
      questions,
    };
  }
  throw new LlmError(`問題の生成に失敗しました: ${lastProblem}`);
}
