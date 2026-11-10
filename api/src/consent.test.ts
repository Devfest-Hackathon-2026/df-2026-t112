import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { parseAllowlist, type Authenticator } from "./auth.js";
import { FirestoreUserStore, readConsent } from "./store/firestore.js";

// 規約への同意(#34 の D26、#37 の UserDoc.consent)

/** "token-alice" → alice、"token-bob" → bob。 */
const auth: Authenticator = {
  async verify(token) {
    const name = token.match(/^token-(\w+)$/)?.[1];
    return name === "alice" || name === "bob" ? { uid: name, githubId: name === "alice" ? "1" : "2" } : null;
  },
};

function setup() {
  const app = createApp({ auth, allowed: parseAllowlist("*"), privateRepos: false });
  const call = (method: string, path: string, user: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer token-${user}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const me = async (user = "alice") => (await call("GET", "/api/me", user)).json();
  const agree = (body: unknown, user = "alice") => call("POST", "/api/me/consent", user, body);
  return { app, me, agree };
}

describe("agreeing to the terms", () => {
  it("starts with no consent", async () => {
    expect((await setup().me()).consent).toBeNull();
  });

  it("records the version, the time and the age confirmation, for that account only", async () => {
    const { me, agree } = setup();
    const before = Date.now();
    const res = await agree({ termsVersion: "2026-11-10", ageConfirmed: true });
    expect(res.status).toBe(200);
    const { consent } = await me();
    expect(consent).toMatchObject({ termsVersion: "2026-11-10", ageConfirmed: true });
    expect(consent.agreedAt).toBeGreaterThanOrEqual(before);
    expect(await res.json()).toEqual({ consent });
    expect((await me("bob")).consent).toBeNull();
  });

  it("keeps the newest version when the terms change", async () => {
    const { me, agree } = setup();
    await agree({ termsVersion: "2026-11-10", ageConfirmed: true });
    await agree({ termsVersion: "2026-12-01", ageConfirmed: true });
    expect((await me()).consent.termsVersion).toBe("2026-12-01");
  });

  it.each([
    [{ ageConfirmed: true }, "invalid_terms_version"],
    [{ termsVersion: "latest", ageConfirmed: true }, "invalid_terms_version"],
    [{ termsVersion: "2026-11-10" }, "age_not_confirmed"],
    [{ termsVersion: "2026-11-10", ageConfirmed: false }, "age_not_confirmed"],
  ])("refuses %j", async (body, error) => {
    const { me, agree } = setup();
    const res = await agree(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect((await me()).consent).toBeNull();
  });

  it("needs a login", async () => {
    const res = await setup().app.request("/api/me/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ termsVersion: "2026-11-10", ageConfirmed: true }),
    });
    expect(res.status).toBe(401);
  });
});

describe("FirestoreUserStore", () => {
  it("writes users/{uid}.consent with a Timestamp, keeping the other fields of the document", async () => {
    const writes: { path: string; data: unknown; options: unknown }[] = [];
    const db = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          set: async (data: unknown, options: unknown) => {
            writes.push({ path: `${name}/${id}`, data, options });
          },
        }),
      }),
    } as unknown as Firestore;
    await new FirestoreUserStore(db).saveConsent("alice", { termsVersion: "2026-11-10", agreedAt: 1_700_000_000_000, ageConfirmed: true });
    expect(writes).toEqual([
      {
        path: "users/alice",
        data: { consent: { termsVersion: "2026-11-10", agreedAt: Timestamp.fromMillis(1_700_000_000_000), ageConfirmed: true } },
        options: { merge: true },
      },
    ]);
  });

  it("reads a stored consent, and treats anything else as no consent", () => {
    expect(readConsent({ termsVersion: "2026-11-10", agreedAt: Timestamp.fromMillis(5), ageConfirmed: true })).toEqual({
      termsVersion: "2026-11-10",
      agreedAt: 5,
      ageConfirmed: true,
    });
    expect(readConsent(undefined)).toBeNull();
    expect(readConsent({ termsVersion: "2026-11-10" })).toBeNull();
    expect(readConsent({ termsVersion: "2026-11-10", agreedAt: "yesterday", ageConfirmed: true })).toBeNull();
  });
});
