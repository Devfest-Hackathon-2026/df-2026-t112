import { authHeaders } from "./auth";
import type { Answers, Category, GradeResult, QuizSession } from "./types";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(await authHeaders()) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", "サーバーに接続できませんでした");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? "unknown", data?.message ?? `エラーが発生しました (${res.status})`);
  return data as T;
}

export const createQuiz = (url: string, focus: Category[] = []) =>
  request<QuizSession>("/api/quiz", { url, focus });

export const gradeQuiz = (sessionId: string, answers: Answers) =>
  request<GradeResult>(`/api/quiz/${sessionId}/grade`, { answers });
