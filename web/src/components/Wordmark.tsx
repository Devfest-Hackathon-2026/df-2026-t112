/** サービス名のロゴ。 */
export function Wordmark({ large }: { large?: boolean }) {
  return <span className={large ? "wordmark large" : "wordmark"}>EVC</span>;
}
