import { z } from "zod";

/** レーダーチャートの 5 軸。 */
export const CATEGORIES = ["reading", "design", "knowledge", "quality", "security"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  reading: "コード読解",
  design: "設計・全体理解",
  knowledge: "言語/FW知識",
  quality: "エラー処理・テスト",
  security: "セキュリティ",
};

export const questionSchema = z
  .object({
    type: z.enum(["choice", "free"]),
    category: z.enum(CATEGORIES),
    difficulty: z.number().int().min(1).max(3),
    question: z.string().min(1),
    codeRef: z.object({
      path: z.string().min(1),
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
    }),
    /** 選択式は 4 つ、記述式は空配列。 */
    choices: z.array(z.string().min(1)),
    /** 選択式は正解の添字、記述式は 0。 */
    answerIndex: z.number().int().min(0),
    /** 記述式の採点基準。選択式は空文字。 */
    rubric: z.string(),
    hint: z.string().min(1),
    explanation: z.string().min(1),
  })
  .superRefine((q, ctx) => {
    if (q.type === "choice") {
      if (q.choices.length !== 4) ctx.addIssue({ code: "custom", message: "choice requires 4 choices" });
      if (q.answerIndex >= q.choices.length) ctx.addIssue({ code: "custom", message: "answerIndex out of range" });
    } else if (q.rubric.trim() === "") {
      ctx.addIssue({ code: "custom", message: "free requires rubric" });
    }
  });

export type GeneratedQuestion = z.infer<typeof questionSchema>;

/** Gemini に返させる JSON の形。 */
export const generatedQuizSchema = z.object({ questions: z.array(questionSchema) });

export type Question = GeneratedQuestion & { id: string };

/** これまでに出した問題。続けて解くときに、同じ問題を出さないために使う。 */
export type AskedQuestion = { question: string; path: string; startLine: number; endLine: number };

export type Quiz = {
  repo: { owner: string; repo: string; branch: string; description: string | null };
  questions: Question[];
};
