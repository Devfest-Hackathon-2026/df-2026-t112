import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Authenticator } from "./auth.js";
import type { RepoSnapshot } from "./github/snapshot.js";
import type { LlmClient } from "./llm/client.js";
import { CATEGORIES, type GeneratedQuestion } from "./quiz/types.js";

const snap: RepoSnapshot = {
  owner: "o",
  repo: "r",
  branch: "main",
  description: null,
  files: [{ path: "a.ts", content: "x" }],
  skipped: 0,
};

const q = (i: number, type: "choice" | "free"): GeneratedQuestion => ({
  type,
  category: CATEGORIES[i % 5],
  difficulty: 1,
  question: `Q${i}`,
  codeRef: { path: "a.ts", startLine: 1, endLine: 1 },
  choices: type === "choice" ? ["A", "B", "C", "D"] : [],
  answerIndex: 0,
  rubric: type === "free" ? "- r" : "",
  hint: "h",
  explanation: "e",
});

const llm: LlmClient = {
  async generateJson() {
    return {
      questions: [
        ...Array.from({ length: 15 }, (_, i) => q(i, "choice")),
        ...Array.from({ length: 3 }, (_, i) => q(i, "free")),
      ],
    };
  },
};

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
