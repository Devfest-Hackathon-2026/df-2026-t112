import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AuthUser, Authenticator } from "./auth.js";
import { parseAllowlist } from "./auth.js";
import { gradeQuiz } from "./grading/grade.js";
import type { RepoSnapshot } from "./github/snapshot.js";
import type { JsonRequest, LlmClient } from "./llm/client.js";
import { deserializeMistake, serializeMistake } from "./store/firestore.js";
import { MemoryMistakeStore, newMistake, type MistakeDraft } from "./store/mistakes.js";
import { MemorySessionStore } from "./store/session.js";
import { fakeQuizResponse } from "./testing/fake-llm.js";
import { PROFILES } from "./quiz/profile.js";
import type { Question, Quiz } from "./quiz/types.js";

const draft = (over: Partial<MistakeDraft> = {}): MistakeDraft => ({
  sessionId: "s1",
  repo: { owner: "o", name: "r" },
  type: "choice",
  category: "reading",
  question: "元の問題",
  reviewQuestion: "説明してください",
  rubric: "- 要点",
  explanation: "解説",
  codeRef: { path: "a.ts", startLine: 1, endLine: 2 },
  snippet: "const a = 1;",
  ...over,
});

describe("MemoryMistakeStore", () => {
  it("keeps each account's mistakes separate", async () => {
    const store = new MemoryMistakeStore();
    await store.add("alice", [draft()]);
    expect(await store.listOpen("alice", 10)).toHaveLength(1);
    expect(await store.listOpen("bob", 10)).toHaveLength(0);
  });

  it("lists the most recent first", async () => {
    let t = 1;
    const store = new MemoryMistakeStore(() => t);
    await store.add("u", [draft({ question: "古い" })]);
    t = 2;
    await store.add("u", [draft({ question: "新しい" })]);
    expect((await store.listOpen("u", 10)).map((m) => m.question)).toEqual(["新しい", "古い"]);
  });

  it("resolves on a correct answer and removes it from the open list", async () => {
    const store = new MemoryMistakeStore(() => 5);
    await store.add("u", [draft()]);
    const [m] = await store.listOpen("u", 10);
    await store.recordAnswer("u", m.id, true);
    expect(await store.listOpen("u", 10)).toHaveLength(0);
    expect(await store.get("u", m.id)).toMatchObject({ status: "resolved", resolvedAt: 5, wrongCount: 1 });
  });

  it("lists resolved questions most recent first, for that account only", async () => {
    let t = 1;
    const store = new MemoryMistakeStore(() => t);
    await store.add("u", [draft({ question: "先" }), draft({ question: "後" })]);
    const [a, b] = await store.listOpen("u", 10);
    t = 2;
    await store.recordAnswer("u", a.id, true);
    t = 3;
    await store.recordAnswer("u", b.id, true);
    expect((await store.listResolved("u", 10)).map((m) => m.id)).toEqual([b.id, a.id]);
    expect(await store.listResolved("v", 10)).toHaveLength(0);
  });

  it("counts another miss on a wrong answer and keeps it open", async () => {
    const store = new MemoryMistakeStore();
    await store.add("u", [draft()]);
    const [m] = await store.listOpen("u", 10);
    await store.recordAnswer("u", m.id, false);
    expect(await store.get("u", m.id)).toMatchObject({ status: "open", wrongCount: 2, resolvedAt: null });
  });
});

describe("Firestore documents", () => {
  it("round-trips a mistake", () => {
    const m = newMistake(draft(), 1_700_000_000_000);
    expect(deserializeMistake(m.id, serializeMistake(m))).toEqual(m);
  });

  it("round-trips the resolved time", () => {
    const m = { ...newMistake(draft(), 1000), status: "resolved" as const, resolvedAt: 2000 };
    expect(deserializeMistake(m.id, serializeMistake(m)).resolvedAt).toBe(2000);
  });
});

const choiceQuestion = (id: string, answerIndex = 1): Question => ({
  id,
  type: "choice",
  category: "reading",
  difficulty: 1,
  question: `${id} はどれですか`,
  codeRef: { path: "a.ts", startLine: 1, endLine: 2 },
  choices: ["A", "B", "C", "D"],
  answerIndex,
  rubric: "",
  hint: "h",
  explanation: `${id} の解説`,
});
const freeQuestion = (id: string): Question => ({ ...choiceQuestion(id), type: "free", choices: [], answerIndex: 0, rubric: `- ${id} の要点`, question: `${id} を説明` });
const quiz = (questions: Question[]): Quiz => ({ repo: { owner: "o", repo: "r", branch: "main", description: null }, questions });

describe("gradeQuiz prepares mistakes for review", () => {
  const llmReturning = (response: object) => {
    const requests: JsonRequest[] = [];
    const llm: LlmClient = {
      async generateJson(req) {
        requests.push(req);
        return response;
      },
    };
    return { llm, requests };
  };

  it("rewrites a wrong choice question as a written one in the same Gemini call", async () => {
    const { llm, requests } = llmReturning({
      grades: [],
      reviewItems: [{ id: "q1", reviewQuestion: "自分の言葉で説明してください", rubric: "- 正しい要点" }],
      summary: "総評",
    });
    const graded = await gradeQuiz(quiz([choiceQuestion("q1")]), { q1: "const code = 1;" }, { q1: { choice: 0 } }, llm);
    expect(requests).toHaveLength(1);
    expect(requests[0].user).toContain('<wrong_choice id="q1">');
    expect(requests[0].user).toContain("const code = 1;");
    expect(graded.mistakes).toHaveLength(1);
    expect(graded.mistakes[0]).toMatchObject({ type: "choice", reviewQuestion: "自分の言葉で説明してください", rubric: "- 正しい要点", snippet: "const code = 1;" });
  });

  it("does not include questions answered correctly", async () => {
    const { llm, requests } = llmReturning({ grades: [], reviewItems: [], summary: "総評" });
    const graded = await gradeQuiz(quiz([choiceQuestion("q1")]), {}, { q1: { choice: 1 } }, llm);
    expect(graded.mistakes).toHaveLength(0);
    expect(requests[0].user).not.toContain("<wrong_choice");
  });

  it("keeps a wrong written question as it is", async () => {
    const { llm } = llmReturning({ grades: [{ id: "q1", score: 0.2, feedback: "f" }], reviewItems: [], summary: "総評" });
    const graded = await gradeQuiz(quiz([freeQuestion("q1")]), { q1: "x" }, { q1: { text: "回答" } }, llm);
    expect(graded.mistakes[0]).toMatchObject({ type: "free", reviewQuestion: "q1 を説明", rubric: "- q1 の要点" });
  });

  it("does not count a written answer of 0.7 or more as a mistake", async () => {
    const { llm } = llmReturning({ grades: [{ id: "q1", score: 0.7, feedback: "f" }], reviewItems: [], summary: "総評" });
    expect((await gradeQuiz(quiz([freeQuestion("q1")]), {}, { q1: { text: "回答" } }, llm)).mistakes).toHaveLength(0);
  });

  it("falls back to the original question when the model omits the rewrite", async () => {
    const { llm } = llmReturning({ grades: [], summary: "総評" });
    const graded = await gradeQuiz(quiz([choiceQuestion("q1")]), {}, {}, llm);
    expect(graded.mistakes[0].reviewQuestion).toContain("q1 はどれですか");
    expect(graded.mistakes[0].reviewQuestion).toContain("自分の言葉で");
    expect(graded.mistakes[0].rubric).toContain("q1 の解説");
    expect(graded.mistakes[0].rubric).toContain("B");
  });

  it("still returns the result when the rewrites are malformed", async () => {
    const { llm } = llmReturning({ grades: [], reviewItems: "oops", summary: "総評" });
    const graded = await gradeQuiz(quiz([choiceQuestion("q1")]), {}, {}, llm);
    expect(graded.summary).toBe("総評");
    expect(graded.mistakes).toHaveLength(1);
  });
});

describe("mistakes API", () => {
  const snap: RepoSnapshot = { owner: "o", repo: "r", branch: "main", description: null, files: [{ path: "src/a.ts", content: "line1\nline2\nline3" }], skipped: 0 };

  function setup(score = 0.8, opts: { failSave?: boolean } = {}) {
    const store = new MemorySessionStore();
    const mistakes = new MemoryMistakeStore();
    if (opts.failSave) mistakes.add = async () => { throw new Error("firestore down"); };
    const reviews: JsonRequest[] = [];
    const llm: LlmClient = {
      async generateJson(req) {
        if (req.system.includes("このリクエストで作る問題")) return fakeQuizResponse(req.system);
        if (req.system.includes("間違えた問題の復習")) {
          reviews.push(req);
          return { score, feedback: "フィードバック" };
        }
        return {
          grades: [...req.user.matchAll(/<item id="(q\d+)">/g)].map((m) => ({ id: m[1], score: 0, feedback: "f" })),
          reviewItems: [...req.user.matchAll(/<wrong_choice id="(q\d+)">/g)].map((m) => ({ id: m[1], reviewQuestion: `${m[1]} を説明`, rubric: "- 秘密の要点" })),
          summary: "総評",
        };
      },
    };
    const auth: Authenticator = {
      async verify(token): Promise<AuthUser | null> {
        return token === "alice" ? { uid: "alice", githubId: "1" } : token === "bob" ? { uid: "bob", githubId: "2" } : null;
      },
    };
    const app = createApp({ auth, allowed: parseAllowlist("1 2"), llm, store, mistakes, profile: PROFILES.mini, fetchSnapshot: async () => snap });
    const call = (path: string, who: string, body?: unknown) =>
      app.request(path, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${who}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const missEverything = async (who: string) => {
      const { sessionId } = (await (await call("/api/quiz", who, { url: "https://github.com/o/r" })).json()) as { sessionId: string };
      return call(`/api/quiz/${sessionId}/grade`, who, { answers: {} });
    };
    const list = async (who: string) => ((await (await call("/api/mistakes", who)).json()) as { open: { id: string; reviewQuestion: string }[] }).open;
    return { call, missEverything, list, mistakes, reviews };
  }

  it("saves mistakes when a quiz is graded, without exposing them in the result", async () => {
    const t = setup();
    const res = await t.missEverything("alice");
    expect(await res.text()).not.toContain("mistakes");
    expect(await t.list("alice")).toHaveLength(6);
  });

  it("does not show one person's mistakes to another", async () => {
    const t = setup();
    await t.missEverything("alice");
    expect(await t.list("bob")).toHaveLength(0);
    const [m] = await t.list("alice");
    expect((await t.call(`/api/mistakes/${m.id}/answer`, "bob", { text: "回答" })).status).toBe(404);
  });

  it("requires login", async () => {
    expect((await setup().call("/api/mistakes", "nobody")).status).toBe(401);
  });

  it("does not reveal the rubric or explanation before answering", async () => {
    const t = setup();
    await t.missEverything("alice");
    const text = await (await t.call("/api/mistakes", "alice")).text();
    expect(text).not.toContain("秘密の要点");
    expect(text).not.toContain("rubric");
    expect(text).not.toContain("explanation");
  });

  it("resolves at 0.7 and shows the answer after grading", async () => {
    const t = setup(0.7);
    await t.missEverything("alice");
    const before = await t.list("alice");
    const res = await t.call(`/api/mistakes/${before[0].id}/answer`, "alice", { text: "自分の説明" });
    const body = (await res.json()) as { correct: boolean; rubric: string; feedback: string };
    expect(body.correct).toBe(true);
    expect(body.rubric).toBeTruthy();
    expect(body.feedback).toBe("フィードバック");
    expect(await t.list("alice")).toHaveLength(before.length - 1);
    expect(t.reviews[0].deadline).toBeGreaterThan(Date.now());
    expect(t.reviews[0].user).toContain("<answer>\n自分の説明\n</answer>");
  });

  it("keeps it open below 0.7 and counts the miss", async () => {
    const t = setup(0.69);
    await t.missEverything("alice");
    const before = await t.list("alice");
    const body = (await (await t.call(`/api/mistakes/${before[0].id}/answer`, "alice", { text: "説明" })).json()) as { correct: boolean };
    expect(body.correct).toBe(false);
    expect(await t.list("alice")).toHaveLength(before.length);
    expect((await t.mistakes.get("alice", before[0].id))?.wrongCount).toBe(2);
  });

  it("rejects an empty answer without calling Gemini", async () => {
    const t = setup();
    await t.missEverything("alice");
    const [m] = await t.list("alice");
    expect((await t.call(`/api/mistakes/${m.id}/answer`, "alice", { text: "   " })).status).toBe(400);
    expect(t.reviews).toHaveLength(0);
  });

  it("keeps a resolved question in a separate list with its answer", async () => {
    const t = setup(0.9);
    await t.missEverything("alice");
    const before = await t.list("alice");
    await t.call(`/api/mistakes/${before[0].id}/answer`, "alice", { text: "説明" });
    const folder = (await (await t.call("/api/mistakes", "alice")).json()) as { open: { id: string }[]; resolved: { id: string; rubric: string; explanation: string; resolvedAt: number }[] };
    expect(folder.open.map((m) => m.id)).not.toContain(before[0].id);
    expect(folder.resolved.map((m) => m.id)).toEqual([before[0].id]);
    expect(folder.resolved[0].rubric).toBeTruthy();
    expect(folder.resolved[0].explanation).toBeTruthy();
    expect(folder.resolved[0].resolvedAt).toBeGreaterThan(0);
  });

  it("does not show one person's resolved questions to another", async () => {
    const t = setup(0.9);
    await t.missEverything("alice");
    const [m] = await t.list("alice");
    await t.call(`/api/mistakes/${m.id}/answer`, "alice", { text: "説明" });
    const folder = (await (await t.call("/api/mistakes", "bob")).json()) as { resolved: unknown[] };
    expect(folder.resolved).toHaveLength(0);
  });

  it("keeps a resolved question resolved when it is answered correctly again", async () => {
    const t = setup(0.9);
    await t.missEverything("alice");
    const [m] = await t.list("alice");
    await t.mistakes.recordAnswer("alice", m.id, true);
    const res = await t.call(`/api/mistakes/${m.id}/answer`, "alice", { text: "説明" });
    expect(res.status).toBe(200);
    expect(await t.mistakes.get("alice", m.id)).toMatchObject({ status: "resolved", wrongCount: 1 });
  });

  it("moves a resolved question back to open when it is answered wrongly", async () => {
    const t = setup(0.3);
    await t.missEverything("alice");
    const [m] = await t.list("alice");
    await t.mistakes.recordAnswer("alice", m.id, true);
    const res = await t.call(`/api/mistakes/${m.id}/answer`, "alice", { text: "説明" });
    expect(((await res.json()) as { correct: boolean }).correct).toBe(false);
    expect(await t.mistakes.get("alice", m.id)).toMatchObject({ status: "open", resolvedAt: null, wrongCount: 2 });
    expect((await t.list("alice")).map((x) => x.id)).toContain(m.id);
  });

  it("does not let someone else answer a resolved question", async () => {
    const t = setup(0.9);
    await t.missEverything("alice");
    const [m] = await t.list("alice");
    await t.mistakes.recordAnswer("alice", m.id, true);
    expect((await t.call(`/api/mistakes/${m.id}/answer`, "bob", { text: "説明" })).status).toBe(404);
  });

  it("still returns the grade when saving mistakes fails", async () => {
    const t = setup(0.8, { failSave: true });
    const original = console.error;
    console.error = () => {};
    try {
      expect((await t.missEverything("alice")).status).toBe(200);
    } finally {
      console.error = original;
    }
  });
});
