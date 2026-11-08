import { describe, expect, it } from "vitest";
import { isAnswered, startIndex, unansweredIndexes } from "./quizNav";
import type { PublicQuestion } from "./types";

const q = (id: string, type: "choice" | "free"): PublicQuestion => ({
  id,
  type,
  category: "reading",
  difficulty: 1,
  question: id,
  codeRef: { path: "a.ts", startLine: 1, endLine: 2 },
  snippet: "",
  choices: type === "choice" ? ["A", "B"] : [],
  hint: "",
});

const questions = [q("a", "choice"), q("b", "free"), q("c", "choice")];

describe("isAnswered", () => {
  it("treats the first choice as answered", () => {
    expect(isAnswered(questions[0], { choice: 0 })).toBe(true);
    expect(isAnswered(questions[0], undefined)).toBe(false);
  });

  it("ignores blank free text", () => {
    expect(isAnswered(questions[1], { text: "   " })).toBe(false);
    expect(isAnswered(questions[1], { text: "説明" })).toBe(true);
  });
});

describe("unansweredIndexes", () => {
  it("lists unanswered questions in order", () => {
    expect(unansweredIndexes(questions, { b: { text: "説明" } })).toEqual([0, 2]);
  });
});

describe("startIndex", () => {
  it("starts at the first question when nothing is answered", () => {
    expect(startIndex(questions, {})).toBe(0);
  });

  it("resumes at the first unanswered question, even with gaps", () => {
    expect(startIndex(questions, { a: { choice: 1 }, c: { choice: 0 } })).toBe(1);
  });

  it("opens the last question when everything is answered", () => {
    expect(startIndex(questions, { a: { choice: 1 }, b: { text: "説明" }, c: { choice: 0 } })).toBe(2);
  });

  it("handles an empty quiz", () => {
    expect(startIndex([], {})).toBe(0);
  });
});
