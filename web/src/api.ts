import { authHeaders, forgetGithubToken, hasGithubToken } from "./firebase";
import type {
  Answer,
  Answers,
  GradeResult,
  QuizSession,
  MistakeAnswer,
  MistakeItem,
  ResolvedMistakeItem,
  SavedQuiz,
} from "./types";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    /** API が返したエラーの本文(error と message のほかに、案内などが入ることがある)。 */
    public data?: unknown,
  ) {
    super(message);
  }
}

type RequestOptions = {
  signal?: AbortSignal;
  /** 未指定なら、body が無ければ GET、あれば POST。 */
  method?: "GET" | "POST" | "PUT";
  /** ページを閉じても送り終える(回答の保存に使う)。 */
  keepalive?: boolean;
};

async function request<T>(path: string, body?: unknown, signalOrOptions?: AbortSignal | RequestOptions): Promise<T> {
  const options: RequestOptions = signalOrOptions instanceof AbortSignal ? { signal: signalOrOptions } : (signalOrOptions ?? {});
  try {
    return await send<T>(path, body, options);
  } catch (e) {
    // GitHub のトークンが切れていた(8 時間で切れる)。捨てて、もう 1 回だけ送る。公開リポジトリはサーバーの
    // トークンで読め、非公開リポジトリには「ログインし直す」の案内が出る
    if (!(e instanceof ApiError) || e.code !== "github_token_expired" || !hasGithubToken()) throw e;
    forgetGithubToken();
    return send<T>(path, body, options);
  }
}

async function send<T>(path: string, body: unknown, options: RequestOptions): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(await authHeaders()) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
      keepalive: options.keepalive,
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
    throw new ApiError(data?.error ?? "unknown", data?.message ?? `エラーが発生しました (${res.status})`, data);
  }
  return data as T;
}

/** ログインしている人が、使ってよい人かどうか。許可リストに無ければ not_allowed で失敗する。privateRepos は、API が非公開リポジトリを読むか。 */
export const getMe = () => request<{ githubId: string; privateRepos?: boolean }>("/api/me");

export const checkRepo = (url: string, signal?: AbortSignal) =>
  request<{ owner: string; repo: string; description: string | null }>("/api/repo/check", { url }, signal);

export const createQuiz = (url: string) => request<QuizSession>("/api/quiz", { url });

export const retryQuiz = (sessionId: string) => request<QuizSession>(`/api/quiz/${sessionId}/retry`, {});

/** 保存した回答と、採点済みなら結果も返る。再読み込みや別のタブで、続きから表示するのに使う。 */
export const getQuiz = (sessionId: string) => request<SavedQuiz>(`/api/quiz/${sessionId}`);

/** 1 問分の回答をサーバーに保存する。採点済みのクイズなら already_graded で失敗する。 */
export const saveAnswer = (sessionId: string, questionId: string, answer: Answer) =>
  request<null>(`/api/quiz/${sessionId}/answers/${encodeURIComponent(questionId)}`, answer, { method: "PUT", keepalive: true });

export const gradeQuiz = (sessionId: string, answers: Answers) =>
  request<GradeResult>(`/api/quiz/${sessionId}/grade`, { answers });

export const listMistakes = () => request<{ open: MistakeItem[]; resolved: ResolvedMistakeItem[] }>("/api/mistakes");

export const answerMistake = (id: string, text: string) => request<MistakeAnswer>(`/api/mistakes/${id}/answer`, { text });
