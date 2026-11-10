import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { parseAllowlist, type Authenticator } from "./auth.js";
import { RepoError } from "./github/url.js";
import { githubAccess, parsePrivateRepos, repoErrorMessage } from "./privateRepos.js";

describe("parsePrivateRepos", () => {
  it("reads private repositories only when PRIVATE_REPOS is on", () => {
    expect(parsePrivateRepos("on")).toBe(true);
    expect(parsePrivateRepos(" ON ")).toBe(true);
  });

  it.each([undefined, "", "off", "true", "1", "yes"])("stays off for %j", (value) => {
    expect(parsePrivateRepos(value)).toBe(false);
  });
});

describe("githubAccess", () => {
  it("reads with the user's own token, and private repositories only when allowed", () => {
    expect(githubAccess("ghu_user", true, "server")).toEqual({ token: "ghu_user", allowPrivate: true });
    expect(githubAccess("ghu_user", false, "server")).toEqual({ token: "ghu_user", allowPrivate: false });
  });

  it("never reads private repositories with the shared server token", () => {
    expect(githubAccess(undefined, true, "server")).toEqual({ token: "server" });
    expect(githubAccess(undefined, false, undefined)).toEqual({ token: undefined });
  });
});

describe("repoErrorMessage", () => {
  it("says private repositories are not supported yet when they are off", () => {
    expect(repoErrorMessage(new RepoError("private", "ログインし直すと読めます"), false)).toBe("非公開リポジトリには、まだ対応していません");
    expect(repoErrorMessage(new RepoError("not_found", "見つかりません"), false)).toBe(
      "リポジトリが見つかりません(非公開リポジトリには、まだ対応していません)",
    );
  });

  it("keeps the original message otherwise", () => {
    expect(repoErrorMessage(new RepoError("private", "ログインし直すと読めます"), true)).toBe("ログインし直すと読めます");
    expect(repoErrorMessage(new RepoError("empty", "空です"), false)).toBe("空です");
  });
});

describe("the API with private repositories off", () => {
  const auth: Authenticator = { verify: async (t) => (t === "token-alice" ? { uid: "alice", githubId: "1" } : null) };
  const headers = {
    "content-type": "application/json",
    authorization: "Bearer token-alice",
    "x-github-token": "ghu_alice",
  };
  const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
    app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const failWith = (code: "not_found" | "private") => async (): Promise<never> => {
    throw new RepoError(code, "元の説明");
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells the screen whether private repositories can be read", async () => {
    for (const privateRepos of [false, true]) {
      const app = createApp({ auth, allowed: parseAllowlist("*"), privateRepos });
      const res = await app.request("/api/me", { headers });
      expect(await res.json()).toEqual({ githubId: "1", privateRepos });
    }
  });

  it("does not point to the GitHub App for a repository it cannot find", async () => {
    let looked = false;
    const app = createApp({
      auth,
      allowed: parseAllowlist("*"),
      privateRepos: false,
      checkRepo: failWith("not_found"),
      findRepoAccess: async () => {
        looked = true;
        return { kind: "install" };
      },
    });
    const res = await post(app, "/api/repo/check", { url: "github.com/alice/secret" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: "リポジトリが見つかりません(非公開リポジトリには、まだ対応していません)",
    });
    expect(looked).toBe(false);
  });

  it("says a private repository is not supported yet, when checking and when making a quiz", async () => {
    const app = createApp({
      auth,
      allowed: parseAllowlist("*"),
      privateRepos: false,
      checkRepo: failWith("private"),
      // クイズは、ログインした本人が書いたコードから作る
      findLogin: async () => "alice",
      fetchAuthoredSnapshot: failWith("private"),
    });
    for (const path of ["/api/repo/check", "/api/quiz"]) {
      const res = await post(app, path, { url: "github.com/alice/secret" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "private", message: "非公開リポジトリには、まだ対応していません" });
    }
  });

  it("asks GitHub with the user's token but refuses the private repository it returns", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    // GitHub の代わり。alice の非公開リポジトリで、alice のコミットがある
    const github: Record<string, unknown> = {
      "/repos/alice/secret": { default_branch: "main", description: null, private: true },
      "/user/1": { login: "alice" },
      "/repos/alice/secret/commits": [{ sha: "a", parents: [{}] }],
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
      const body = github[new URL(String(input)).pathname];
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 404 });
    });
    const off = createApp({ auth, allowed: parseAllowlist("*"), privateRepos: false });
    const refused = await post(off, "/api/repo/check", { url: "github.com/alice/secret" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "private", message: "非公開リポジトリには、まだ対応していません" });
    expect(seen).toEqual([{ url: "https://api.github.com/repos/alice/secret", authorization: "Bearer ghu_alice" }]);

    const on = createApp({ auth, allowed: parseAllowlist("*"), privateRepos: true });
    const read = await post(on, "/api/repo/check", { url: "github.com/alice/secret" });
    expect(read.status).toBe(200);
  });
});
