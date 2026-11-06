import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { RepoSnapshot } from "./github/snapshot.js";
import { RepoError } from "./github/url.js";
import type { LlmClient } from "./llm/client.js";
import { CATEGORIES, type GeneratedQuestion } from "./quiz/types.js";

const snap: RepoSnapshot = {
  owner: "o",
  repo: "r",
  branch: "main",
  description: null,
  files: [{ path: "src/a.ts", content: "line1\nline2\nline3" }],
  skipped: 0,
};

const q = (i: number, type: "choice" | "free"): GeneratedQuestion => ({
  type,
  category: CATEGORIES[i % 5],
  difficulty: 1,
  question: `Q${i}`,
  codeRef: { path: "src/a.ts", startLine: 2, endLine: 3 },
  choices: type === "choice" ? ["A", "B", "C", "D"] : [],
  answerIndex: type === "choice" ? 1 : 0,
  rubric: type === "free" ? "- 要点" : "",
  hint: "hint",
  explanation: "SECRET-EXPLANATION",
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

const app = () => createApp({ llm, fetchSnapshot: async () => snap });
const post = (a: ReturnType<typeof app>, path: string, body: unknown) =>
  a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/quiz", () => {
  it("creates a session and hides answers", async () => {
    const res = await post(app(), "/api/quiz", { url: "https://github.com/o/r" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("SECRET-EXPLANATION");
    expect(text).not.toContain("answerIndex");
    expect(text).not.toContain("rubric");
    const body = JSON.parse(text);
    expect(body.questions).toHaveLength(18);
    expect(body.questions[0].snippet).toBe("line2\nline3");
  });

  it("can be fetched again by session id", async () => {
    const a = app();
    const created = await (await post(a, "/api/quiz", { url: "x" })).json();
    const res = await a.request(`/api/quiz/${created.sessionId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).questions).toHaveLength(18);
    expect((await a.request("/api/quiz/unknown")).status).toBe(404);
  });

  it("maps repo errors to status codes", async () => {
    const a = createApp({
      llm,
      fetchSnapshot: async () => {
        throw new RepoError("invalid_url", "bad");
      },
    });
    const res = await post(a, "/api/quiz", { url: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_url");
  });
});
