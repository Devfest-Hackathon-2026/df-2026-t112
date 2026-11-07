import { describe, expect, it } from "vitest";
import { stripComments } from "./comments.js";

const ts = (code: string) => stripComments("src/a.ts", code);

describe("stripComments (C-like)", () => {
  it("removes line, trailing and block comments, and comment-only lines", () => {
    const out = ts(
      [
        "// この関数は合計を返す",
        "export function add(a: number, b: number) {",
        "  /* 引数を足す",
        "     答え: a + b */",
        "  return a + b; // 合計",
        "}",
      ].join("\n"),
    );
    expect(out).toBe("export function add(a: number, b: number) {\n  return a + b;\n}");
  });

  it("removes JSDoc blocks", () => {
    expect(ts("/**\n * Returns the sum.\n * @param a first\n */\nconst x = 1;")).toBe("const x = 1;");
  });

  it("keeps comment markers that are inside strings", () => {
    const code = [
      'const url = "http://example.com/a//b";',
      "const css = '/* not a comment */';",
      "const tpl = `// still text ${x}`;",
      "const color = '#fff';",
    ].join("\n");
    expect(ts(code)).toBe(code);
  });

  it("is not confused by quotes and escapes", () => {
    const code = 'const s = "she said \\"hi\\" // not a comment"; // real comment';
    expect(ts(code)).toBe('const s = "she said \\"hi\\" // not a comment";');
  });

  it("keeps a multi-line template literal intact", () => {
    const code = "const t = `line1\n// inside\nline3`;\n// gone";
    expect(ts(code)).toBe("const t = `line1\n// inside\nline3`;");
  });

  it("does not lose code after an unterminated quote (e.g. an apostrophe in JSX text)", () => {
    const out = ts("<p>Don't do this</p>\nconst a = 1; // c");
    expect(out).toContain("<p>Don't do this</p>");
    expect(out).toContain("const a = 1;");
  });

  it("collapses the blank lines that removal leaves behind", () => {
    expect(ts("const a = 1;\n\n// x\n\n\nconst b = 2;")).toBe("const a = 1;\n\nconst b = 2;");
  });

  it("does not treat # as a comment in C-like languages", () => {
    const code = "#include <stdio.h>\nint main() {}";
    expect(stripComments("a.c", code)).toBe(code);
  });
});

describe("stripComments (other languages)", () => {
  it("handles Python comments and docstrings", () => {
    const code = [
      '"""モジュールの説明"""',
      "# 設定",
      "def f(x):",
      '    """x を 2 倍にして返す"""',
      "    return x * 2  # 2倍",
      "",
      'TEXT = """これはデータ"""',
      'tag = "#not-a-comment"',
    ].join("\n");
    expect(stripComments("a.py", code)).toBe(
      ['def f(x):', "    return x * 2", "", 'TEXT = """これはデータ"""', 'tag = "#not-a-comment"'].join("\n"),
    );
  });

  it("handles CSS, SQL, Lua and HTML", () => {
    expect(stripComments("a.css", "/* ヘッダ */\na { color: red; } /* 赤 */")).toBe("a { color: red; }");
    expect(stripComments("a.sql", "-- 注釈\nSELECT 1; /* x */")).toBe("SELECT 1;");
    expect(stripComments("a.lua", "-- 注釈\nlocal a = 1 --[[ x ]]")).toBe("local a = 1");
    expect(stripComments("a.html", "<!-- 秘密 -->\n<p>http://example.com</p>")).toBe("<p>http://example.com</p>");
  });

  it("handles shell and Ruby '#' comments", () => {
    expect(stripComments("a.sh", "#!/bin/sh\n# 注釈\necho hi # x")).toBe("echo hi");
    expect(stripComments("a.rb", "# 注釈\nputs 'a#b'")).toBe("puts 'a#b'");
  });

  it("leaves unsupported files untouched", () => {
    const md = "# 見出し\n<!-- メモ -->";
    expect(stripComments("README.md", md)).toBe(md);
    expect(stripComments("package.json", '{"a": "// x"}')).toBe('{"a": "// x"}');
    expect(stripComments("Dockerfile", "# base\nFROM node")).toBe("# base\nFROM node");
  });

  it("is idempotent and normalises CRLF", () => {
    const once = ts("// a\r\nconst a = 1; // b\r\n");
    expect(once).toBe("const a = 1;");
    expect(ts(once)).toBe(once);
  });
});
