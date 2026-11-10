import { describe, expect, it } from "vitest";
import { parseCodeLines, splitForWrapping } from "./codeLines";

describe("splitForWrapping", () => {
  it("leaves ordinary code to wrap at spaces only", () => {
    expect(splitForWrapping("const a = compute(value, options);")).toEqual(["const a = compute(value, options);"]);
  });

  it("allows long tokens to break after punctuation", () => {
    expect(splitForWrapping("options.someVeryLongOptionName.anotherLongPropertyName")).toEqual([
      "options.",
      "someVeryLongOptionName.",
      "anotherLongPropertyName",
    ]);
  });

  it("does not add break points inside a long identifier", () => {
    const name = "aVeryLongUnbrokenIdentifierWithoutPunctuation";
    expect(splitForWrapping(name)).toEqual([name]);
  });

  it("keeps all of the text", () => {
    const text = "return compute(value, options.someVeryLongOptionName.another(argument), more);";
    expect(splitForWrapping(text).join("")).toBe(text);
  });
});

describe("parseCodeLines", () => {
  it("numbers lines from the start of the snippet", () => {
    expect(parseCodeLines("a\nb", 30).map((l) => l.number)).toEqual([30, 31]);
  });

  it("measures indentation and removes it from the text", () => {
    const [line] = parseCodeLines("    return 1;", 1);
    expect(line.indent).toBe(4);
    expect(line.segments.join("")).toBe("return 1;");
  });

  it("counts a tab as two columns", () => {
    expect(parseCodeLines("\t  x", 1)[0].indent).toBe(4);
  });

  it("keeps blank lines", () => {
    expect(parseCodeLines("a\n\nb", 1)[1]).toEqual({ number: 2, indent: 0, segments: [""] });
  });
});
