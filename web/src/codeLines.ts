export type CodeLine = {
  /** 元のファイルの行番号。 */
  number: number;
  /** 行頭の字下げの幅(文字数)。タブは 2 文字で数える。 */
  indent: number;
  /** 字下げを除いた本文。折り返してよい位置で分けてある。 */
  segments: string[];
};

/** これより長い、空白を含まないかたまりは、記号の後で折り返せるようにする。 */
const LONG_TOKEN = 24;

/**
 * 折り返してよい位置で本文を分ける。普段は空白でしか折り返さない。
 * 長いかたまりだけ記号の後でも折り返せるようにして、識別子の途中で切れないようにする。
 */
export function splitForWrapping(text: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (const token of text.split(/(\s+)/)) {
    if (token.length < LONG_TOKEN) {
      current += token;
      continue;
    }
    const parts = token.split(/(?<=[.,(\[{/=&|:;+])/);
    parts.forEach((part, i) => {
      current += part;
      if (i < parts.length - 1) {
        segments.push(current);
        current = "";
      }
    });
  }
  segments.push(current);
  return segments;
}

export function parseCodeLines(code: string, startLine: number): CodeLine[] {
  return code.split("\n").map((raw, i) => {
    const leading = raw.match(/^[ \t]*/)?.[0] ?? "";
    const indent = [...leading].reduce((n, c) => n + (c === "\t" ? 2 : 1), 0);
    return { number: startLine + i, indent, segments: splitForWrapping(raw.slice(leading.length)) };
  });
}
