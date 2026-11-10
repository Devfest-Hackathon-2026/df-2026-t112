import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { parseAllowlist, type Authenticator } from "./auth.js";
import { findLogin } from "./github/authorship.js";
import { checkRepo } from "./github/snapshot.js";
import { RepoError } from "./github/url.js";

// ログインした人の GitHub トークンは 8 時間で切れる。切れたトークンで GitHub に問い合わせたときの扱い

/** GitHub の代わり。どの問い合わせにも「トークンが違う」(401)を返す。 */
const refusingFetch = (async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })) as typeof fetch;

describe("GitHub refusing the token", () => {
  it("is reported as unauthorized, not as an unknown upstream error", async () => {
    await expect(checkRepo("github.com/o/r", { token: "ghu_old", fetchImpl: refusingFetch })).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(findLogin("1", { token: "ghu_old", fetchImpl: refusingFetch })).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("the API when the user's GitHub token has expired", () => {
  const auth: Authenticator = { verify: async (t) => (t === "token-alice" ? { uid: "alice", githubId: "1" } : null) };
  const post = (app: ReturnType<typeof createApp>, path: string, githubToken?: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token-alice",
        ...(githubToken ? { "x-github-token": githubToken } : {}),
      },
      body: JSON.stringify({ url: "github.com/o/r" }),
    });
  const refusing = async (): Promise<never> => {
    throw new RepoError("unauthorized", "GitHub の認証に失敗しました");
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells the screen to drop the user's token", async () => {
    const app = createApp({ auth, allowed: parseAllowlist("*"), checkRepo: refusing });
    const res = await post(app, "/api/repo/check", "ghu_old");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "github_token_expired",
      message: "GitHub のログインの期限が切れました。ログインし直してください",
    });
  });

  it("treats a refused server token as a server-side problem, not as the user's", async () => {
    const app = createApp({ auth, allowed: parseAllowlist("*"), checkRepo: refusing });
    const res = await post(app, "/api/repo/check");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("does so for checking a repository and for making a quiz, with GitHub refusing the token", async () => {
    vi.stubGlobal("fetch", refusingFetch);
    const app = createApp({ auth, allowed: parseAllowlist("*"), privateRepos: true });
    for (const path of ["/api/repo/check", "/api/quiz"]) {
      const res = await post(app, path, "ghu_old");
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("github_token_expired");
    }
  });
});
