import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const ACCESS_HEADER = "x-app-password";

function matches(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const deny = (c: Parameters<MiddlewareHandler>[0]) =>
  c.json({ error: "password_required", message: "パスワードが違います" }, 401);

/**
 * 共有パスワードがあるときだけ、API を X-App-Password ヘッダーで保護する。
 * /api/health は監視用なので除く。パスワード未設定なら何もしない(ローカル開発用)。
 */
export function accessPassword(password: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!password || c.req.path === "/api/health" || c.req.path === "/api/access") return next();
    if (!matches(password, c.req.header(ACCESS_HEADER))) return deny(c);
    await next();
  };
}

/** パスワード入力画面の確認用。合っていれば 200。 */
export function accessCheck(password: string | undefined): MiddlewareHandler {
  return async (c) => {
    if (password && !matches(password, c.req.header(ACCESS_HEADER))) return deny(c);
    return c.json({ ok: true, required: Boolean(password) });
  };
}
