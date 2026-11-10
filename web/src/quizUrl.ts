/**
 * 開いているクイズの ID を URL(?quiz=...)に入れる。再読み込みしても、タブごとに自分のクイズを
 * サーバーから読み直せる(#32)。ID を知っていても、中身は本人にしか返さない。
 */
const PARAM = "quiz";

/** URL のクイズの ID。無いか、形が違えば null。 */
export function quizIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get(PARAM);
  return id && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;
}

/** クイズの ID を入れた(null なら外した)URL。ほかの部分はそのまま残す。 */
export function urlWithQuiz(href: string, id: string | null): string {
  const url = new URL(href);
  if (id) url.searchParams.set(PARAM, id);
  else url.searchParams.delete(PARAM);
  return url.pathname + url.search + url.hash;
}

/** 今の URL を書き換える。履歴は増やさない(戻るボタンの動きは今のまま)。 */
export function showQuizInUrl(id: string | null): void {
  try {
    window.history.replaceState(window.history.state, "", urlWithQuiz(window.location.href, id));
  } catch {
    // 書き換えられなくても、クイズは続けられる
  }
}
