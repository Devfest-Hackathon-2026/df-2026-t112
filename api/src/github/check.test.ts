import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { checkRepo } from "./snapshot.js";
import { RepoError } from "./url.js";

const fetching = (body: object, status = 200) => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
};

const publicRepo = { default_branch: "main", description: "d", private: false };
const privateRepo = { default_branch: "main", description: null, private: true };

describe("checkRepo", () => {
  it("only reads the repository metadata", async () => {
    const { fetchImpl, calls } = fetching(publicRepo);
    await expect(checkRepo("github.com/o/r", { fetchImpl })).resolves.toEqual({ owner: "o", repo: "r", description: "d" });
    expect(calls).toEqual(["https://api.github.com/repos/o/r"]);
  });

  it("reports a missing repository", async () => {
    await expect(checkRepo("github.com/o/r", fetching({}, 404))).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a private repository unless the user's own token allows it", async () => {
    await expect(checkRepo("github.com/o/r", { ...fetching(privateRepo), token: "server" })).rejects.toMatchObject({ code: "private" });
    await expect(checkRepo("github.com/o/r", { ...fetching(privateRepo), token: "user", allowPrivate: true })).resolves.toMatchObject({ repo: "r" });
  });

  it("does not call GitHub for an invalid URL", async () => {
    const { fetchImpl, calls } = fetching(publicRepo);
    await expect(checkRepo("https://gitlab.com/o/r", { fetchImpl })).rejects.toMatchObject({ code: "invalid_url" });
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/repo/check", () => {
  const post = (app: ReturnType<typeof createApp>, body: unknown) =>
    app.request("/api/repo/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("returns the repository when it can be read", async () => {
    const app = createApp({ checkRepo: async () => ({ owner: "o", repo: "r", description: null }) });
    const res = await post(app, { url: "github.com/o/r" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ owner: "o", repo: "r", description: null });
  });

  it.each([
    ["not_found", 404],
    ["private", 403],
    ["invalid_url", 400],
  ] as const)("maps %s to HTTP %i", async (code, status) => {
    const app = createApp({
      checkRepo: async () => {
        throw new RepoError(code, "message");
      },
    });
    const res = await post(app, { url: "x" });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code, message: "message" });
  });
});
