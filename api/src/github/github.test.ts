import { describe, expect, it } from "vitest";
import { isCandidate, measureSource, selectFiles } from "./filter.js";
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

  it("strips comments from source files before they are shown or sent to the AI", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/o/r")) return new Response(JSON.stringify({ default_branch: "main", description: null, private: false }));
      if (url.includes("/git/trees/")) {
        return new Response(
          JSON.stringify({ tree: [{ path: "src/a.ts", type: "blob", size: 80 }, { path: "README.md", type: "blob", size: 30 }] }),
        );
      }
      return new Response(url.endsWith("README.md") ? "# Title\n<!-- keep -->" : "// answer: 3\nconst a = 1 + 2; // three");
    }) as typeof fetch;
    const snap = await fetchRepoSnapshot("https://github.com/o/r", { fetchImpl });
    const byPath = Object.fromEntries(snap.files.map((f) => [f.path, f.content]));
    expect(byPath["src/a.ts"]).toBe("const a = 1 + 2;");
    expect(byPath["README.md"]).toBe("# Title\n<!-- keep -->");
  });

  it("rejects private repos even with a server token, unless allowPrivate", async () => {
    const fetchImpl = mockFetch({ default_branch: "main", description: null, private: true });
    await expect(fetchRepoSnapshot("https://github.com/o/r", { fetchImpl, token: "t" })).rejects.toMatchObject({
      code: "private",
    });
    const snap = await fetchRepoSnapshot("https://github.com/o/r", { fetchImpl, token: "t", allowPrivate: true });
    expect(snap.files).toHaveLength(1);
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

describe("files that are not worth reading", () => {
  const entry = (path: string, size = 100) => ({ path, size });

  it.each([
    "examples/auth/index.js",
    "packages/app/demo/main.ts",
    "test/fixtures/a.js",
    "docs/guide/intro.js",
    "benchmarks/run.js",
    "src/__mocks__/api.ts",
    ".github/scripts/release.js",
    "vite.config.ts",
    "packages/core/rollup.config.mjs",
    ".eslintrc.js",
    "packages/core/package.json",
    "packages/core/README.md",
  ])("skips %s", (path) => {
    expect(isCandidate(entry(path))).toBe(false);
  });

  it.each(["src/app.ts", "packages/core/src/index.ts", "README.md", "package.json", "lib/express.js", "scripts/build.sh", "test/app.test.ts"])(
    "keeps %s",
    (path) => {
      expect(isCandidate(entry(path))).toBe(true);
    },
  );

  it("does not let shallow examples crowd out the real code", () => {
    const tree = [
      ...Array.from({ length: 30 }, (_, i) => entry(`examples/e${i}.js`)),
      ...Array.from({ length: 5 }, (_, i) => entry(`lib/deep/er/m${i}.js`)),
    ];
    expect(selectFiles(tree).selected.map((e) => e.path).every((p) => p.startsWith("lib/"))).toBe(true);
  });

  it("reads the examples when the repository is nothing but examples", () => {
    const tree = [entry("README.md"), entry("examples/a.js"), entry("examples/b.js")];
    expect(selectFiles(tree).selected.map((e) => e.path)).toEqual(expect.arrayContaining(["examples/a.js", "examples/b.js"]));
  });

  it("keeps a few tests even when the code fills the limit", () => {
    const tree = [
      ...Array.from({ length: 100 }, (_, i) => entry(`src/f${i}.ts`)),
      ...Array.from({ length: 20 }, (_, i) => entry(`test/t${i}.test.ts`)),
    ];
    const paths = selectFiles(tree).selected.map((e) => e.path);
    expect(paths).toHaveLength(40);
    expect(paths.filter((p) => p.startsWith("test/"))).toHaveLength(5);
  });

  it("measures only the real code", () => {
    expect(
      measureSource([
        entry("lib/a.js", 1000),
        entry("README.md", 5000),
        entry("package.json", 5000),
        entry("test/a.js", 9000),
        entry("lib/a_test.go", 9000),
        entry("examples/b.js", 9000),
        entry("vite.config.ts", 9000),
      ]),
    ).toEqual({ files: 1, bytes: 1000 });
  });

  it.each(["test-d/index.ts", "tests_unit/a.py", "test.js", "pkg/tests.ts", "pkg/test_a.py"])("treats %s as a test", (path) => {
    expect(measureSource([entry(path, 1000), entry("src/a.ts", 1000)])).toEqual({ files: 1, bytes: 1000 });
  });

  it("measures the examples when there is nothing else", () => {
    expect(measureSource([entry("README.md", 5000), entry("examples/a.js", 2000)])).toEqual({ files: 1, bytes: 2000 });
  });
});
