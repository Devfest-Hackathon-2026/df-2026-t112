import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Authenticator } from "./auth.js";
import type { RepoSnapshot } from "./github/snapshot.js";
import { fakeLlm } from "./testing/fake-llm.js";

const snap: RepoSnapshot = {
  owner: "o",
  repo: "r",
  branch: "main",
  description: null,
  files: [{ path: "a.ts", content: "x" }],
  skipped: 0,
};

const llm = fakeLlm();

/** "token-alice" → uid alice。それ以外は検証失敗。 */
const auth: Authenticator = {
  async verify(token) {
    const m = token.match(/^token-(\w+)$/);
    return m ? { uid: m[1] } : null;
  },
};

function setup() {
  const seen: (string | undefined)[] = [];
  const app = createApp({
    llm,
    auth,
    fetchSnapshot: async (_url, userToken) => {
      seen.push(userToken);
      return snap;
    },
  });
  const post = (path: string, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ url: "https://github.com/o/r", answers: {} }),
    });
  return { app, post, seen };
}

describe("GitHub token forwarding", () => {
  it("passes the user's GitHub token only when the Firebase token verifies", async () => {
    const { post, seen } = setup();
    await post("/api/quiz", { authorization: "Bearer token-alice", "x-github-token": "gho_user" });
    await post("/api/quiz", { authorization: "Bearer forged", "x-github-token": "gho_stolen" });
    await post("/api/quiz", { "x-github-token": "gho_anon" });
    expect(seen).toEqual(["gho_user", undefined, undefined]);
  });

  it("ignores the GitHub token header when auth is not configured", async () => {
    const seen: (string | undefined)[] = [];
    const app = createApp({
      llm,
      fetchSnapshot: async (_u, t) => {
        seen.push(t);
        return snap;
      },
    });
    await app.request("/api/quiz", {
      method: "POST",
      headers: { authorization: "Bearer token-alice", "x-github-token": "gho_x" },
      body: JSON.stringify({ url: "u" }),
    });
    expect(seen).toEqual([undefined]);
  });
});

describe("GET /api/weakness", () => {
  it("requires login and aggregates only the caller's graded sessions", async () => {
    const gradingLlm = fakeLlm(async (req) => (req.user.includes("<item") ? { grades: [] } : { summary: "s" }));
    const app = createApp({ llm: gradingLlm, auth, fetchSnapshot: async () => snap });
    const call = (path: string, user?: string, body?: unknown) =>
      app.request(path, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer token-${user}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });

    expect((await call("/api/weakness")).status).toBe(401);

    const created = await (await call("/api/quiz", "alice", { url: "u" })).json();
    await call(`/api/quiz/${created.sessionId}/grade`, "alice", { answers: {} });

    const alice = await (await call("/api/weakness", "alice")).json();
    expect(alice.sessions).toBe(1);
    expect(alice.weakest.length).toBeGreaterThan(0);
    expect((await (await call("/api/weakness", "bob")).json()).sessions).toBe(0);
  });
});

describe("session ownership", () => {
  it("hides a signed-in user's session from others, including grading", async () => {
    const { app, post } = setup();
    const created = await (await post("/api/quiz", { authorization: "Bearer token-alice" })).json();
    const id = created.sessionId;

    const own = await app.request(`/api/quiz/${id}`, { headers: { authorization: "Bearer token-alice" } });
    expect(own.status).toBe(200);

    expect((await app.request(`/api/quiz/${id}`, { headers: { authorization: "Bearer token-bob" } })).status).toBe(404);
    expect((await app.request(`/api/quiz/${id}`)).status).toBe(404);
    expect((await post(`/api/quiz/${id}/grade`, { authorization: "Bearer token-bob" })).status).toBe(404);
  });

  it("keeps anonymous sessions open to anyone holding the id", async () => {
    const { app, post } = setup();
    const created = await (await post("/api/quiz")).json();
    expect((await app.request(`/api/quiz/${created.sessionId}`, { headers: { authorization: "Bearer token-bob" } })).status).toBe(200);
  });
});
