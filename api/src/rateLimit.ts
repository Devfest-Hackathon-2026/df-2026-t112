import type { MiddlewareHandler } from "hono";

/**
 * 固定窓の簡易レート制限(インスタンス単位・メモリ)。
 * Gemini の呼び出しコストを守るためのもので、厳密な制限ではない。
 */
export function rateLimit(opts: { limit: number; windowMs: number; now?: () => number }): MiddlewareHandler {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const t = now();
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);

    const key = clientIp(c.req.header("x-forwarded-for")) ?? "unknown";
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
