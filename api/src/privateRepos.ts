import type { RepoError } from "./github/url.js";

/**
 * 非公開リポジトリを読むか(環境変数 PRIVATE_REPOS)。on のときだけ読む。
 * Gemini の無料枠では、送ったコードが Google の AI の学習に使われ、人が読むこともある。
 * そのため、有料枠にするまでは本番で付けない(#34 の D26)。値を間違えたときは、読まない側に倒す。
 */
export function parsePrivateRepos(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "on";
}

/**
 * GitHub から読むときの設定。ログインした人の GitHub トークンがあれば、それで読む(GitHub の回数の制限が人ごとになる)。
 * 非公開リポジトリは、本人のトークンで、しかも privateRepos のときだけ読む。
 * サーバーの共有トークンでは読まない(他人に非公開リポジトリを読ませないため)。
 */
export function githubAccess(userToken: string | undefined, privateRepos: boolean, serverToken: string | undefined) {
  return userToken ? { token: userToken, allowPrivate: privateRepos } : { token: serverToken };
}

/** 非公開リポジトリを読まない設定のときの説明。ログインし直しても、GitHub で許可しても読めないことを伝える。 */
const WHEN_PRIVATE_OFF: Partial<Record<RepoError["code"], string>> = {
  not_found: "リポジトリが見つかりません(非公開リポジトリには、まだ対応していません)",
  private: "非公開リポジトリには、まだ対応していません",
};

/** 画面に返す、リポジトリを読めなかった理由。 */
export function repoErrorMessage(err: RepoError, privateRepos: boolean): string {
  return (!privateRepos && WHEN_PRIVATE_OFF[err.code]) || err.message;
}
