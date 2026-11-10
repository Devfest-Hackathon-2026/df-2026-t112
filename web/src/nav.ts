/**
 * ブラウザの履歴に記録する画面。URL は変えず、履歴の state にだけ持つ。
 * app は、回答中のクイズか結果の画面(中身は保存した進行状況から決める)。
 */
export type Screen = "input" | "app" | "mistakes";

/** 間違えた問題フォルダの中で開いている問題。again は解決済みの問題の解き直し。 */
export type ReviewRef = { id: string; again: boolean };

type Entry = { screen: Screen; review?: ReviewRef };
type HistoryLike = Pick<History, "state" | "pushState" | "replaceState">;

const SCREENS: readonly unknown[] = ["input", "app", "mistakes"];

function readEntry(state: unknown): Entry | null {
  const screen = (state as Partial<Entry> | null)?.screen;
  return SCREENS.includes(screen) ? (state as Entry) : null;
}

export const currentScreen = (): Screen | undefined => readEntry(window.history.state)?.screen;

export const currentReview = (): ReviewRef | null => readEntry(window.history.state)?.review ?? null;

export function pushScreen(screen: Screen, review?: ReviewRef): void {
  window.history.pushState({ screen, review }, "");
}

/**
 * アプリを開いたときの画面を決める。再読み込みなら履歴に残っている画面のまま。
 * URL を打って開いたときは、続きのクイズがあっても入口から始める。画面を押す前にスクリプトで足した
 * 履歴は Chrome の戻るで飛ばされるので、下に入口を差し込んでも前のサイトに戻ってしまうため。
 */
export function enterApp(history: HistoryLike = window.history): Screen {
  const entry = readEntry(history.state);
  if (entry) return entry.screen;
  history.replaceState({ screen: "input" }, "");
  return "input";
}
