import { describe, expect, it } from "vitest";
import { availableCategories, choiceCounts, planChunks, primaryFiles } from "./plan.js";
import { PROFILES, profileFromEnv } from "./profile.js";
import { CATEGORIES } from "./types.js";

const total = (chunks: ReturnType<typeof planChunks>, key: "choice" | "free") =>
  chunks.reduce((n, c) => n + c[key].length, 0);

describe("planChunks (full)", () => {
  const full = PROFILES.full;

  it("splits 15 choice + 3 free into balanced chunks, 3 per category", () => {
    const chunks = planChunks(full);
    expect(chunks).toHaveLength(3);
    expect(total(chunks, "choice")).toBe(15);
    expect(total(chunks, "free")).toBe(3);
    for (const c of chunks) {
      expect(c.choice).toHaveLength(5);
      expect(c.free).toHaveLength(1);
    }
    for (const cat of CATEGORIES) {
      expect(chunks.flatMap((c) => c.choice).filter((x) => x === cat)).toHaveLength(3);
    }
    expect(new Set(chunks.flatMap((c) => c.free)).size).toBe(3);
  });

});

describe("planChunks (mini)", () => {
  const mini = PROFILES.mini;

  it("makes a single request with one choice question per category plus one free question", () => {
    const chunks = planChunks(mini);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choice).toEqual([...CATEGORIES]);
    expect(chunks[0].free).toHaveLength(1);
  });
});

describe("planChunks (standard)", () => {
  it("makes 2 requests of 5 choice + 1 free, 2 choice questions per category", () => {
    const chunks = planChunks(PROFILES.standard);
    expect(chunks).toHaveLength(2);
    for (const c of chunks) {
      expect(c.choice).toHaveLength(5);
      expect(c.free).toHaveLength(1);
    }
    for (const cat of CATEGORIES) {
      expect(chunks.flatMap((c) => c.choice).filter((x) => x === cat)).toHaveLength(2);
    }
    expect(new Set(chunks.flatMap((c) => c.free)).size).toBe(2);
  });
});

describe("free question rotation", () => {
  it("starts at the given category and wraps around", () => {
    const free = (offset: number) => planChunks(PROFILES.standard, CATEGORIES, offset).flatMap((c) => c.free);
    expect(free(0)).toEqual(["reading", "design"]);
    expect(free(4)).toEqual(["security", "reading"]);
  });

  it("can give free questions to every category", () => {
    const seen = CATEGORIES.map((_, offset) => planChunks(PROFILES.mini, CATEGORIES, offset)[0].free[0]);
    expect(new Set(seen)).toEqual(new Set(CATEGORIES));
  });
});

describe("availableCategories", () => {
  const without = CATEGORIES.filter((c) => c !== "security");
  const file = (path: string, content: string) => ({ path, content });

  it("drops security for code with nothing to protect", () => {
    expect(
      availableCategories([
        file("index.html", '<img src="a.png" alt="x"><link rel="stylesheet" href="s.css">'),
        file("styles.css", "* { margin: 0; }"),
        file("README.md", "Fork this repository and create a pull request. Add an auth token."),
      ]),
    ).toEqual(without);
    expect(availableCategories([file("add.ts", "export const add = (a: number, b: number) => a + b;")])).toEqual(without);
  });

  it.each([
    ["app.ts", "if (!isAuthorized(user)) throw new Error()"],
    ["server.js", "const name = req.body.name;"],
    ["config.py", "key = os.environ['KEY']"],
    ["client.ts", "await fetch(url)"],
    ["view.tsx", "el.innerHTML = value"],
    ["db.py", 'cur.execute("SELECT name FROM users WHERE id = 1")'],
    ["index.html", '<form action="/login"></form>'],
    ["cors.js", "res.setHeader('Access-Control-Allow-Origin', '*')"],
  ])("keeps security for %s", (path, content) => {
    expect(availableCategories([file(path, content)])).toEqual(CATEGORIES);
  });

  it("is not fooled by the word author", () => {
    expect(availableCategories([file("a.ts", "export const author = 'x';")])).toEqual(without);
  });

  it("ignores words that only appear in documents", () => {
    expect(availableCategories([file("docs/guide.md", "password secret token"), file("a.ts", "export const a = 1;")])).toEqual(without);
  });
});

describe("planChunks without security", () => {
  const without = CATEGORIES.filter((c) => c !== "security");

  it("keeps the total and spreads questions over the remaining categories", () => {
    const chunks = planChunks(PROFILES.standard, without, 0);
    const all = chunks.flatMap((c) => [...c.choice, ...c.free]);
    expect(chunks.flatMap((c) => c.choice)).toHaveLength(10);
    expect(chunks.flatMap((c) => c.free)).toHaveLength(2);
    expect(all).not.toContain("security");
    expect(new Set(all)).toEqual(new Set(without));
  });
});

describe("choiceCounts", () => {
  it("spreads a remainder over the first categories", () => {
    const counts = choiceCounts(7);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(7);
    expect(counts.reading).toBe(2);
    expect(counts.security).toBe(1);
  });
});

describe("primaryFiles", () => {
  it("gives each chunk a disjoint share that covers every file", () => {
    const paths = ["a", "b", "c", "d", "e"];
    const shares = [0, 1, 2].map((i) => primaryFiles(paths, i, 3));
    expect(shares.flat().sort()).toEqual(paths);
  });

  it("does not restrict files when there is only one chunk", () => {
    expect(primaryFiles(["a", "b"], 0, 1)).toEqual([]);
  });
});

describe("profileFromEnv", () => {
  it("defaults to standard and switches only when asked", () => {
    expect(profileFromEnv(undefined).name).toBe("standard");
    expect(profileFromEnv("whatever").name).toBe("standard");
    expect(profileFromEnv("mini").name).toBe("mini");
    expect(profileFromEnv("FULL").name).toBe("full");
  });

  it("sizes grow from mini to standard to full", () => {
    const total = (p: keyof typeof PROFILES) => PROFILES[p].limits.maxTotalChars;
    expect(total("mini")).toBeLessThan(total("standard"));
    expect(total("standard")).toBeLessThan(total("full"));
  });

  it("mini sends far less code than full", () => {
    expect(PROFILES.mini.limits.maxTotalChars).toBeLessThan(PROFILES.full.limits.maxTotalChars / 4);
    expect(PROFILES.mini.limits.maxFiles).toBeLessThan(PROFILES.full.limits.maxFiles);
  });
});
