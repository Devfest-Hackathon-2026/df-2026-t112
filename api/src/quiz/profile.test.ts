import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { measureSource } from "../github/filter.js";
import { fetchRepoSnapshot, type RepoSnapshot } from "../github/snapshot.js";
import { fakeLlm } from "../testing/fake-llm.js";
import { MINI_MAX_BYTES, PROFILES, STANDARD_MAX_BYTES, TINY_MAX_BYTES, fixedProfileFromEnv, profileForSize } from "./profile.js";

const bytes = (n: number) => ({ files: 1, bytes: n });
const total = (name: keyof typeof PROFILES) => PROFILES[name].choice + PROFILES[name].free;

describe("profileForSize", () => {
  it.each([
    [1024, "tiny"],
    [TINY_MAX_BYTES - 1, "tiny"],
    [TINY_MAX_BYTES, "mini"],
    [MINI_MAX_BYTES - 1, "mini"],
    [MINI_MAX_BYTES, "standard"],
    [STANDARD_MAX_BYTES - 1, "standard"],
    [STANDARD_MAX_BYTES, "full"],
    [50 * 1024 * 1024, "full"],
  ] as const)("%i bytes uses %s", (size, name) => {
    expect(profileForSize(bytes(size)).name).toBe(name);
  });

  it("grows from 4 to a maximum of 18 questions", () => {
    expect([total("tiny"), total("mini"), total("standard"), total("full")]).toEqual([4, 6, 12, 18]);
  });
});

describe("fixedProfileFromEnv", () => {
  it("leaves the size-based choice in place unless a valid profile is set", () => {
    expect(fixedProfileFromEnv(undefined)).toBeUndefined();
    expect(fixedProfileFromEnv("whatever")).toBeUndefined();
    expect(fixedProfileFromEnv("FULL")?.name).toBe("full");
  });
});

describe("measureSource", () => {
  it("counts source files only, before any limit is applied", () => {
    const tree = [
      ...Array.from({ length: 100 }, (_, i) => ({ path: `src/f${i}.ts`, size: 1000 })),
      { path: "node_modules/a/index.js", size: 5000 },
      { path: "logo.png", size: 9000 },
    ];
    expect(measureSource(tree)).toEqual({ files: 100, bytes: 100_000 });
  });
});

describe("fetchRepoSnapshot with size-based limits", () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/repos/o/r")) return new Response(JSON.stringify({ default_branch: "main", description: null, private: false }));
    if (url.includes("/git/trees/")) {
      return new Response(JSON.stringify({ tree: Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.ts`, type: "blob", size: 1000 })) }));
    }
    return new Response("const a = 1;");
  }) as typeof fetch;

  it("chooses limits from the full size and reports it", async () => {
    let seen = 0;
    const snap = await fetchRepoSnapshot("https://github.com/o/r", {
      fetchImpl,
      limits: (size) => {
        seen = size.bytes;
        return { ...PROFILES.tiny.limits, maxFiles: 2 };
      },
    });
    expect(seen).toBe(30_000);
    expect(snap.files).toHaveLength(2);
    expect(snap.size).toEqual({ files: 30, bytes: 30_000 });
  });
});

describe("POST /api/quiz question count", () => {
  const snap = (size?: RepoSnapshot["size"]): RepoSnapshot => ({
    owner: "o",
    repo: "r",
    branch: "main",
    description: null,
    files: [{ path: "src/a.ts", content: "line1\nline2" }],
    skipped: 0,
    size,
  });
  const count = async (partial: Parameters<typeof createApp>[0]) => {
    const app = createApp({ llm: fakeLlm(), ...partial });
    const res = await app.request("/api/quiz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "o/r" }) });
    return ((await res.json()) as { questions: unknown[] }).questions.length;
  };

  it.each([
    [1024, 4],
    [20 * 1024, 6],
    [200 * 1024, 12],
    [5 * 1024 * 1024, 18],
  ])("a repository of %i bytes gets %i questions", async (size, expected) => {
    expect(await count({ fetchSnapshot: async () => snap({ files: 10, bytes: size }) })).toBe(expected);
  });

  it("uses the size of the snapshot when the full size is unknown", async () => {
    expect(await count({ fetchSnapshot: async () => snap() })).toBe(4);
  });

  it("uses a fixed profile when one is configured", async () => {
    expect(await count({ profile: PROFILES.standard, fetchSnapshot: async () => snap({ files: 1, bytes: 100 }) })).toBe(12);
  });
});
