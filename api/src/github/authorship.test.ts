import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { findOutsideAuthored, generateQuiz } from "../quiz/generate.js";
import { PROFILES } from "../quiz/profile.js";
import { buildQuizPrompt, numberLines } from "../quiz/prompt.js";
import { deserializeSession, serializeSession } from "../store/firestore.js";
import { MemorySessionStore, type Session } from "../store/session.js";
import { fakeQuestion, fakeQuizResponse } from "../testing/fake-llm.js";
import type { LlmClient } from "../llm/client.js";
import type { GeneratedQuestion } from "../quiz/types.js";
import { fetchAuthoredSnapshot, findLogin, fitToBudget, focusOnLines, requireOwnCommits, toRanges } from "./authorship.js";
import { stripComments, stripCommentsWithLines } from "./comments.js";
import { RepoError } from "./url.js";
import type { RepoSnapshot } from "./snapshot.js";

type Blame = [start: number, end: number, login: string | null];

function github(opts: {
  commits?: { sha: string; parents: string[] }[];
  changed?: Record<string, { filename: string; changes: number }[]>;
  paths?: string[];
  blame?: Record<string, Blame[]>;
  content?: Record<string, string>;
}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.endsWith("/graphql")) {
      const path = JSON.parse(String(init?.body)).variables.p as string;
      const ranges = (opts.blame?.[path] ?? []).map(([startingLine, endingLine, login]) => ({
        startingLine,
        endingLine,
        commit: { author: { user: login ? { login } : null } },
      }));
      return json({ data: { repository: { defaultBranchRef: { target: { blame: { ranges } } } } } });
    }
    if (url.endsWith("/repos/o/r")) return json({ default_branch: "main", description: null, private: false });
    if (url.endsWith("/user/42")) return json({ login: "alice" });
    if (url.includes("/commits?author=")) return json(opts.commits ?? []);
    const detail = url.match(/\/commits\/(\w+)$/);
    if (detail) return json({ files: opts.changed?.[detail[1]] ?? [] });
    if (url.includes("/git/trees/")) return json({ tree: (opts.paths ?? []).map((path) => ({ path, type: "blob", size: 500 })) });
    const file = url.match(/\/contents\/(.+)\?ref=/);
    if (file) return new Response(opts.content?.[decodeURIComponent(file[1])] ?? "");
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const commit = (sha: string, parents = 1) => ({ sha, parents: Array.from({ length: parents }, () => "p") });

describe("stripCommentsWithLines", () => {
  it("maps output lines back to the original file", () => {
    const source = "// head\nconst a = 1;\n\n/* block\n   more */\nconst b = 2; // tail\n";
    const { content, lines } = stripCommentsWithLines("a.ts", source);
    expect(content.split("\n")).toEqual(["const a = 1;", "", "const b = 2;"]);
    expect(lines).toEqual([2, 3, 6]);
    expect(content).toBe(stripComments("a.ts", source));
  });

  it("keeps code that follows a multi-line block comment on the right line", () => {
    const { content, lines } = stripCommentsWithLines("a.ts", "/* one\n two */ const a = 1;\nconst b = 2;");
    expect(content.split("\n").map((l) => l.trim())).toEqual(["const a = 1;", "const b = 2;"]);
    expect(lines).toEqual([2, 3]);
  });

  it("tracks lines inside multi-line strings", () => {
    const { lines } = stripCommentsWithLines("a.ts", "// c\nconst s = `x\ny`;\nconst t = 1;");
    expect(lines).toEqual([2, 3, 4]);
  });

  it("tracks lines of a Python multi-line string that is not a docstring", () => {
    const { lines } = stripCommentsWithLines("a.py", '# c\ns = """x\ny"""\nt = 1');
    expect(lines).toEqual([2, 3, 4]);
  });

  it("uses identity for files it does not strip", () => {
    expect(stripCommentsWithLines("a.md", "a\nb")).toEqual({ content: "a\nb", lines: [1, 2] });
  });
});

describe("focusOnLines", () => {
  const content = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join("\n");

  it("keeps the author's lines and their surroundings without changing line numbers", () => {
    const lines = focusOnLines(content, [50], 2).split("\n");
    expect(lines).toHaveLength(100);
    expect(lines.slice(47, 52)).toEqual(["line48", "line49", "line50", "line51", "line52"]);
    expect(lines[46]).toBe("");
    expect(lines[52]).toBe("");
  });
});

describe("fitToBudget", () => {
  const content = Array.from({ length: 1000 }, (_, i) => `line number ${i + 1}`).join("\n");
  const all = Array.from({ length: 1000 }, (_, i) => i + 1);

  it("keeps everything when it fits", () => {
    expect(fitToBudget(content, all, 1_000_000)?.mine).toHaveLength(1000);
  });

  it("keeps the first part of the author's lines when it does not", () => {
    const fitted = fitToBudget(content, all, 5000)!;
    expect(fitted.mine.length).toBeLessThan(1000);
    expect(fitted.mine[0]).toBe(1);
    expect(fitted.content.replace(/\n{2,}/g, "\n").length).toBeLessThanOrEqual(5000);
  });

  it("gives up when not even one line fits", () => {
    expect(fitToBudget(content, all, 10)).toBeNull();
  });
});

describe("toRanges", () => {
  it("merges consecutive lines", () => {
    expect(toRanges([5, 1, 2, 3, 9])).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 9, end: 9 },
    ]);
  });
});

describe("findLogin", () => {
  it("turns the numeric id into the current login", async () => {
    const { fetchImpl } = github({});
    expect(await findLogin("42", { fetchImpl })).toBe("alice");
  });
});

describe("requireOwnCommits", () => {
  it("passes when the person has a commit", async () => {
    const { fetchImpl } = github({ commits: [commit("aaa")] });
    await expect(requireOwnCommits("github.com/o/r", "alice", { fetchImpl })).resolves.toBeUndefined();
  });

  it.each([
    ["no commits", []],
    ["only merge commits", [commit("aaa", 2)]],
  ])("rejects someone with %s", async (_name, commits) => {
    const { fetchImpl } = github({ commits });
    await expect(requireOwnCommits("github.com/o/r", "alice", { fetchImpl })).rejects.toMatchObject({ code: "no_authored" });
  });
});

describe("fetchAuthoredSnapshot", () => {
  const base = {
    commits: [commit("aaa")],
    changed: { aaa: [{ filename: "src/a.ts", changes: 10 }] },
    paths: ["src/a.ts"],
    content: { "src/a.ts": "const a = 1;\nconst b = 2;\nconst c = 3;" },
  };

  it("reads the whole file and reports only the author's lines", async () => {
    const { fetchImpl } = github({ ...base, blame: { "src/a.ts": [[1, 1, "other"], [2, 3, "alice"]] } });
    const snap = await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" });
    expect(snap.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(snap.files[0].content).toContain("const a = 1;");
    expect(snap.authored).toEqual({ "src/a.ts": [{ start: 2, end: 3 }] });
  });

  it("matches the login regardless of case", async () => {
    const { fetchImpl } = github({ ...base, blame: { "src/a.ts": [[1, 3, "Alice"]] } });
    const snap = await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" });
    expect(snap.authored?.["src/a.ts"]).toEqual([{ start: 1, end: 3 }]);
  });

  it("converts blame lines to the numbering after comments are removed", async () => {
    const { fetchImpl } = github({
      ...base,
      content: { "src/a.ts": "// license\n// more\nconst a = 1;\nconst b = 2;" },
      blame: { "src/a.ts": [[1, 2, "other"], [3, 3, "other"], [4, 4, "alice"]] },
    });
    const snap = await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" });
    expect(snap.files[0].content.split("\n")).toEqual(["const a = 1;", "const b = 2;"]);
    expect(snap.authored?.["src/a.ts"]).toEqual([{ start: 2, end: 2 }]);
  });

  it("ignores a file where the author only wrote comments", async () => {
    const { fetchImpl } = github({
      ...base,
      content: { "src/a.ts": "// mine\nconst a = 1;" },
      blame: { "src/a.ts": [[1, 1, "alice"], [2, 2, "other"]] },
    });
    await expect(fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" })).rejects.toMatchObject({ code: "no_authored" });
  });

  it("still reads a large file when only part of it is the author's", async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `const longVariableName${i} = compute(${i});`).join("\n");
    const { fetchImpl } = github({
      commits: [commit("aaa")],
      changed: { aaa: [{ filename: "lib/big.ts", changes: 5 }, { filename: "test/a.test.ts", changes: 1 }] },
      paths: ["lib/big.ts", "test/a.test.ts"],
      content: { "lib/big.ts": big, "test/a.test.ts": "const t = 1;" },
      blame: { "lib/big.ts": [[1500, 1510, "alice"]], "test/a.test.ts": [[1, 1, "alice"]] },
    });
    const snap = await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t", limits: PROFILES.mini.limits });
    expect(snap.files.map((f) => f.path)).toContain("lib/big.ts");
    expect(snap.authored?.["lib/big.ts"]).toEqual([{ start: 1500, end: 1510 }]);
    expect(snap.files.find((f) => f.path === "lib/big.ts")!.content.split("\n")[1499]).toContain("longVariableName1499");
  });

  it("reads part of the author's code rather than only their tests when each file is over the limit", async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `const longVariableName${i} = compute(${i});`).join("\n");
    const { fetchImpl } = github({
      commits: [commit("aaa")],
      changed: { aaa: [{ filename: "lib/big.ts", changes: 5 }, { filename: "test/a.test.ts", changes: 1 }] },
      paths: ["lib/big.ts", "test/a.test.ts"],
      content: { "lib/big.ts": big, "test/a.test.ts": "const t = 1;" },
      blame: { "lib/big.ts": [[1, 2000, "alice"]], "test/a.test.ts": [[1, 1, "alice"]] },
    });
    const snap = await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t", limits: PROFILES.mini.limits });
    expect(snap.files[0].path).toBe("lib/big.ts");
    expect(snap.authored?.["lib/big.ts"][0].start).toBe(1);
    expect(snap.authored?.["lib/big.ts"][0].end).toBeLessThan(2000);
  });

  it("finds older code the author wrote in files they have not touched recently", async () => {
    const { fetchImpl } = github({
      commits: [commit("aaa")],
      changed: { aaa: [{ filename: "test/a.test.ts", changes: 5 }] },
      paths: ["lib/core.ts", "test/a.test.ts"],
      content: { "lib/core.ts": "const core = 1;", "test/a.test.ts": "const t = 1;" },
      blame: { "lib/core.ts": [[1, 1, "alice"]], "test/a.test.ts": [[1, 1, "alice"]] },
    });
    const snap = await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" });
    expect(snap.files.map((f) => f.path)).toEqual(["lib/core.ts", "test/a.test.ts"]);
  });

  it("prefers logic over stylesheets", async () => {
    const { fetchImpl } = github({
      commits: [commit("aaa")],
      changed: { aaa: [{ filename: "a.css", changes: 90 }, { filename: "src/a.ts", changes: 1 }] },
      paths: ["a.css", "src/a.ts"],
      content: { "a.css": ".a { color: red; margin: 0; padding: 0; border: 0; }", "src/a.ts": "const a = 1;" },
      blame: { "a.css": [[1, 1, "alice"]], "src/a.ts": [[1, 1, "alice"]] },
    });
    const snap = await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" });
    expect(snap.files.map((f) => f.path)).toEqual(["src/a.ts", "a.css"]);
    expect(snap.size?.bytes).toBe("const a = 1;".length + 1);
  });

  it("does not count merge commits", async () => {
    const { fetchImpl, calls } = github({ ...base, commits: [commit("mmm", 2), commit("aaa")], blame: { "src/a.ts": [[1, 3, "alice"]] } });
    await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" });
    expect(calls.some((u) => u.endsWith("/commits/mmm"))).toBe(false);
  });

  it("skips files that no longer exist or are not source code", async () => {
    const { fetchImpl, calls } = github({
      ...base,
      changed: { aaa: [{ filename: "src/a.ts", changes: 1 }, { filename: "deleted.ts", changes: 99 }, { filename: "docs/x.ts", changes: 99 }] },
      paths: ["src/a.ts", "docs/x.ts"],
      blame: { "src/a.ts": [[1, 3, "alice"]] },
    });
    const snap = await fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" });
    expect(snap.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(calls.filter((u) => u.endsWith("/graphql"))).toHaveLength(1);
  });

  it("sizes the quiz by the author's own code", async () => {
    const { fetchImpl } = github({ ...base, blame: { "src/a.ts": [[1, 1, "alice"]] } });
    let bytes = -1;
    await fetchAuthoredSnapshot("github.com/o/r", "alice", {
      fetchImpl,
      token: "t",
      limits: (size) => {
        bytes = size.bytes;
        return PROFILES.tiny.limits;
      },
    });
    expect(bytes).toBe("const a = 1;".length + 1);
  });

  it("reports when the author has no commits", async () => {
    const { fetchImpl } = github({ ...base, commits: [] });
    await expect(fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl, token: "t" })).rejects.toMatchObject({ code: "no_authored" });
  });

  it("requires a token, because blame is only available through GraphQL", async () => {
    await expect(fetchAuthoredSnapshot("github.com/o/r", "alice", {})).rejects.toMatchObject({ code: "token_required" });
  });

  it("reports a token that GraphQL refuses (expired after 8 hours) as unauthorized", async () => {
    const { fetchImpl } = github({ ...base, blame: { "src/a.ts": [[1, 1, "alice"]] } });
    const refusing = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/graphql") ? new Response("{}", { status: 401 }) : fetchImpl(input, init)) as typeof fetch;
    await expect(fetchAuthoredSnapshot("github.com/o/r", "alice", { fetchImpl: refusing, token: "ghu_old" })).rejects.toMatchObject({
      code: "unauthorized",
    });
  });
});

const authoredSnap: RepoSnapshot = {
  owner: "o",
  repo: "r",
  branch: "main",
  description: null,
  files: [{ path: "src/a.ts", content: "line1\nline2\nline3\nline4" }],
  skipped: 0,
  size: { files: 1, bytes: 100 },
  authored: { "src/a.ts": [{ start: 2, end: 3 }] },
};

describe("prompt for an author's code", () => {
  it("marks the author's lines", () => {
    expect(numberLines("a\nb", [{ start: 2, end: 2 }]).split("\n")).toEqual(["   1| a", "*  2| b"]);
    expect(numberLines("a")).toBe("  1| a");
  });

  it("elides the removed regions but keeps real line numbers", () => {
    const text = numberLines("a\n\n\n\nb", [{ start: 5, end: 5 }]);
    expect(text.split("\n")).toEqual(["   1| a", "   2| ", "     …", "*  5| b"]);
  });

  it("tells the model to ask only about marked lines", () => {
    const spec = { choice: ["reading" as const], free: [] };
    const { system, user } = buildQuizPrompt(authoredSnap, spec);
    expect(system).toContain("# 出題範囲");
    expect(user).toContain("*  2| line2");
    expect(user).toContain("   1| line1");
    const { system: plain } = buildQuizPrompt({ ...authoredSnap, authored: undefined }, spec);
    expect(plain).not.toContain("# 出題範囲");
  });
});

describe("findOutsideAuthored", () => {
  const q = (path: string, startLine: number, endLine: number) =>
    ({ ...fakeQuestion(0, "choice"), codeRef: { path, startLine, endLine } }) as GeneratedQuestion;

  it("accepts a question that overlaps the author's lines", () => {
    expect(findOutsideAuthored([q("src/a.ts", 3, 4)], authoredSnap.authored)).toBeNull();
  });

  it("rejects a question about someone else's lines or files", () => {
    expect(findOutsideAuthored([q("src/a.ts", 4, 4)], authoredSnap.authored)).toContain("本人が書いていない");
    expect(findOutsideAuthored([q("src/b.ts", 1, 1)], authoredSnap.authored)).toContain("本人が書いていない");
  });

  it("does nothing for a whole-repository quiz", () => {
    expect(findOutsideAuthored([q("src/b.ts", 1, 1)], undefined)).toBeNull();
  });

  it("makes the model try again", async () => {
    let calls = 0;
    const llm: LlmClient = {
      async generateJson(req) {
        const response = fakeQuizResponse(req.system);
        calls++;
        for (const item of response.questions) item.codeRef = { path: "src/a.ts", startLine: calls === 1 ? 4 : 2, endLine: calls === 1 ? 4 : 3 };
        return response;
      },
    };
    const quiz = await generateQuiz(authoredSnap, llm, { profile: PROFILES.tiny });
    expect(calls).toBe(2);
    expect(quiz.questions.every((x) => x.codeRef.startLine === 2)).toBe(true);
  });
});

describe("API for an author's quiz", () => {
  function setup(opts: { stranger?: boolean; login?: boolean } = {}) {
    const store = new MemorySessionStore();
    const authoredCalls: [string, string][] = [];
    const checkedLogins: string[] = [];
    let llmCalls = 0;
    let wholeCalls = 0;
    const llm: LlmClient = {
      async generateJson(req) {
        llmCalls++;
        if (req.system.includes("このリクエストで作る問題")) {
          const response = fakeQuizResponse(req.system);
          for (const item of response.questions) item.codeRef = { path: "src/a.ts", startLine: 2, endLine: 3 };
          return response;
        }
        return { grades: [], summary: "総評" };
      },
    };
    const app = createApp({
      llm,
      store,
      // login: false は開発用(ログインなし)
      ...(opts.login === false ? {} : { auth: { verify: async () => ({ uid: "u1", githubId: "1" }) }, allowed: { has: () => true, size: "all" as const } }),
      fetchSnapshot: async () => {
        wholeCalls++;
        return { ...authoredSnap, authored: undefined };
      },
      fetchAuthoredSnapshot: async (url, login) => {
        authoredCalls.push([url, login]);
        if (opts.stranger) throw new RepoError("no_authored", "見つかりません");
        return authoredSnap;
      },
      checkRepo: async () => ({ owner: "o", repo: "r", description: null }),
      findLogin: async (githubId) => (githubId === "1" ? "alice" : "someone"),
      requireOwnCommits: async (_url, login) => {
        checkedLogins.push(login);
        if (opts.stranger) throw new RepoError("no_authored", "見つかりません");
      },
    });
    const post = (path: string, body: unknown = {}) =>
      app.request(path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer t" }, body: JSON.stringify(body) });
    return { post, store, authoredCalls, checkedLogins, llmCalls: () => llmCalls, wholes: () => wholeCalls };
  }

  it("uses the signed-in person's code and remembers them", async () => {
    const t = setup();
    const res = await t.post("/api/quiz", { url: "github.com/o/r" });
    const { sessionId } = (await res.json()) as { sessionId: string };
    expect(t.authoredCalls).toEqual([["github.com/o/r", "alice"]]);
    expect(t.wholes()).toBe(0);
    expect((await t.store.get(sessionId))!.author).toBe("alice");
  });

  it("ignores an author sent by the client", async () => {
    const t = setup();
    await t.post("/api/quiz", { url: "github.com/o/r", author: "bob" });
    expect(t.authoredCalls).toEqual([["github.com/o/r", "alice"]]);
  });

  it("refuses a repository without the person's code, instead of reading the whole of it", async () => {
    const t = setup({ stranger: true });
    const res = await t.post("/api/quiz", { url: "github.com/o/r" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("no_authored");
    expect(t.wholes()).toBe(0);
    expect(t.llmCalls()).toBe(0);
  });

  it("tells the URL check when the person has no commits", async () => {
    const t = setup({ stranger: true });
    const res = await t.post("/api/repo/check", { url: "github.com/o/r" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("no_authored");
    expect(t.checkedLogins).toEqual(["alice"]);
  });

  it("passes the URL check when the person has commits", async () => {
    const res = await setup().post("/api/repo/check", { url: "github.com/o/r" });
    expect(await res.json()).toEqual({ owner: "o", repo: "r", description: null });
  });

  it("reads the whole repository in development, where nobody is signed in", async () => {
    const t = setup({ login: false });
    await t.post("/api/quiz", { url: "github.com/o/r" });
    expect(t.authoredCalls).toHaveLength(0);
    expect(t.wholes()).toBe(1);
    expect((await t.post("/api/repo/check", { url: "github.com/o/r" })).status).toBe(200);
    expect(t.checkedLogins).toHaveLength(0);
  });

  it("stays on the author's code when retrying", async () => {
    const t = setup();
    const { sessionId } = (await (await t.post("/api/quiz", { url: "github.com/o/r" })).json()) as { sessionId: string };
    await t.post(`/api/quiz/${sessionId}/grade`, { answers: {} });
    const res = await t.post(`/api/quiz/${sessionId}/retry`);
    expect(res.status).toBe(200);
    expect(t.authoredCalls).toHaveLength(2);
    expect(t.authoredCalls[1]).toEqual(["https://github.com/o/r", "alice"]);
    const next = (await res.json()) as { sessionId: string };
    expect((await t.store.get(next.sessionId))!.author).toBe("alice");
    expect(t.wholes()).toBe(0);
  });

  it("stores the author in Firestore documents", () => {
    const session = { id: "s", createdAt: 1, quiz: { repo: { owner: "o", repo: "r" }, questions: [] }, snippets: {}, author: "alice" } as unknown as Session;
    expect(deserializeSession("s", serializeSession(session)).author).toBe("alice");
    expect(deserializeSession("s", serializeSession({ ...session, author: undefined })).author).toBeUndefined();
  });
});
