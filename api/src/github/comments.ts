type Syntax = {
  line: string[];
  block: [open: string, close: string][];
  /** 1 行で閉じる文字列(閉じずに改行したら、そこで終わりとみなす)。 */
  quotes: string[];
  /** 複数行にまたがる文字列(JS のテンプレートリテラルなど)。 */
  multilineQuotes: string[];
  /** Python の三連引用符(def / class 直後や先頭の三連引用符は docstring としてコメント扱い)。 */
  triple: boolean;
};

const C_LIKE: Syntax = {
  line: ["//"],
  block: [["/*", "*/"]],
  quotes: ["'", '"'],
  multilineQuotes: ["`"],
  triple: false,
};
const HASH: Syntax = { line: ["#"], block: [], quotes: ["'", '"'], multilineQuotes: [], triple: false };

const BY_EXTENSION: Record<string, Syntax> = {
  ...Object.fromEntries(
    ["ts", "tsx", "js", "jsx", "mjs", "cjs", "java", "kt", "cs", "cpp", "cc", "c", "h", "hpp", "swift", "go", "rs", "dart", "scss", "shader", "hlsl"].map(
      (e) => [e, C_LIKE],
    ),
  ),
  php: { ...C_LIKE, line: ["//", "#"] },
  css: { line: [], block: [["/*", "*/"]], quotes: ["'", '"'], multilineQuotes: [], triple: false },
  py: { ...HASH, triple: true },
  rb: HASH,
  sh: HASH,
  gd: HASH,
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: ["'", '"'], multilineQuotes: [], triple: false },
  lua: { line: ["--"], block: [["--[[", "]]"]], quotes: ["'", '"'], multilineQuotes: [], triple: false },
  // マークアップは文字列(属性値)の外に URL が出るので、<!-- --> だけを扱う
  html: { line: [], block: [["<!--", "-->"]], quotes: [], multilineQuotes: [], triple: false },
  vue: { line: [], block: [["<!--", "-->"]], quotes: [], multilineQuotes: [], triple: false },
  svelte: { line: [], block: [["<!--", "-->"]], quotes: [], multilineQuotes: [], triple: false },
};

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * ソースコードからコメントを取り除く。
 *
 * コメントに答えが書かれていて、出題の意味がなくなるのを防ぐための処理。
 * 文字列の中身は壊さない。判断に迷う場合(正規表現リテラルなど)は、コードを消さずコメントを残す側に倒す。
 * 対応していない種類のファイル(Markdown、JSON など)はそのまま返す。
 */
export function stripComments(path: string, content: string): string {
  const syntax = BY_EXTENSION[extensionOf(path)];
  if (!syntax) return content;

  const src = content.replace(/\r\n?/g, "\n");
  const lines: string[] = [];
  let cur = "";
  let removedOnLine = false;

  const endLine = () => {
    // コメントだけだった行は、行ごと消す
    if (!(cur.trim() === "" && removedOnLine)) lines.push(cur.replace(/[ \t]+$/, ""));
    cur = "";
    removedOnLine = false;
  };

  const startsWith = (s: string, at: number) => src.startsWith(s, at);
  const blocks = [...syntax.block].sort((a, b) => b[0].length - a[0].length);
  const lineOpeners = [...syntax.line].sort((a, b) => b.length - a.length);

  /** Python の docstring として扱ってよい位置か(行頭で、直前が def/class の行末 ":" またはファイル先頭)。 */
  const atDocstringPosition = () => {
    if (cur.trim() !== "") return false;
    const prev = [...lines].reverse().find((l) => l.trim() !== "");
    return prev === undefined || prev.trimEnd().endsWith(":");
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\n") {
      endLine();
      i++;
      continue;
    }

    // ブロックコメント
    const block = blocks.find(([open]) => startsWith(open, i));
    if (block) {
      const end = src.indexOf(block[1], i + block[0].length);
      i = end < 0 ? src.length : end + block[1].length;
      removedOnLine = true;
      continue;
    }

    // 行コメント
    if (lineOpeners.some((open) => startsWith(open, i))) {
      while (i < src.length && src[i] !== "\n") i++;
      removedOnLine = true;
      continue;
    }

    // Python の三連引用符
    if (syntax.triple && (startsWith('"""', i) || startsWith("'''", i))) {
      const q = src.slice(i, i + 3);
      const end = src.indexOf(q, i + 3);
      const stop = end < 0 ? src.length : end + 3;
      if (atDocstringPosition()) {
        i = stop;
        removedOnLine = true;
      } else {
        // docstring ではない文字列はそのまま残す(改行ごとに行を区切る)
        const parts = src.slice(i, stop).split("\n");
        parts.forEach((part, k) => {
          cur += part;
          if (k < parts.length - 1) endLine();
        });
        i = stop;
      }
      continue;
    }

    // 文字列
    const quote = syntax.quotes.find((q) => ch === q) ?? syntax.multilineQuotes.find((q) => ch === q);
    if (quote) {
      const multiline = syntax.multilineQuotes.includes(quote);
      cur += ch;
      i++;
      while (i < src.length) {
        const c = src[i];
        if (c === "\\" && i + 1 < src.length) {
          if (src[i + 1] === "\n") {
            cur += c;
            endLine();
          } else {
            cur += c + src[i + 1];
          }
          i += 2;
          continue;
        }
        if (c === quote) {
          cur += c;
          i++;
          break;
        }
        if (c === "\n") {
          if (!multiline) break; // 閉じていない文字列。そこで終わりとみなす
          endLine();
          i++;
          continue;
        }
        cur += c;
        i++;
      }
      continue;
    }

    cur += ch;
    i++;
  }
  endLine();

  // 連続する空行を 1 行にまとめ、先頭・末尾の空行を落とす
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}
