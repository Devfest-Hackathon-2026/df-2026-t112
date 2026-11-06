export type Category = "reading" | "design" | "knowledge" | "quality" | "overall";

export const CATEGORIES: Category[] = ["reading", "design", "knowledge", "quality", "overall"];

export const CATEGORY_LABELS: Record<Category, string> = {
  reading: "コード読解",
  design: "設計・構造",
  knowledge: "言語/FW知識",
  quality: "エラー処理・品質",
  overall: "全体理解",
};

export type PublicQuestion = {
  id: string;
  type: "choice" | "free";
  category: Category;
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

export type QuestionResult = {
  id: string;
  category: Category;
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
  categories: Record<Category, number | null>;
  summary: string;
  questions: QuestionResult[];
};

export type GlobalStats = { count: number; averages: Record<Category, number | null> };
export type Weakness = { sessions: number; averages: Record<Category, number | null>; weakest: Category[] };

export const WEAK_THRESHOLD = 70;

/** 今回の結果から、苦手なカテゴリを低い順に最大 2 つ返す。 */
export function weakestOf(categories: Record<Category, number | null>): Category[] {
  return CATEGORIES.filter((c) => categories[c] !== null && categories[c]! < WEAK_THRESHOLD)
    .sort((a, b) => categories[a]! - categories[b]!)
    .slice(0, 2);
}
