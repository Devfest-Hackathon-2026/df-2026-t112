import type { RepoSnapshot } from "../github/snapshot.js";
import { LlmError, type LlmClient } from "../llm/client.js";
import { planChunks, primaryFiles, type ChunkSpec } from "./plan.js";
import type { Profile } from "./profile.js";
import { buildQuizPrompt } from "./prompt.js";
import {
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

/** チャンクの内訳(選択式・記述式の数)と一致しているか。 */
export function checkShape(questions: GeneratedQuestion[], spec: ChunkSpec): string | null {
  const choice = questions.filter((q) => q.type === "choice").length;
  const free = questions.length - choice;
  if (choice !== spec.choice.length || free !== spec.free.length) {
    return `選択式 ${spec.choice.length} 問・記述式 ${spec.free.length} 問のはずが、選択式 ${choice} 問・記述式 ${free} 問でした`;
  }
  return null;
}

export type GenerateOptions = {
  focus?: Category[];
  /** クイズの大きさ。未指定なら環境変数 QUIZ_PROFILE(既定は mini)。 */
  profile?: Profile;
  rng?: Rng;
  /** 形式不正のときに再試行する回数(チャンクごと)。 */
  retries?: number;
  /** 所要時間や再試行の理由を受け取る(省略時は何もしない)。 */
  log?: (message: string) => void;
};

/** 1 チャンク分(選択式 5 問 + 記述式 1 問)を生成する。形式が不正なら再試行する。 */
async function generateChunk(
  snap: RepoSnapshot,
  llm: LlmClient,
  spec: ChunkSpec,
  index: number,
  chunks: number,
  retries: number,
  log: (message: string) => void,
): Promise<GeneratedQuestion[]> {
  const { system, user } = buildQuizPrompt(snap, spec, primaryFiles(snap.files.map((f) => f.path), index, chunks));
  let lastProblem = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    const prompt = attempt === 0 ? user : `${user}

前回の出力には問題がありました: ${lastProblem}
修正して出力してください。`;
    const started = Date.now();
    const raw = await llm.generateJson({ system, user: prompt, schema: generatedQuizSchema });
    log(`chunk ${index + 1} attempt ${attempt + 1}: gemini ${Date.now() - started}ms`);

    const parsed = generatedQuizSchema.safeParse(raw);
    if (!parsed.success) {
      lastProblem = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } else {
      const shape = checkShape(parsed.data.questions, spec);
      if (!shape) return parsed.data.questions;
      lastProblem = shape;
    }
    log(`chunk ${index + 1} attempt ${attempt + 1} rejected: ${lastProblem}`);
  }
  throw new LlmError(`問題の生成に失敗しました: ${lastProblem}`);
}

/**
 * プロファイルの問題数を、chunks 回の呼び出しに分けて並列に生成する。1 回で全部作るより応答が速く、
 * 1 回が失敗しても、そのチャンクだけをやり直せる。
 */
export async function generateQuiz(snap: RepoSnapshot, llm: LlmClient, opts: GenerateOptions = {}): Promise<Quiz> {
  const retries = opts.retries ?? 1;
  const log = opts.log ?? (() => {});
  const specs = planChunks(opts.focus, opts.profile);

  const chunks = await Promise.all(specs.map((spec, i) => generateChunk(snap, llm, spec, i, specs.length, retries, log)));

  // 選択式 → 記述式の順に並べる(チャンク内の順序は保つ)
  const all = chunks.flat();
  const ordered = [...all.filter((q) => q.type === "choice"), ...all.filter((q) => q.type === "free")];
  const questions: Question[] = ordered.map((q, i) => ({ ...shuffleChoices(q, opts.rng), id: `q${i + 1}` }));
  return {
    repo: { owner: snap.owner, repo: snap.repo, branch: snap.branch, description: snap.description },
    questions,
  };
}
