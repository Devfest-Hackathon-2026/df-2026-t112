import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { MiddlewareHandler } from "hono";

/** ログインしている人。githubId は GitHub の数字の ID(名前を変えても変わらない)。 */
export type AuthUser = { uid: string; githubId: string };

/** Firebase Auth への依存を差し替えられるようにする。 */
export interface Authenticator {
  verify(idToken: string): Promise<AuthUser | null>;
}

export class FirebaseAuthenticator implements Authenticator {
  async verify(idToken: string): Promise<AuthUser | null> {
    if (getApps().length === 0) initializeApp();
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      return toAuthUser(decoded.uid, decoded.firebase);
    } catch {
      return null;
    }
  }
}

/**
 * GitHub でログインしたトークンだけを受け付ける。
 * ほかの方法(メールなど)でログインした人は GitHub の ID が無く、許可リストで確かめられないため。
 */
export function toAuthUser(
  uid: string,
  firebase: { sign_in_provider?: string; identities?: Record<string, unknown> } | undefined,
): AuthUser | null {
  if (firebase?.sign_in_provider !== "github.com") return null;
  const ids = firebase.identities?.["github.com"];
  const githubId = Array.isArray(ids) ? ids[0] : undefined;
  return typeof githubId === "string" && githubId !== "" ? { uid, githubId } : null;
}

/** 開発用(AUTH=dev)では、すべてのリクエストをこの人として扱う。 */
export const DEV_USER: AuthUser = { uid: "dev-user", githubId: "0" };

/**
 * 環境変数 AUTH から認証の方法を決める。
 * firebase なら Firebase ID token を検証する。未指定か dev なら開発用(undefined を返し、DEV_USER として扱う)。
 */
export function authFromEnv(env: NodeJS.ProcessEnv = process.env): Authenticator | undefined {
  if (env.AUTH === "firebase") return new FirebaseAuthenticator();
  if (env.AUTH && env.AUTH !== "dev") throw new Error(`AUTH の値が正しくありません: ${env.AUTH}(firebase か dev)`);
  return undefined;
}

/** 使ってよい人。GitHub の数字の ID で確かめる(ユーザー名は変えられ、別の人が取り直せるため)。 */
export type Allowlist = { has(githubId: string): boolean; size: number | "all" };

/**
 * ALLOWED_GITHUB_IDS の値を読む。スペースかカンマで区切る。"*" なら全員。
 * 空なら誰も使えない(設定を忘れたときに、誰でも使える状態にしないため)。
 */
export function parseAllowlist(value: string | undefined): Allowlist {
  const ids = new Set((value ?? "").split(/[\s,]+/).filter(Boolean));
  if (ids.has("*")) return { has: () => true, size: "all" };
  return { has: (id) => ids.has(id), size: ids.size };
}

export type AuthVariables = {
  /** requireUser より後ろでは、必ずログインしている人が入っている。 */
  user: AuthUser;
  /** ユーザー本人の GitHub トークン。検証できた人の分だけ受け付ける。保存・ログ出力はしない。 */
  githubToken: string | undefined;
};

/** ログインしなくても呼べるパス(監視用)。 */
const PUBLIC_PATHS = new Set(["/api/health"]);

/**
 * Authorization: Bearer <Firebase ID token> を検証して、ログインしている人を確かめる。
 * ログインしていなければ 401、許可リストに無ければ 403 を返す。
 * auth が無いとき(開発用)は、すべてのリクエストを DEV_USER として扱い、X-GitHub-Token は使わない。
 */
export function requireUser(opts: { auth?: Authenticator; allowed: Allowlist }): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    if (!opts.auth) {
      c.set("user", DEV_USER);
      c.set("githubToken", undefined);
      return next();
    }
    const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const user = bearer ? await opts.auth.verify(bearer) : null;
    if (!user) return c.json({ error: "unauthorized", message: "ログインが必要です" }, 401);
    if (!opts.allowed.has(user.githubId)) {
      return c.json({ error: "not_allowed", message: "このアカウントは、まだ使えません" }, 403);
    }
    c.set("user", user);
    c.set("githubToken", c.req.header("x-github-token") || undefined);
    await next();
  };
}
