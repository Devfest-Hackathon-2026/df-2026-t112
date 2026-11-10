import { Fragment, type CSSProperties } from "react";
import { parseCodeLines } from "../codeLines";

/**
 * コードを行番号つきで表示する。横スクロールしなくて済むように折り返すが、
 * 折り返した部分は字下げを揃え、続きの行だと分かるようにする。
 */
export function CodeBlock({ code, startLine }: { code: string; startLine: number }) {
  const lines = parseCodeLines(code, startLine);
  const digits = String(lines[lines.length - 1]?.number ?? startLine).length;

  return (
    <div className="code-block" style={{ "--digits": digits } as CSSProperties}>
      <code>
        {lines.map((line) => (
          <span key={line.number} className="code-line">
            <span className="code-number" aria-hidden="true">
              {line.number}
            </span>
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
    </div>
  );
}
