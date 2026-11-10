import { describe, expect, it } from "vitest";
import { RETENTION_MS, forgetQuiz, lastQuiz, rememberQuiz } from "./persist";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("last quiz", () => {
  it("remembers only the quiz id, per signed-in user", () => {
    const storage = memoryStorage();
    rememberQuiz("alice", "s1", storage, 1000);
    expect(lastQuiz("alice", storage, 2000)).toBe("s1");
    // 別の人には返さない(共有の端末で、次の人が前の人のクイズを開こうとしない)
    expect(lastQuiz("bob", storage, 2000)).toBeNull();
    // クイズの中身や回答は入れない
    expect([...storage.data.values()].join()).not.toContain("question");
  });

  it("forgets it after the server's retention period", () => {
    const storage = memoryStorage();
    rememberQuiz("alice", "s1", storage, 0);
    expect(lastQuiz("alice", storage, RETENTION_MS - 1)).toBe("s1");
    expect(lastQuiz("alice", storage, RETENTION_MS)).toBeNull();
  });

  it("forgets it on request (logout or starting over)", () => {
    const storage = memoryStorage();
    rememberQuiz("alice", "s1", storage);
    forgetQuiz(storage);
    expect(lastQuiz("alice", storage)).toBeNull();
  });

  it("removes the old saved quiz that held questions and answers", () => {
    const storage = memoryStorage();
    storage.setItem("evc:progress", JSON.stringify({ session: { sessionId: "old", questions: [] }, answers: {}, savedAt: 1 }));
    expect(lastQuiz("alice", storage)).toBeNull();
    expect(storage.data.has("evc:progress")).toBe(false);
  });

  it("ignores corrupted data and keeps working when storage is unavailable or throws", () => {
    const storage = memoryStorage();
    storage.setItem("evc:last-quiz", "{not json");
    expect(lastQuiz("alice", storage)).toBeNull();
    storage.setItem("evc:last-quiz", JSON.stringify({ uid: "alice" }));
    expect(lastQuiz("alice", storage)).toBeNull();

    expect(lastQuiz("alice", null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => rememberQuiz("alice", "s1", broken)).not.toThrow();
    expect(lastQuiz("alice", broken)).toBeNull();
    expect(() => forgetQuiz(broken)).not.toThrow();
  });
});
