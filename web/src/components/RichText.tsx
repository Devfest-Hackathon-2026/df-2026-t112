import { Fragment } from "react";
import { splitForWrapping } from "../codeLines";
import { parseRichText } from "../richText";
import { CodeBlock } from "./CodeBlock";

/** AI が書いた文章を表示する。文中のコードはコードとして表示し、長くても記号の後で折り返す。 */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {parseRichText(text).map((part, i) => {
        if (part.type === "code") return <CodeBlock key={i} code={part.value} />;
        if (part.type === "inline") {
          return (
            <code key={i} className="inline-code">
              {splitForWrapping(part.value).map((segment, j) => (
                <Fragment key={j}>
                  {j > 0 && <wbr />}
                  {segment}
                </Fragment>
              ))}
            </code>
          );
        }
        return <Fragment key={i}>{part.value}</Fragment>;
      })}
    </>
  );
}
