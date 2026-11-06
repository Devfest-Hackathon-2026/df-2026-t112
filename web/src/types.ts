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
