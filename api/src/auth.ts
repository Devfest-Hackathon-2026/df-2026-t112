import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { MiddlewareHandler } from "hono";

export type AuthUser = { uid: string };

/** Firebase Auth への依存を差し替えられるようにする。 */
export interface Authenticator {
  verify(idToken: string): Promise<AuthUser | null>;
}

export class FirebaseAuthenticator implements Authenticator {
  async verify(idToken: string): Promise<AuthUser | null> {
    if (getApps().length === 0) initializeApp();
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      return { uid: decoded.uid };
    } catch {
      return null;
    }
  }
}

export type AuthVariables = {
  user: AuthUser | null;
  /** ユーザー本人の GitHub トークン。ログイン済みのときだけ有効にする。保存・ログ出力はしない。 */
  githubToken: string | undefined;
};

/**
 * Authorization: Bearer <Firebase ID token> を検証して user をセットする。
 * X-GitHub-Token は、検証できたユーザーの分だけ受け付ける。
 */
export function authMiddleware(auth?: Authenticator): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    let user: AuthUser | null = null;
    const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (auth && bearer) user = await auth.verify(bearer);
    c.set("user", user);
    c.set("githubToken", user ? c.req.header("x-github-token") || undefined : undefined);
    await next();
  };
}
