import type { Context, Env, MiddlewareHandler } from "hono";

/**
 * 固定窓の簡易レート制限(インスタンス単位・メモリ)。
 * Gemini の呼び出しコストを守るためのもので、厳密な制限ではない。
 */
export function rateLimit<E extends Env = Env>(opts: {
  limit: number;
  windowMs: number;
  /** 回数を数える単位。未指定なら接続元の IP アドレス。 */
  key?: (c: Context<E>) => string | undefined;
  now?: () => number;
}): MiddlewareHandler<E> {
  const now = opts.now ?? Date.now;
  const keyOf = opts.key ?? ((c: Context<E>) => clientIp(c.req.header("x-forwarded-for")));
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const t = now();
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);

    const key = keyOf(c) ?? "unknown";
    const entry = hits.get(key) ?? { count: 0, resetAt: t + opts.windowMs };
    entry.count++;
    hits.set(key, entry);

    if (entry.count > opts.limit) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - t) / 1000)));
      return c.json({ error: "rate_limited", message: "リクエストが多すぎます。しばらくしてから再度お試しください" }, 429);
    }
    await next();
  };
}

function clientIp(forwardedFor: string | undefined): string | undefined {
  return forwardedFor?.split(",")[0]?.trim() || undefined;
}
