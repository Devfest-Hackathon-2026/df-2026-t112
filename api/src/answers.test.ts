import type { Firestore } from "firebase-admin/firestore";
import { FieldPath } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { createApp, mergeAnswers } from "./app.js";
import { parseAllowlist, type Authenticator } from "./auth.js";
import type { RepoSnapshot } from "./github/snapshot.js";
import { PROFILES } from "./quiz/profile.js";
import { FirestoreSessionStore, deserializeSession, serializeSession } from "./store/firestore.js";
import type { Session } from "./store/session.js";
import { fakeLlm } from "./testing/fake-llm.js";

// 回答途中の状態をサーバーに保存する(#32、#34 の D21)

const snap: RepoSnapshot = {
  owner: "o",
  repo: "r",
  branch: "main",
  description: null,
  files: [{ path: "src/a.ts", content: "line1\nline2\nline3" }],
  skipped: 0,
};

/** "token-alice" → alice。知らない名前は検証失敗。 */
const auth: Authenticator = {
  async verify(token) {
    const name = token.match(/^token-(\w+)$/)?.[1];
    return name === "alice" || name === "bob" ? { uid: name, githubId: name === "alice" ? "1" : "2" } : null;
  },
};

type PublicQuestion = { id: string; type: "choice" | "free"; choices: string[] };

async function setup() {
  // tiny は選択式 3 問、記述式 1 問
  const app = createApp({ llm: fakeLlm(), auth, allowed: parseAllowlist("*"), profile: PROFILES.tiny, fetchSnapshot: async () => snap });
  const call = (method: string, path: string, user: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer token-${user}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const created = (await (await call("POST", "/api/quiz", "alice", { url: "https://github.com/o/r" })).json()) as {
    sessionId: string;
    questions: PublicQuestion[];
  };
  const choice = created.questions.filter((q) => q.type === "choice");
  const free = created.questions.find((q) => q.type === "free")!;
  const id = created.sessionId;
  const save = (questionId: string, answer: unknown, user = "alice") => call("PUT", `/api/quiz/${id}/answers/${questionId}`, user, answer);
  const load = async (user = "alice") => (await call("GET", `/api/quiz/${id}`, user)).json();
  return { call, id, choice, free, save, load };
}

describe("PUT /api/quiz/:id/answers/:questionId", () => {
  it("saves one answer at a time, so answers given in two tabs are both kept", async () => {
    const { choice, free, save, load } = await setup();
    // タブ A が 1 問目、タブ B が記述式に答える
    expect((await save(choice[0].id, { choice: 2 })).status).toBe(204);
    expect((await save(free.id, { text: "入力を確かめるため" })).status).toBe(204);
    // タブ A が 1 問目を選び直しても、記述式の回答は消えない
    await save(choice[0].id, { choice: 1 });

    const quiz = await load();
    expect(quiz.answers).toEqual({ [choice[0].id]: { choice: 1 }, [free.id]: { text: "入力を確かめるため" } });
    expect(quiz.result).toBeNull();
  });

  it("only lets the owner save", async () => {
    const { choice, save, load } = await setup();
    expect((await save(choice[0].id, { choice: 1 }, "bob")).status).toBe(404);
    expect((await load()).answers).toEqual({});
  });

  it("rejects answers that do not fit the question", async () => {
    const { choice, free, save } = await setup();
    expect((await save(choice[0].id, { choice: 4 })).status).toBe(400);
    expect((await save(choice[0].id, { choice: 1.5 })).status).toBe(400);
    expect((await save(choice[0].id, { text: "選択式に文章" })).status).toBe(400);
    expect((await save(free.id, { choice: 0 })).status).toBe(400);
    expect((await save(free.id, "文字列だけ")).status).toBe(400);
    expect((await save("q999", { choice: 0 })).status).toBe(404);
  });

  it("keeps free-text answers within the grading limit", async () => {
    const { free, save, load } = await setup();
    await save(free.id, { text: "あ".repeat(3000) });
    expect((await load()).answers[free.id].text).toHaveLength(2000);
  });

  it("refuses to change answers after grading, and returns the result instead", async () => {
    const { call, id, choice, save, load } = await setup();
    await call("POST", `/api/quiz/${id}/grade`, "alice", { answers: {} });

    const res = await save(choice[0].id, { choice: 1 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_graded");
    expect((await load()).result).toMatchObject({ summary: "総評です" });
  });
});

describe("grading with saved answers", () => {
  it("grades the answers saved from another tab even if the submitting tab did not have them", async () => {
    const { call, id, choice, save } = await setup();
    // fakeQuestion の正解は "B"。選択肢は出題のときに並べ替えられるので、位置は問題ごとに探す
    const right = (q: PublicQuestion) => q.choices.indexOf("B");
    const wrong = (q: PublicQuestion) => q.choices.indexOf("A");
    await save(choice[0].id, { choice: right(choice[0]) });
    await save(choice[1].id, { choice: right(choice[1]) });

    // 古い画面のタブは 2 問目を選び直し、1 問目は知らないまま提出する
    const res = await call("POST", `/api/quiz/${id}/grade`, "alice", { answers: { [choice[1].id]: { choice: wrong(choice[1]) } } });
    const result = (await res.json()) as { questions: { id: string; correct: boolean }[] };
    const byId = Object.fromEntries(result.questions.map((q) => [q.id, q.correct]));
    expect(byId[choice[0].id]).toBe(true);
    expect(byId[choice[1].id]).toBe(false);
  });
});

describe("mergeAnswers", () => {
  it("prefers the submitted answer, keeps the saved ones it does not mention", () => {
    expect(mergeAnswers({ q1: { choice: 0 }, q2: { text: "保存" } }, { q1: { choice: 2 } })).toEqual({
      q1: { choice: 2 },
      q2: { text: "保存" },
    });
  });

  it("does not let an empty submitted answer erase a saved one", () => {
    expect(mergeAnswers({ q1: { text: "保存" } }, { q1: { text: "  " }, q2: {} })).toEqual({ q1: { text: "保存" } });
    expect(mergeAnswers(undefined, { q1: { choice: 1 } })).toEqual({ q1: { choice: 1 } });
  });
});

describe("Firestore session store", () => {
  const base: Session = {
    id: "s1",
    createdAt: 1000,
    quiz: { repo: { owner: "o", repo: "r", branch: "main", description: null }, questions: [] },
    snippets: {},
  };

  it("round-trips saved answers", () => {
    const withAnswers = { ...base, answers: { q1: { choice: 2 }, q2: { text: "説明" } } };
    expect(deserializeSession("s1", serializeSession(withAnswers))).toEqual(withAnswers);
    expect(serializeSession(base).answers).toEqual({});
    expect(deserializeSession("s1", serializeSession(base)).answers).toBeUndefined();
  });

  it("updates only the one question's field, so other tabs' answers stay", async () => {
    const updates: unknown[][] = [];
    const db = {
      collection: (name: string) => ({
        doc: (id: string) => ({ update: async (...args: unknown[]) => void updates.push([name, id, ...args]) }),
      }),
    } as unknown as Firestore;

    await new FirestoreSessionStore(db).saveAnswer("s1", "q3", { choice: 2, text: undefined });
    expect(updates).toHaveLength(1);
    const [collection, id, field, value] = updates[0];
    expect([collection, id]).toEqual(["sessions", "s1"]);
    expect((field as FieldPath).isEqual(new FieldPath("answers", "q3"))).toBe(true);
    // Firestore は undefined を保存できないので、値のある項目だけを送る
    expect(value).toEqual({ choice: 2 });
    expect(Object.keys(value as object)).toEqual(["choice"]);
  });
});
