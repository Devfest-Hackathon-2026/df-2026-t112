import type { RepoFile } from "../github/snapshot.js";
import type { Category, Question, Quiz } from "./types.js";

/** クライアントに渡す問題。正解・採点基準・解説は含めない。 */
export type PublicQuestion = {
  id: string;
  type: Question["type"];
  category: Category;
  difficulty: number;
  question: string;
  codeRef: Question["codeRef"];
  snippet: string;
  choices: string[];
  hint: string;
};

const MAX_SNIPPET_LINES = 40;

export function extractSnippet(files: RepoFile[], ref: Question["codeRef"]): string {
  const file = files.find((f) => f.path === ref.path);
  if (!file) return "";
  const lines = file.content.split("\n");
  const start = Math.max(ref.startLine, 1);
  const end = Math.min(ref.endLine, start + MAX_SNIPPET_LINES - 1, lines.length);
  return lines.slice(start - 1, end).join("\n");
}

export function snippetsFor(quiz: Quiz, files: RepoFile[]): Record<string, string> {
  return Object.fromEntries(quiz.questions.map((q) => [q.id, extractSnippet(files, q.codeRef)]));
}

export function toPublicQuestions(quiz: Quiz, snippets: Record<string, string>): PublicQuestion[] {
  return quiz.questions.map((q) => ({
    id: q.id,
    type: q.type,
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    codeRef: q.codeRef,
    snippet: snippets[q.id] ?? "",
    choices: q.choices,
    hint: q.hint,
  }));
}
