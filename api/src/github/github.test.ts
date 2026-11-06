import { describe, expect, it } from "vitest";
import { isCandidate, selectFiles } from "./filter.js";
import { fetchRepoSnapshot } from "./snapshot.js";
import { RepoError, parseRepoUrl } from "./url.js";

describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/octocat/Hello-World", "octocat", "Hello-World"],
    ["https://github.com/octocat/Hello-World.git", "octocat", "Hello-World"],
    ["github.com/octocat/Hello-World/tree/main/src", "octocat", "Hello-World"],
    ["  https://www.github.com/a/b/  ", "a", "b"],
  ])("%s", (input, owner, repo) => {
    expect(parseRepoUrl(input)).toEqual({ owner, repo });
  });

  it.each(["", "not a url", "https://gitlab.com/a/b", "https://github.com/onlyowner", "https://github.com/a/.."])(
    "rejects %j",
    (input) => {
      expect(() => parseRepoUrl(input)).toThrow(RepoError);
    },
  );
});

describe("selectFiles", () => {
  it("excludes vendored, lock, binary and oversized files", () => {
    expect(isCandidate({ path: "node_modules/x/index.js", size: 10 })).toBe(false);
    expect(isCandidate({ path: "package-lock.json", size: 10 })).toBe(false);
    expect(isCandidate({ path: "logo.png", size: 10 })).toBe(false);
    expect(isCandidate({ path: "src/big.ts", size: 1_000_000 })).toBe(false);
    expect(isCandidate({ path: "src/app.ts", size: 10 })).toBe(true);
  });

  it("prefers README and src files over tests, and tests over very deep files", () => {
    const { selected } = selectFiles([
      { path: "a/b/c/d/deep.ts", size: 100 },
      { path: "src/app.test.ts", size: 100 },
      { path: "src/app.ts", size: 100 },
      { path: "README.md", size: 100 },
    ]);
    expect(selected.map((e) => e.path)).toEqual(["README.md", "src/app.ts", "src/app.test.ts", "a/b/c/d/deep.ts"]);
  });

  it("respects the file count limit", () => {
    const tree = Array.from({ length: 100 }, (_, i) => ({ path: `src/f${i}.ts`, size: 100 }));
    expect(selectFiles(tree).selected).toHaveLength(40);
  });
});

describe("fetchRepoSnapshot", () => {
  const mockFetch = (meta: object, status = 200): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/o/r")) return new Response(JSON.stringify(meta), { status });
      if (url.includes("/git/trees/")) {
        return new Response(
          JSON.stringify({ tree: [{ path: "src/a.ts", type: "blob", size: 12 }, { path: "src", type: "tree" }] }),
        );
      }
      return new Response("const a = 1;");
    }) as typeof fetch;

  it("returns files for a public repo", async () => {
    const snap = await fetchRepoSnapshot("https://github.com/o/r", {
      fetchImpl: mockFetch({ default_branch: "main", description: "d", private: false }),
    });
    expect(snap.files).toEqual([{ path: "src/a.ts", content: "const a = 1;" }]);
    expect(snap.branch).toBe("main");
  });

  it("rejects private repos without a token", async () => {
    await expect(
      fetchRepoSnapshot("https://github.com/o/r", {
        fetchImpl: mockFetch({ default_branch: "main", description: null, private: true }),
      }),
    ).rejects.toMatchObject({ code: "private" });
  });

  it("maps 404 to not_found", async () => {
    await expect(
      fetchRepoSnapshot("https://github.com/o/r", { fetchImpl: mockFetch({}, 404) }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
