import type { Category, QuizSession } from "./types";

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
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
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
