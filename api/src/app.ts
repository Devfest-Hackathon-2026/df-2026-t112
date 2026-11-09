import { Hono } from "hono";
import { accessCheck, accessPassword } from "./accessPassword.js";
import { authMiddleware, type AuthUser, type AuthVariables, type Authenticator } from "./auth.js";
import type { RepoSize } from "./github/filter.js";
import { checkRepo, fetchRepoSnapshot, type RepoCheck, type RepoSnapshot } from "./github/snapshot.js";
import { RepoError } from "./github/url.js";
import { LlmError, createGeminiClient, type LlmClient } from "./llm/client.js";
import { gradeQuiz } from "./grading/grade.js";
import type { Answer } from "./grading/scoring.js";
import { analyzeWeakness } from "./grading/weakness.js";
import { generateQuiz, generateSimilarQuiz } from "./quiz/generate.js";
import { snippetsFor, toPublicQuestions } from "./quiz/public.js";
import { PROFILES, fixedProfileFromEnv, profileForSize, type Profile } from "./quiz/profile.js";
import { collectAsked, missedQuestions } from "./quiz/retry.js";
import { rateLimit } from "./rateLimit.js";
import { MemorySessionStore, type SessionStore } from "./store/session.js";
import { MemoryStatsStore, type StatsStore } from "./store/stats.js";

export type Deps = {
  store: SessionStore;
  stats: StatsStore;
  /** 未指定なら初回利用時に Gemini クライアントを作る。 */
  llm?: LlmClient;
  /** userToken はログイン済みユーザー本人の GitHub トークン。あれば非公開リポジトリも読む。 */
  fetchSnapshot: (url: string, userToken?: string) => Promise<RepoSnapshot>;
  /** 入力欄の即時チェック用。リポジトリを読めるかどうかだけを確かめる。 */
  checkRepo: (url: string, userToken?: string) => Promise<RepoCheck>;
  /** 未指定なら認証なし(匿名のみ)。 */
  auth?: Authenticator;
  /** クイズの大きさを固定する。未指定なら環境変数 QUIZ_PROFILE、それも無ければリポジトリの規模で決める。 */
  profile?: Profile;
  /** 共有パスワード。未指定なら環境変数 APP_PASSWORD。空なら保護しない。 */
  accessPassword?: string;
};

const REPO_ERROR_STATUS = {
  invalid_url: 400,
  not_found: 404,
  private: 403,
  rate_limited: 429,
  empty: 422,
  upstream: 502,
} as const;

export function createApp(partial: Partial<Deps> = {}): Hono<{ Variables: AuthVariables }> {
  const fixedProfile = partial.profile ?? fixedProfileFromEnv();
  const limits = (size: RepoSize) => (fixedProfile ?? profileForSize(size)).limits;
  const deps: Deps = {
    store: partial.store ?? new MemorySessionStore(),
    stats: partial.stats ?? new MemoryStatsStore(),
    llm: partial.llm,
    auth: partial.auth,
    profile: fixedProfile,
    checkRepo:
      partial.checkRepo ??
      ((url, userToken) =>
        userToken ? checkRepo(url, { token: userToken, allowPrivate: true }) : checkRepo(url, { token: process.env.GITHUB_TOKEN })),
    fetchSnapshot:
      partial.fetchSnapshot ??
      ((url, userToken) =>
        userToken
          ? fetchRepoSnapshot(url, { token: userToken, allowPrivate: true, limits })
          : fetchRepoSnapshot(url, { token: process.env.GITHUB_TOKEN, limits })),
  };
  /** 固定されていなければ、切り詰める前の本体のコードの総量で問題数を決める。 */
  const profileFor = (snap: RepoSnapshot): Profile =>
    deps.profile ??
    profileForSize(snap.size ?? { files: snap.files.length, bytes: snap.files.reduce((n, f) => n + f.content.length, 0) });
  const getLlm = () => (deps.llm ??= createGeminiClient());

  /** ログインユーザーが作ったセッションは本人にだけ見せる(存在も明かさない)。 */
  const findSession = async (id: string, user: AuthUser | null) => {
    const session = await deps.store.get(id);
    if (session?.uid && session.uid !== user?.uid) return undefined;
    return session;
  };

  const app = new Hono<{ Variables: AuthVariables }>();
  const password = partial.accessPassword ?? process.env.APP_PASSWORD;
  app.use("/api/*", accessPassword(password));
  app.use("/api/*", authMiddleware(deps.auth));
  app.get("/api/access", accessCheck(password));

  app.onError((err, c) => {
    if (err instanceof RepoError) {
      return c.json({ error: err.code, message: err.message }, REPO_ERROR_STATUS[err.code]);
    }
    if (err instanceof LlmError) {
      return c.json({ error: "llm", message: err.message }, 502);
    }
    console.error(err);
    return c.json({ error: "internal", message: "サーバーエラーが発生しました" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  // 入力のたびに呼ばれるので、共有の GitHub トークンを使い切らないように回数を絞る
  app.post("/api/repo/check", rateLimit({ limit: Number(process.env.REPO_CHECK_PER_HOUR ?? 300), windowMs: 60 * 60 * 1000 }));
  app.post("/api/repo/check", async (c) => {
    const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
    return c.json(await deps.checkRepo(String(body.url ?? ""), c.get("githubToken")));
  });

  app.post("/api/repo/preview", async (c) => {
    const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
    const snap = await deps.fetchSnapshot(String(body.url ?? ""), c.get("githubToken"));
    return c.json({
      owner: snap.owner,
      repo: snap.repo,
      branch: snap.branch,
      description: snap.description,
      files: snap.files.map((f) => ({ path: f.path, chars: f.content.length })),
      skipped: snap.skipped,
    });
  });

  // 問題生成・採点は Gemini を呼ぶので、1 クライアントあたりの回数を絞る
  const expensive = rateLimit({ limit: Number(process.env.RATE_LIMIT_PER_HOUR ?? 10), windowMs: 60 * 60 * 1000 });
  app.post("/api/quiz", expensive);
  app.post("/api/quiz/:id/grade", expensive);
  app.post("/api/quiz/:id/retry", expensive);

  app.post("/api/quiz", async (c) => {
    const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
    const t0 = Date.now();
    const snap = await deps.fetchSnapshot(String(body.url ?? ""), c.get("githubToken"));
    const chars = snap.files.reduce((n, f) => n + f.content.length, 0);
    console.log(`[quiz] ${snap.owner}/${snap.repo}: fetched ${snap.files.length} files, ${chars} chars in ${Date.now() - t0}ms`);
    const quiz = await generateQuiz(snap, getLlm(), { profile: profileFor(snap), log: (m) => console.log(`[quiz] ${m}`) });
    console.log(`[quiz] done in ${Date.now() - t0}ms`);
    const snippets = snippetsFor(quiz, snap.files);
    const session = await deps.store.create({ quiz, snippets, uid: c.get("user")?.uid });
    return c.json({ sessionId: session.id, repo: quiz.repo, questions: toPublicQuestions(quiz, snippets) });
  });

  app.get("/api/quiz/:id", async (c) => {
    const session = await findSession(c.req.param("id"), c.get("user"));
    if (!session) return c.json({ error: "not_found", message: "セッションが見つかりません" }, 404);
    return c.json({
      sessionId: session.id,
      repo: session.quiz.repo,
      questions: toPublicQuestions(session.quiz, session.snippets),
    });
  });

  app.post("/api/quiz/:id/grade", async (c) => {
    const session = await findSession(c.req.param("id"), c.get("user"));
    if (!session) return c.json({ error: "not_found", message: "セッションが見つかりません" }, 404);
    if (session.result) return c.json(session.result);

    const body = await c.req.json<{ answers?: unknown }>().catch(() => ({}) as { answers?: unknown });
    const answers = sanitizeAnswers(body.answers);
    const result = await gradeQuiz(session.quiz, session.snippets, answers, getLlm());
    await deps.store.saveResult(session.id, result);
    // 集計の失敗で採点結果を返せなくならないようにする
    await deps.stats.record(result).catch((e) => console.error("stats record failed", e));
    return c.json(result);
  });

  // 続けて解く。間違えた問題があれば類似問題を、全問正解なら同じリポジトリのまだ解いていない問題を、短いクイズで作る
  app.post("/api/quiz/:id/retry", async (c) => {
    const session = await findSession(c.req.param("id"), c.get("user"));
    if (!session) return c.json({ error: "not_found", message: "セッションが見つかりません" }, 404);
    if (!session.result) return c.json({ error: "not_graded", message: "採点が終わってから再挑戦してください" }, 409);
    const missed = missedQuestions(session.quiz, session.result.questions);
    const asked = collectAsked(session.asked, session.quiz);
    const log = (m: string) => console.log(`[retry] ${m}`);

    const { owner, repo } = session.quiz.repo;
    const snap = await deps.fetchSnapshot(`https://github.com/${owner}/${repo}`, c.get("githubToken"));
    const quiz =
      missed.length > 0
        ? await generateSimilarQuiz(snap, getLlm(), missed, { asked, log })
        : await generateQuiz(snap, getLlm(), { profile: profileFor(snap).name === "tiny" ? PROFILES.tiny : PROFILES.mini, asked, log });
    const snippets = snippetsFor(quiz, snap.files);
    const next = await deps.store.create({ quiz, snippets, asked, uid: c.get("user")?.uid });
    return c.json({ sessionId: next.id, repo: quiz.repo, questions: toPublicQuestions(quiz, snippets) });
  });

  // ログインユーザーの過去の結果から苦手カテゴリを出す
  app.get("/api/weakness", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized", message: "ログインが必要です" }, 401);
    return c.json(analyzeWeakness(await deps.store.listResultsByUid(user.uid, 20)));
  });

  app.get("/api/stats", async (c) => c.json(await deps.stats.get()));

  return app;
}

function sanitizeAnswers(input: unknown): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  if (typeof input !== "object" || input === null) return out;
  for (const [id, v] of Object.entries(input)) {
    if (typeof v !== "object" || v === null) continue;
    const { choice, text } = v as { choice?: unknown; text?: unknown };
    out[id] = {
      choice: Number.isInteger(choice) ? (choice as number) : undefined,
      text: typeof text === "string" ? text : undefined,
    };
  }
  return out;
}
