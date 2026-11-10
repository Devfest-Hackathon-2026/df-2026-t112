import { describe, expect, it } from "vitest";
import { parseRichText } from "./richText";

describe("parseRichText", () => {
  it("leaves plain text alone", () => {
    expect(parseRichText("普通の文章")).toEqual([{ type: "text", value: "普通の文章" }]);
  });

  it("finds inline code", () => {
    expect(parseRichText("`a.b()` は何?")).toEqual([
      { type: "inline", value: "a.b()" },
      { type: "text", value: " は何?" },
    ]);
  });

  it("finds a fenced block and drops the language and surrounding newlines", () => {
    expect(parseRichText("前の文\n```js\nconst a = 1;\nconst b = 2;\n```\n後の文")).toEqual([
      { type: "text", value: "前の文" },
      { type: "code", value: "const a = 1;\nconst b = 2;" },
      { type: "text", value: "後の文" },
    ]);
  });

  it("keeps indentation inside a fenced block", () => {
    expect(parseRichText("```\n  x\n```")).toEqual([{ type: "code", value: "  x" }]);
  });

  it("does not treat an unclosed backtick as code", () => {
    expect(parseRichText("a ` b")).toEqual([{ type: "text", value: "a ` b" }]);
  });

  it("does not let inline code span lines", () => {
    expect(parseRichText("`a\nb`")).toEqual([{ type: "text", value: "`a\nb`" }]);
  });

  it("handles several pieces of inline code", () => {
    expect(parseRichText("`a` と `b`").map((p) => p.type)).toEqual(["inline", "text", "inline"]);
  });
});
