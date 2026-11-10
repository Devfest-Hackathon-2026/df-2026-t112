import { describe, expect, it } from "vitest";
import { quizIdFrom, urlWithQuiz } from "./quizUrl";

describe("quiz id in the URL", () => {
  it("reads the quiz id", () => {
    expect(quizIdFrom("?quiz=3f2a9c1e-1b2c-4d5e-8f90-0123456789ab")).toBe("3f2a9c1e-1b2c-4d5e-8f90-0123456789ab");
    expect(quizIdFrom("?a=1&quiz=abc")).toBe("abc");
  });

  it("ignores a missing or strange id", () => {
    expect(quizIdFrom("")).toBeNull();
    expect(quizIdFrom("?quiz=")).toBeNull();
    expect(quizIdFrom("?quiz=../../etc")).toBeNull();
    expect(quizIdFrom(`?quiz=${"a".repeat(65)}`)).toBeNull();
  });

  it("sets and removes the id, keeping the rest of the URL", () => {
    expect(urlWithQuiz("http://localhost:5173/?a=1#top", "s1")).toBe("/?a=1&quiz=s1#top");
    expect(urlWithQuiz("http://localhost:5173/?quiz=s1&a=1", "s2")).toBe("/?quiz=s2&a=1");
    expect(urlWithQuiz("http://localhost:5173/?quiz=s1", null)).toBe("/");
  });
});
