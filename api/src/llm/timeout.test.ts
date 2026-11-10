import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../app.js";
import { gradeQuiz } from "../grading/grade.js";
import type { RepoSnapshot } from "../github/snapshot.js";
import { generateQuiz, generateSimilarQuiz } from "../quiz/generate.js";
import { PROFILES } from "../quiz/profile.js";
import type { Quiz } from "../quiz/types.js";
import { MemorySessionStore } from "../store/session.js";
import { fakeQuizResponse } from "../testing/fake-llm.js";
import {
  LlmError,
  LlmTimeoutError,
  REQUEST_BUDGET_MS,
  createGeminiClient,
  errorReason,
  isTimeoutError,
  shouldFallBack,
  type JsonRequest,
  type LlmClient,
} from "./client.js";

type Params = { model: string; config: Record<string, unknown> };

/** 指定した順に結果を返す偽の呼び出し。Error なら投げる。 */
function client(steps: ((p: Params) => { text: string } | Error)[], now: () => number = () => 1000, fallbackModels = ["fallback"]) {
  const calls: Params[] = [];
  const llm = createGeminiClient({
    apiKey: "k",
    model: "primary",
    fallbackModels,
    now,
    call: async (p) => {
      calls.push(p as unknown as Params);
      const result = steps[calls.length - 1](p as unknown as Params);
      if (result instanceof Error) throw result;
      return result;
    },
  });
  return { llm, calls };
}

const ok = () => ({ text: "{}" });
const httpError = (status: number, message = "failed") => Object.assign(new Error(message), { status });
const timeoutOf = (p: Params) => (p.config.httpOptions as { timeout: number }).timeout;
const request = (deadline?: number): JsonRequest => ({ system: "s", user: "u", schema: z.object({}), deadline });

afterEach(() => vi.restoreAllMocks());

describe("isTimeoutError", () => {
  it.each([
    [{ status: 504 }],
    [{ name: "AbortError" }],
    [{ name: "TimeoutError" }],
    [new Error("Request timed out")],
  ])("treats %j as a timeout", (e) => {
    expect(isTimeoutError(e)).toBe(true);
    expect(shouldFallBack(e)).toBe(true);
  });

  it("does not treat other failures as timeouts", () => {
    expect(isTimeoutError({ status: 400 })).toBe(false);
    expect(shouldFallBack({ status: 400 })).toBe(false);
  });
});

describe("errorReason", () => {
  it("shortens the message and hides API keys", () => {
    const reason = errorReason(new Error(`quota exceeded\n url?key=SECRET&x=1 ${"a".repeat(1000)}`));
    expect(reason).toContain("quota exceeded url?key=***&x=1");
    expect(reason).not.toContain("SECRET");
    expect(reason.length).toBeLessThanOrEqual(300);
  });
});

describe("per-call timeout", () => {
  it("is capped when there is plenty of time", async () => {
    const { llm, calls } = client([ok]);
    await llm.generateJson(request(1000 + REQUEST_BUDGET_MS));
    expect(timeoutOf(calls[0])).toBe(30_000);
  });

  it("uses the remaining time when it is shorter", async () => {
    const { llm, calls } = client([ok]);
    await llm.generateJson(request(1000 + 8_000));
    expect(timeoutOf(calls[0])).toBe(8_000);
  });

  it("keeps the cap without a deadline", async () => {
    const { llm, calls } = client([ok]);
    await llm.generateJson(request());
    expect(timeoutOf(calls[0])).toBe(30_000);
  });

  it("does not call Gemini when the time is already up", async () => {
    const { llm, calls } = client([ok]);
    await expect(llm.generateJson(request(1000 + 500))).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(calls).toHaveLength(0);
  });
});

describe("falling back when a model hangs", () => {
  it("switches on a 504", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { llm, calls } = client([() => httpError(504), ok]);
    await llm.generateJson(request(1000 + REQUEST_BUDGET_MS));
    expect(calls.map((c) => c.model)).toEqual(["primary", "fallback"]);
  });

  it("switches on a client timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { llm, calls } = client([() => Object.assign(new Error("x"), { name: "AbortError" }), ok]);
    await llm.generateJson(request(1000 + REQUEST_BUDGET_MS));
    expect(calls.map((c) => c.model)).toEqual(["primary", "fallback"]);
  });

  it("gives the fallback only the time that is left", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let t = 1000;
    const { llm, calls } = client(
      [
        () => {
          t += 30_000;
          return httpError(504);
        },
        ok,
      ],
      () => t,
    );
    await llm.generateJson(request(1000 + REQUEST_BUDGET_MS));
    expect(timeoutOf(calls[1])).toBe(REQUEST_BUDGET_MS - 30_000);
  });

  it("does not try the fallback when no time is left", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    let t = 1000;
    const { llm, calls } = client(
      [
        () => {
          t += REQUEST_BUDGET_MS;
          return httpError(504);
        },
        ok,
      ],
      () => t,
    );
    await expect(llm.generateJson(request(1000 + REQUEST_BUDGET_MS))).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(calls).toHaveLength(1);
  });

  it("reports a timeout when every model hangs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { llm } = client([() => httpError(504), () => httpError(504)]);
    await expect(llm.generateJson(request(1000 + REQUEST_BUDGET_MS))).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it("avoids a hung model for a short while, then tries it again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let t = 1000;
    const { llm, calls } = client([() => httpError(504), ok, ok, ok], () => t);
    await llm.generateJson(request());
    await llm.generateJson(request());
    expect(calls.map((c) => c.model)).toEqual(["primary", "fallback", "fallback"]);
    t += 31_000;
    await llm.generateJson(request());
    expect(calls[3].model).toBe("primary");
  });

  it("keeps other failures as ordinary errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { llm } = client([() => httpError(400)]);
    const error = await llm.generateJson(request()).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).not.toBeInstanceOf(LlmTimeoutError);
  });
});

describe("logging the reason", () => {
  it("writes why a model was unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { llm } = client([() => httpError(429, "Quota exceeded for free tier"), ok]);
    await llm.generateJson(request());
    expect(warn.mock.calls.flat().join("\n")).toContain("HTTP 429");
    expect(warn.mock.calls.flat().join("\n")).toContain("Quota exceeded for free tier");
  });
});

describe("the deadline reaches every Gemini call", () => {
  const snap: RepoSnapshot = {
    owner: "o",
    repo: "r",
    branch: "main",
    description: null,
    files: [{ path: "a.ts", content: "const a = 1;" }],
    skipped: 0,
  };
  const recording = () => {
    const requests: JsonRequest[] = [];
    const llm: LlmClient = {
      async generateJson(req) {
        requests.push(req);
        return req.system.includes("このリクエストで作る問題") ? fakeQuizResponse(req.system) : { grades: [], summary: "総評" };
      },
    };
    return { llm, requests };
  };

  it("for a new quiz", async () => {
    const { llm, requests } = recording();
    await generateQuiz(snap, llm, { profile: PROFILES.standard, deadline: 123 });
    expect(requests.map((r) => r.deadline)).toEqual([123, 123]);
  });

  it("for similar questions", async () => {
    const { llm, requests } = recording();
    await generateSimilarQuiz(
      snap,
      llm,
      [{ category: "reading", question: "q", correctAnswer: "a", userAnswer: "b", path: "a.ts", startLine: 1, endLine: 1 }],
      { deadline: 456 },
    );
    expect(requests[0].deadline).toBe(456);
  });

  it("for grading", async () => {
    const { llm, requests } = recording();
    const quiz = { repo: { owner: "o", repo: "r", branch: "main", description: null }, questions: [] } as Quiz;
    await gradeQuiz(quiz, {}, {}, llm, 789);
    expect(requests[0].deadline).toBe(789);
  });
});

describe("API response when Gemini is too slow", () => {
  const snap: RepoSnapshot = { owner: "o", repo: "r", branch: "main", description: null, files: [{ path: "a.ts", content: "x" }], skipped: 0 };
  const slow: LlmClient = {
    async generateJson() {
      throw new LlmTimeoutError();
    },
  };

  it("returns JSON that the screen can show, not a 502 page", async () => {
    const app = createApp({ accessPassword: "", llm: slow, store: new MemorySessionStore(), fetchSnapshot: async () => snap });
    const res = await app.request("/api/quiz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "o/r" }) });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("llm_timeout");
    expect(body.message).toContain("時間がかかっています");
  });

  it("gives the request a deadline within the hosting limit", async () => {
    let deadline = 0;
    const llm: LlmClient = {
      async generateJson(req) {
        deadline = req.deadline ?? 0;
        return fakeQuizResponse(req.system);
      },
    };
    const before = Date.now();
    const app = createApp({ accessPassword: "", llm, store: new MemorySessionStore(), fetchSnapshot: async () => snap });
    await app.request("/api/quiz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "o/r" }) });
    expect(deadline).toBeGreaterThanOrEqual(before + REQUEST_BUDGET_MS);
    expect(deadline - before).toBeLessThan(60_000);
  });
});
