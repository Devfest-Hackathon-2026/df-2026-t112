import { authHeaders } from "./auth";
import type { Answers, Category, GlobalStats, GradeResult, QuizSession, Weakness } from "./types";

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
  if (!res.ok) {
    // API は失敗時も必ず JSON を返す。JSON でなければ API に届いていない(開発中は API の未起動が多い)
    if (data === null && res.status >= 500) {
      throw new ApiError("unreachable", "API サーバーに接続できません。API が起動しているか確認してください");
    }
    throw new ApiError(data?.error ?? "unknown", data?.message ?? `エラーが発生しました (${res.status})`);
  }
  return data as T;
}

export const createQuiz = (url: string, focus: Category[] = []) =>
  request<QuizSession>("/api/quiz", { url, focus });

export const getQuiz = (sessionId: string) => request<QuizSession>(`/api/quiz/${sessionId}`);

export const gradeQuiz = (sessionId: string, answers: Answers) =>
  request<GradeResult>(`/api/quiz/${sessionId}/grade`, { answers });

export const getStats = () => request<GlobalStats>("/api/stats");
export const getWeakness = () => request<Weakness>("/api/weakness");
