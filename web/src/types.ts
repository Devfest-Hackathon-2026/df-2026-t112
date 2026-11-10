export type PublicQuestion = {
  id: string;
  type: "choice" | "free";
  category: string;
  difficulty: number;
  question: string;
  codeRef: { path: string; startLine: number; endLine: number };
  snippet: string;
  choices: string[];
  hint: string;
};


export type RepoInfo = { owner: string; repo: string; branch: string; description: string | null };

export type QuizSession = { sessionId: string; repo: RepoInfo; questions: PublicQuestion[] };

export type Answer = { choice?: number; text?: string };
export type Answers = Record<string, Answer>;

/** サーバーから読み直したクイズ。回答途中の状態と、採点済みなら結果も入っている(#32)。 */
export type SavedQuiz = QuizSession & { answers: Answers; result: GradeResult | null };

export type QuestionResult = {
  id: string;
  category: string;
  type: "choice" | "free";
  score: number;
  correct: boolean;
  userAnswer: string;
  correctAnswer: string;
  explanation: string;
  feedback: string;
};

export type GradeResult = {
  overall: number;
  /** 説明力(記述式の平均)。この項目の追加前に保存された結果には無い。 */
  explanation?: number | null;
  summary: string;
  questions: QuestionResult[];
};

export type MistakeItem = {
  id: string;
  repo: { owner: string; name: string };
  reviewQuestion: string;
  codeRef: { path: string; startLine: number; endLine: number };
  snippet: string;
  wrongCount: number;
};

export type MistakeAnswer = {
  score: number;
  correct: boolean;
  feedback: string;
  rubric: string;
  explanation: string;
};

export type ResolvedMistakeItem = MistakeItem & { rubric: string; explanation: string; resolvedAt: number };
