export type RichPart = { type: "text" | "inline" | "code"; value: string };

/** AI が書く ```コード``` と `コード` の位置で、文章を分ける。閉じていない記号は普通の文字として扱う。 */
export function parseRichText(text: string): RichPart[] {
  const parts: RichPart[] = [];
  const pushText = (value: string) => {
    if (value !== "") parts.push({ type: "text", value });
  };

  let last = 0;
  for (const match of text.matchAll(/```[^\n`]*\n?([\s\S]*?)```|`([^`\n]+)`/g)) {
    const before = text.slice(last, match.index);
    last = match.index + match[0].length;
    if (match[1] !== undefined) {
      // コードのかたまりは独立して表示するので、前後の改行は要らない
      pushText(before.replace(/\n+$/, ""));
      parts.push({ type: "code", value: match[1].replace(/\n+$/, "") });
      const rest = text.slice(last).match(/^\n+/);
      if (rest) last += rest[0].length;
    } else {
      pushText(before);
      parts.push({ type: "inline", value: match[2] });
    }
  }
  pushText(text.slice(last));
  return parts;
}
