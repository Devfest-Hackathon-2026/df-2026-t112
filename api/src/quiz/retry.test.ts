import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { RepoSnapshot } from "../github/snapshot.js";
import type { LlmClient, JsonRequest } from "../llm/client.js";
import { deserializeSession, serializeSession } from "../store/firestore.js";
import { MemorySessionStore, type Session } from "../store/session.js";
import { fakeQuizResponse } from "../testing/fake-llm.js";
import { findRepeated, generateQuiz } from "./generate.js";
import { PROFILES } from "./profile.js";
import { RETRY_MAX, RETRY_MIN, collectAsked, pickMissed, planRetry, renderMissed, type MissedQuestion } from "./retry.js";
import type { Category, GeneratedQuestion, Quiz } from "./types.js";

const missed = (category: Category): Pick<MissedQuestion, "category"> => ({ category });

describe("planRetry", () => {
  it("makes at least the minimum number of questions", () => {
    const spec = planRetry([missed("security")]);
    expect(spec.choice.length + spec.free.length).toBe(RETRY_MIN);
    expect([...spec.choice, ...spec.free].every((c) => c === "security")).toBe(true);
  });

  it("never exceeds the maximum, however many were missed", () => {
    const spec = planRetry(Array.from({ length: 12 }, () => missed("reading")));
    expect(spec.choice.length + spec.free.length).toBe(RETRY_MAX);
  });

  it("matches the number missed between the limits", () => {
    const spec = planRetry([missed("reading"), missed("design"), missed("quality"), missed("knowledge")]);
    expect(spec.choice.length + spec.free.length).toBe(4);
  });

  it("makes half written questions, starting with the most-missed area", () => {
    const spec = planRetry([missed("reading"), missed("design"), missed("design"), missed("design")]);
    expect(spec.free).toEqual(["design", "reading"]);
    expect(spec.choice).toEqual(["design", "design"]);
  });

  it("covers every missed area even when capped", () => {
    const many = [
      ...Array.from({ length: 3 }, () => missed("knowledge")),
      ...Array.from({ length: 3 }, () => missed("quality")),
      ...Array.from({ length: 2 }, () => missed("design")),
      missed("security"),
    ];
    const spec = planRetry(many);
    const categories = [...spec.free, ...spec.choice];
    expect(categories).toHaveLength(RETRY_MAX);
    expect(new Set(categories)).toEqual(new Set(["knowledge", "quality", "design", "security"]));
  });
});

describe("pickMissed", () => {
  it("takes one from each area before repeating, most-missed first", () => {
    const picked = pickMissed([missed("reading"), missed("design"), missed("design")]);
    expect(picked.map((m) => m.category)).toEqual(["design", "reading", "design"]);
  });

  it("never returns more than the maximum", () => {
    expect(pickMissed(Array.from({ length: 20 }, () => missed("reading")))).toHaveLength(RETRY_MAX);
  });
});

describe("renderMissed", () => {
  it("includes every missed area when there are too many to list", () => {
    const item = (category: Category, question: string): MissedQuestion => ({ category, question, correctAnswer: "a", userAnswer: "b", path: "a.ts", startLine: 1, endLine: 2 });
    const text = renderMissed([...Array.from({ length: 8 }, (_, i) => item("reading", `読解${i}`)), item("security", "安全性の問題")]);
    expect(text).toContain("安全性の問題");
  });

  it("clips long answers", () => {
    const text = renderMissed([
      { category: "reading", question: "q", correctAnswer: "a", userAnswer: "x".repeat(2000), path: "a.ts", startLine: 1, endLine: 2 },
    ]);
    expect(text).toContain("該当コード: a.ts L1-2");
    expect(text.length).toBeLessThan(800);
  });
});

describe("POST /api/quiz/:id/retry", () => {
  const snap: RepoSnapshot = {
    owner: "o",
    repo: "r",
    branch: "main",
    description: null,
    files: [{ path: "src/a.ts", content: "line1\nline2\nline3" }],
    skipped: 0,
  };

  function setup() {
    const store = new MemorySessionStore();
    const quizRequests: JsonRequest[] = [];
    const urls: string[] = [];
    let score = 0;
    const llm: LlmClient = {
      async generateJson(req) {
        if (req.system.includes("このリクエストで作る問題")) {
          quizRequests.push(req);
          return fakeQuizResponse(req.system);
        }
        return { grades: [...req.user.matchAll(/<item id="(q\d+)">/g)].map((m) => ({ id: m[1], score, feedback: "f" })), summary: "総評" };
      },
    };
    const app = createApp({
      accessPassword: "",
      llm,
      store,
      profile: PROFILES.standard,
      fetchSnapshot: async (url) => {
        urls.push(url);
        return snap;
      },
    });
    const post = (path: string, body: unknown = {}) =>
      app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    const create = async () => (await (await post("/api/quiz", { url: "https://github.com/o/r" })).json()) as { sessionId: string };
    const grade = async (id: string, allCorrect: boolean) => {
      score = allCorrect ? 1 : 0;
      const session = (await store.get(id))!;
      const answers = allCorrect
        ? Object.fromEntries(session.quiz.questions.map((q) => [q.id, q.type === "choice" ? { choice: q.answerIndex } : { text: "説明" }]))
        : {};
      await post(`/api/quiz/${id}/grade`, { answers });
    };
    return { post, create, grade, store, quizRequests, urls };
  }

  it("creates a shorter quiz based on the questions that were missed", async () => {
    const t = setup();
    const { sessionId } = await t.create();
    await t.grade(sessionId, false);
    const firstQuestion = (await t.store.get(sessionId))!.quiz.questions[0].question;

    const res = await t.post(`/api/quiz/${sessionId}/retry`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; questions: unknown[]; repo: { repo: string } };
    expect(body.questions).toHaveLength(RETRY_MAX);
    expect(body.sessionId).not.toBe(sessionId);
    expect(body.repo.repo).toBe("r");

    const request = t.quizRequests.at(-1)!;
    expect(request.user).toContain("<missed_questions>");
    expect(request.user).toContain(firstQuestion);
    expect(request.system).toContain("類似問題");
    expect(t.urls.at(-1)).toBe("https://github.com/o/r");
  });

  it("does not expose answers in the new quiz", async () => {
    const t = setup();
    const { sessionId } = await t.create();
    await t.grade(sessionId, false);
    const text = await (await t.post(`/api/quiz/${sessionId}/retry`)).text();
    expect(text).not.toContain("answerIndex");
    expect(text).not.toContain("rubric");
  });

  it("refuses before grading", async () => {
    const t = setup();
    const { sessionId } = await t.create();
    const res = await t.post(`/api/quiz/${sessionId}/retry`);
    expect(res.status).toBe(409);
    expect(t.quizRequests).toHaveLength(2);
  });

  it("makes new questions on the same repository when everything was correct", async () => {
    const t = setup();
    const { sessionId } = await t.create();
    await t.grade(sessionId, true);
    const asked = (await t.store.get(sessionId))!.quiz.questions.map((q) => q.question);

    const res = await t.post(`/api/quiz/${sessionId}/retry`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: { question: string }[] };
    expect(body.questions).toHaveLength(PROFILES.mini.choice + PROFILES.mini.free);
    expect(body.questions.some((q) => asked.includes(q.question))).toBe(false);

    const request = t.quizRequests.at(-1)!;
    expect(request.system).toContain("まだ解いていない問題");
    expect(request.system).not.toContain("類似問題");
    expect(request.user).not.toContain("<missed_questions>");
    for (const question of asked) expect(request.user).toContain(question);
  });

  it("remembers every question across a chain of quizzes", async () => {
    const t = setup();
    const first = await t.create();
    await t.grade(first.sessionId, true);
    const firstAsked = (await t.store.get(first.sessionId))!.quiz.questions[0].question;

    const second = (await (await t.post(`/api/quiz/${first.sessionId}/retry`)).json()) as { sessionId: string };
    await t.grade(second.sessionId, true);
    const secondAsked = (await t.store.get(second.sessionId))!.quiz.questions[0].question;

    await t.post(`/api/quiz/${second.sessionId}/retry`);
    const request = t.quizRequests.at(-1)!;
    expect(request.user).toContain(firstAsked);
    expect(request.user).toContain(secondAsked);
  });

  it("also avoids earlier questions when making similar ones", async () => {
    const t = setup();
    const { sessionId } = await t.create();
    await t.grade(sessionId, false);
    await t.post(`/api/quiz/${sessionId}/retry`);
    const request = t.quizRequests.at(-1)!;
    expect(request.user).toContain("<asked_questions>");
    expect(request.system).toContain("類似問題");
  });

  it("returns 404 for an unknown session", async () => {
    expect((await setup().post("/api/quiz/nope/retry")).status).toBe(404);
  });
});

describe("avoiding questions that were already asked", () => {
  const snap = { owner: "o", repo: "r", branch: "main", description: null, files: [{ path: "a.ts", content: "x" }], skipped: 0 } as RepoSnapshot;
  const asked = [{ question: "既に 出した問題", path: "a.ts", startLine: 1, endLine: 2 }];

  it("detects a repeat even if the spacing differs", () => {
    const q = { question: "既に出した 問題" } as GeneratedQuestion;
    expect(findRepeated([q], asked)).toContain("過去に出した問題");
    expect(findRepeated([{ question: "新しい問題" } as GeneratedQuestion], asked)).toBeNull();
  });

  it("asks the model again when it repeats a question", async () => {
    let calls = 0;
    const llm: LlmClient = {
      async generateJson(req) {
        const response = fakeQuizResponse(req.system);
        if (++calls === 1) response.questions[0].question = "既に出した問題";
        return response;
      },
    };
    const quiz = await generateQuiz(snap, llm, { profile: PROFILES.mini, asked });
    expect(calls).toBe(2);
    expect(quiz.questions.some((q) => q.question === "既に出した問題")).toBe(false);
  });

  it("fails rather than serving a repeated question", async () => {
    const llm: LlmClient = {
      async generateJson(req) {
        const response = fakeQuizResponse(req.system);
        response.questions[0].question = "既に出した問題";
        return response;
      },
    };
    await expect(generateQuiz(snap, llm, { profile: PROFILES.mini, asked })).rejects.toThrow("過去に出した問題");
  });

  it("keeps the most recent questions when the history is long", () => {
    const quiz = { questions: [{ question: "最新", codeRef: { path: "a.ts", startLine: 1, endLine: 2 } }] } as Quiz;
    const prior = Array.from({ length: 80 }, (_, i) => ({ question: `q${i}`, path: "a.ts", startLine: 1, endLine: 2 }));
    const all = collectAsked(prior, quiz);
    expect(all).toHaveLength(60);
    expect(all.at(-1)!.question).toBe("最新");
  });

  it("stores the history in Firestore documents", () => {
    const session = { id: "s", createdAt: 1, quiz: { repo: { owner: "o", repo: "r" }, questions: [] }, snippets: {}, asked } as unknown as Session;
    expect(deserializeSession("s", serializeSession(session)).asked).toEqual(asked);
    const without = { ...session, asked: undefined };
    expect(deserializeSession("s", serializeSession(without)).asked).toBeUndefined();
  });
});
