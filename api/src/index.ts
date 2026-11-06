import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { fetchRepoSnapshot } from "./github/snapshot.js";
import { RepoError } from "./github/url.js";

export const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

const REPO_ERROR_STATUS = {
  invalid_url: 400,
  not_found: 404,
  private: 403,
  rate_limited: 429,
  empty: 422,
  upstream: 502,
} as const;

app.onError((err, c) => {
  if (err instanceof RepoError) {
    return c.json({ error: err.code, message: err.message }, REPO_ERROR_STATUS[err.code]);
  }
  console.error(err);
  return c.json({ error: "internal", message: "サーバーエラーが発生しました" }, 500);
});

app.post("/api/repo/preview", async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
  const snap = await fetchRepoSnapshot(String(body.url ?? ""), { token: process.env.GITHUB_TOKEN });
  return c.json({
    owner: snap.owner,
    repo: snap.repo,
    branch: snap.branch,
    description: snap.description,
    files: snap.files.map((f) => ({ path: f.path, chars: f.content.length })),
    skipped: snap.skipped,
  });
});

if (!process.env.VITEST) {
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port }, () => console.log(`api listening on :${port}`));
}
