import { Fragment, type CSSProperties } from "react";
import { parseCodeLines } from "../codeLines";

/**
 * コードを表示する。横スクロールしなくて済むように折り返すが、
 * 折り返した部分は字下げを揃え、続きの行だと分かるようにする。
 * startLine を渡すと行番号を付ける。見出しやボタンの中でも使えるよう、span だけで組み立てる。
 */
export function CodeBlock({ code, startLine }: { code: string; startLine?: number }) {
  const lines = parseCodeLines(code, startLine ?? 1);
  const digits = String(lines[lines.length - 1]?.number ?? 1).length;

  return (
    <span className="code-block" style={{ "--digits": digits } as CSSProperties}>
      <code>
        {lines.map((line) => (
          <span key={line.number} className="code-line">
            {startLine !== undefined && (
              <span className="code-number" aria-hidden="true">
                {line.number}
              </span>
            )}
            <span className="code-text" style={{ "--indent": line.indent } as CSSProperties}>
              {line.segments.map((segment, i) => (
                <Fragment key={i}>
                  {i > 0 && <wbr />}
                  {segment}
                </Fragment>
              ))}
            </span>
          </span>
        ))}
      </code>
    </span>
  );
}
