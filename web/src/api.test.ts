import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ログインした人の GitHub トークンは 8 時間で切れる。切れていたら、捨ててもう 1 回だけ送る

const token = vi.hoisted(() => ({ held: true }));
vi.mock("./firebase", () => ({
  authHeaders: async () => (token.held ? { Authorization: "Bearer id", "X-GitHub-Token": "ghu_old" } : { Authorization: "Bearer id" }),
  hasGithubToken: () => token.held,
  forgetGithubToken: () => {
    token.held = false;
  },
}));

import { checkRepo } from "./api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const expired = () => json(401, { error: "github_token_expired", message: "GitHub のログインの期限が切れました" });
const repo = { owner: "o", repo: "r", description: null };

describe("an expired GitHub token", () => {
  let sent: (string | null)[];
  /** 送ったリクエストの GitHub トークンを記録し、answer で応答を返す。 */
  const serve = (answer: (githubToken: string | null) => Response) =>
    vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
      const githubToken = (init.headers as Record<string, string>)["X-GitHub-Token"] ?? null;
      sent.push(githubToken);
      return answer(githubToken);
    });

  beforeEach(() => {
    sent = [];
    token.held = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is dropped, and the request is sent once more without it", async () => {
    serve((githubToken) => (githubToken ? expired() : json(200, repo)));
    await expect(checkRepo("github.com/o/r")).resolves.toEqual(repo);
    expect(sent).toEqual(["ghu_old", null]);
    expect(token.held).toBe(false);
  });

  it("is not retried more than once", async () => {
    serve(() => expired());
    await expect(checkRepo("github.com/o/r")).rejects.toMatchObject({ code: "github_token_expired" });
    expect(sent).toEqual(["ghu_old", null]);
  });

  it("is kept for other errors", async () => {
    serve(() => json(404, { error: "not_found", message: "リポジトリが見つかりません" }));
    await expect(checkRepo("github.com/o/r")).rejects.toMatchObject({ code: "not_found" });
    expect(sent).toEqual(["ghu_old"]);
    expect(token.held).toBe(true);
  });
});
