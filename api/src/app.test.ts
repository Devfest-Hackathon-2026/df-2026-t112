import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { RepoSnapshot } from "./github/snapshot.js";
import { RepoError } from "./github/url.js";
import { PROFILES } from "./quiz/profile.js";
import { fakeLlm } from "./testing/fake-llm.js";

const snap: RepoSnapshot = {
  owner: "o",
  repo: "r",
  branch: "main",
  description: null,
  files: [{ path: "src/a.ts", content: "line1\nline2\nline3" }],
  skipped: 0,
};

const llm = fakeLlm();

const app = () => createApp({ llm, profile: PROFILES.full, fetchSnapshot: async () => snap });
const post = (a: ReturnType<typeof app>, path: string, body: unknown) =>
  a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/quiz", () => {
  it("creates a session and hides answers", async () => {
    const res = await post(app(), "/api/quiz", { url: "https://github.com/o/r" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('"explanation"');
    expect(text).not.toContain("answerIndex");
    expect(text).not.toContain("rubric");
    const body = JSON.parse(text);
    expect(body.questions).toHaveLength(18);
    expect(body.questions[0].snippet).toBe("line1\nline2");
  });

  it("can be fetched again by session id", async () => {
    const a = app();
    const created = await (await post(a, "/api/quiz", { url: "x" })).json();
    const res = await a.request(`/api/quiz/${created.sessionId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).questions).toHaveLength(18);
    expect((await a.request("/api/quiz/unknown")).status).toBe(404);
  });

  it("grades answers once and caches the result", async () => {
    let calls = 0;
    const gradingLlm = fakeLlm(async (req) => {
      calls++;
      if (req.user.includes("<item")) {
        return { grades: [0, 1, 2].map((i) => ({ id: `q${16 + i}`, score: 1, feedback: "ok" })) };
      }
      return { summary: "総評" };
    });
    const a = createApp({ llm: gradingLlm, profile: PROFILES.full, fetchSnapshot: async () => snap });
    const created = await (await post(a, "/api/quiz", { url: "x" })).json();
    expect(created.questions).toHaveLength(18);

    const first = await post(a, `/api/quiz/${created.sessionId}/grade`, { answers: { q1: { choice: 0 } } });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.questions).toHaveLength(18);
    expect(body.summary).toBe("総評");

    const before = calls;
    const second = await post(a, `/api/quiz/${created.sessionId}/grade`, { answers: {} });
    expect(await second.json()).toEqual(body);
    expect(calls).toBe(before);
    expect((await post(a, "/api/quiz/nope/grade", { answers: {} })).status).toBe(404);
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
