export type RepoRef = { owner: string; repo: string };

export class RepoError extends Error {
  constructor(
    public code:
      | "invalid_url"
      | "not_found"
      | "private"
      | "rate_limited"
      | "empty"
      | "upstream"
      | "no_authored"
      | "token_required"
      /** GitHub がトークンを受け付けなかった(ログインした人のトークンは 8 時間で切れる)。 */
      | "unauthorized",
    message: string,
  ) {
    super(message);
  }
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** github.com のリポジトリ URL だけを受け付ける。 */
export function parseRepoUrl(input: string): RepoRef {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new RepoError("invalid_url", "URL の形式が正しくありません");
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new RepoError("invalid_url", "github.com のリポジトリ URL のみ指定できます");
  }
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || !OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new RepoError("invalid_url", "owner/repo 形式の URL を指定してください");
  }
  return { owner, repo };
}
