import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { DEV_USER, authFromEnv, parseAllowlist, toAuthUser, type Authenticator } from "./auth.js";
import type { RepoSnapshot } from "./github/snapshot.js";
import { PROFILES } from "./quiz/profile.js";
import { MemorySessionStore } from "./store/session.js";
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

/** "token-alice" → uid alice(GitHub ID 1)。知らない名前やそれ以外の形は検証失敗。 */
const GITHUB_IDS: Record<string, string> = { alice: "1", bob: "2", carol: "3" };
const auth: Authenticator = {
  async verify(token) {
    const name = token.match(/^token-(\w+)$/)?.[1];
    return name && GITHUB_IDS[name] ? { uid: name, githubId: GITHUB_IDS[name] } : null;
  },
};
/** alice と bob だけが使える。carol はログインできるが、許可リストに無い。 */
const allowed = parseAllowlist("1 2");

const bearer = (user: string) => ({ authorization: `Bearer token-${user}` });

function setup(extra: Parameters<typeof createApp>[0] = {}) {
  const seen: (string | undefined)[] = [];
  const app = createApp({
    llm,
    auth,
    allowed,
    privateRepos: false,
    profile: PROFILES.full,
    fetchSnapshot: async (_url, userToken) => {
      seen.push(userToken);
      return snap;
    },
    findLogin: async () => "someone",
    fetchAuthoredSnapshot: async (_url, _login, userToken) => {
      seen.push(userToken);
      return snap;
    },
    ...extra,
  });
  const post = (path: string, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ url: "https://github.com/o/r", answers: {} }),
    });
  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });
  return { app, post, get, seen };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("login required", () => {
  it("rejects requests without a valid Firebase token", async () => {
    const { post, get, seen } = setup();
    const responses = [
      await post("/api/quiz"),
      await post("/api/quiz", { authorization: "Bearer forged" }),
      await post("/api/repo/check"),
      await get("/api/me"),
      await get("/api/stats"),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("unauthorized");
    }
    expect(seen).toEqual([]);
  });

  it("keeps the health check open", async () => {
    expect((await setup().get("/api/health")).status).toBe(200);
  });

  it("rejects signed-in users who are not on the allowlist", async () => {
    const { post, get, seen } = setup();
    const res = await post("/api/quiz", bearer("carol"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_allowed");
    expect((await get("/api/me", bearer("carol"))).status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("tells an allowed user their GitHub ID", async () => {
    const res = await setup().get("/api/me", bearer("alice"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ githubId: "1", privateRepos: false, consent: null });
  });

  it("refuses to start with development authentication on Cloud Run", () => {
    vi.stubEnv("K_SERVICE", "evc-api");
    expect(() => createApp({ llm })).toThrow(/AUTH=firebase/);
    expect(() => createApp({ llm, auth, allowed })).not.toThrow();
  });
});

describe("development mode (no authenticator)", () => {
  it("treats every request as the development user", async () => {
    const { app, post } = setup({ auth: undefined });
    expect(await (await app.request("/api/me")).json()).toEqual({ githubId: DEV_USER.githubId, privateRepos: false, consent: null });
    const created = await (await post("/api/quiz")).json();
    expect((await app.request(`/api/quiz/${created.sessionId}`)).status).toBe(200);
  });
});

describe("GitHub token forwarding", () => {
  it("passes the user's GitHub token only for verified users", async () => {
    const { post, seen } = setup();
    await post("/api/quiz", { ...bearer("alice"), "x-github-token": "gho_user" });
    await post("/api/quiz", { authorization: "Bearer forged", "x-github-token": "gho_stolen" });
    await post("/api/quiz", bearer("bob"));
    expect(seen).toEqual(["gho_user", undefined]);
  });

  it("ignores the GitHub token header in development mode", async () => {
    const { post, seen } = setup({ auth: undefined });
    await post("/api/quiz", { ...bearer("alice"), "x-github-token": "gho_x" });
    expect(seen).toEqual([undefined]);
  });
});

describe("rate limit", () => {
  it("counts requests per account, not per IP address", async () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "1");
    const { post } = setup();
    const sameIp = { "x-forwarded-for": "203.0.113.1" };
    expect((await post("/api/quiz", { ...bearer("alice"), ...sameIp })).status).toBe(200);
    expect((await post("/api/quiz", { ...bearer("alice"), ...sameIp })).status).toBe(429);
    expect((await post("/api/quiz", { ...bearer("bob"), ...sameIp })).status).toBe(200);
  });
});

describe("GET /api/weakness", () => {
  it("aggregates only the caller's graded sessions", async () => {
    const gradingLlm = fakeLlm(async () => ({ grades: [], summary: "s" }));
    const { post, get } = setup({ llm: gradingLlm });

    const created = await (await post("/api/quiz", bearer("alice"))).json();
    await post(`/api/quiz/${created.sessionId}/grade`, bearer("alice"));

    const alice = await (await get("/api/weakness", bearer("alice"))).json();
    expect(alice.sessions).toBe(1);
    expect(alice.weakest.length).toBeGreaterThan(0);
    expect((await (await get("/api/weakness", bearer("bob"))).json()).sessions).toBe(0);
  });
});

describe("session ownership", () => {
  it("hides a user's session from others, including grading and retrying", async () => {
    const { get, post } = setup();
    const created = await (await post("/api/quiz", bearer("alice"))).json();
    const id = created.sessionId;

    expect((await get(`/api/quiz/${id}`, bearer("alice"))).status).toBe(200);
    expect((await get(`/api/quiz/${id}`, bearer("bob"))).status).toBe(404);
    expect((await post(`/api/quiz/${id}/grade`, bearer("bob"))).status).toBe(404);
    expect((await post(`/api/quiz/${id}/retry`, bearer("bob"))).status).toBe(404);
  });

  it("hides sessions that were created before login was required", async () => {
    const store = new MemorySessionStore();
    const old = await store.create({
      quiz: { repo: { owner: "o", repo: "r", branch: "main", description: null }, questions: [] },
      snippets: {},
    });
    const { get } = setup({ store });
    expect((await get(`/api/quiz/${old.id}`, bearer("alice"))).status).toBe(404);
  });
});

describe("authFromEnv", () => {
  it("verifies Firebase tokens only when AUTH=firebase", () => {
    expect(authFromEnv({ AUTH: "firebase" })).toBeDefined();
    expect(authFromEnv({})).toBeUndefined();
    expect(authFromEnv({ AUTH: "dev" })).toBeUndefined();
    expect(() => authFromEnv({ AUTH: "firebse" })).toThrow(/AUTH/);
  });
});

describe("toAuthUser", () => {
  it("reads the GitHub user ID from a GitHub sign-in", () => {
    const firebase = { sign_in_provider: "github.com", identities: { "github.com": ["583231"], email: ["a@example.com"] } };
    expect(toAuthUser("u1", firebase)).toEqual({ uid: "u1", githubId: "583231" });
  });

  it("rejects other sign-in methods", () => {
    expect(toAuthUser("u1", { sign_in_provider: "password", identities: { email: ["a@example.com"] } })).toBeNull();
    expect(toAuthUser("u1", { sign_in_provider: "github.com", identities: {} })).toBeNull();
    expect(toAuthUser("u1", undefined)).toBeNull();
  });
});

describe("parseAllowlist", () => {
  it("accepts GitHub IDs separated by spaces or commas", () => {
    const list = parseAllowlist(" 1, 2\n3 ");
    expect(["1", "2", "3", "4"].map((id) => list.has(id))).toEqual([true, true, true, false]);
    expect(list.size).toBe(3);
  });

  it("allows everyone with *", () => {
    expect(parseAllowlist("*").has("999")).toBe(true);
    expect(parseAllowlist("*").size).toBe("all");
  });

  it("allows no one when empty, so a forgotten setting does not open the service", () => {
    expect(parseAllowlist(undefined).has("1")).toBe(false);
    expect(parseAllowlist("").size).toBe(0);
  });
});
