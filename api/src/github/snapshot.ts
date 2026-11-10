import { stripComments } from "./comments.js";
import { LIMITS, measureSource, selectFiles, type Limits, type RepoSize, type TreeEntry } from "./filter.js";
import { RepoError, parseRepoUrl } from "./url.js";

export type RepoFile = { path: string; content: string };
export type LineRange = { start: number; end: number };

export type RepoSnapshot = {
  owner: string;
  repo: string;
  branch: string;
  description: string | null;
  files: RepoFile[];
  skipped: number;
  /** 切り詰める前の、本体のコードの総量。 */
  size?: RepoSize;
  /** 特定の人が書いたコードから出題するときの、その人の行(ファイルごと)。 */
  authored?: Record<string, LineRange[]>;
};

export type FetchOptions = {
  /** API 認証用トークン。レート制限の緩和や、ユーザー本人のトークンでの取得に使う。 */
  token?: string;
  /**
   * 非公開リポジトリを許可するか。token があるだけでは許可しない
   * (サーバー側の共有トークンで他人に非公開リポジトリを読ませないため)。
   */
  allowPrivate?: boolean;
  /** AI に渡すコードの上限。未指定なら標準(40 ファイル・12 万文字)。関数なら、リポジトリの規模から決める。 */
  limits?: Limits | ((size: RepoSize) => Limits);
  fetchImpl?: typeof fetch;
};

export type RepoCheck = { owner: string; repo: string; description: string | null };

type RepoMeta = { default_branch: string; description: string | null; private: boolean };

const API = "https://api.github.com";

/** GitHub がトークンを受け付けなかった。ログインした人のトークンなら、期限切れ(8 時間)のことが多い。 */
export const unauthorized = () => new RepoError("unauthorized", "GitHub の認証に失敗しました(トークンの期限切れなど)");

export function githubClient(opts: FetchOptions) {
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "User-Agent": "evc-app", Accept: "application/vnd.github+json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const getJson = async <T>(path: string): Promise<T> => {
    const res = await f(`${API}${path}`, { headers });
    // 権限のない非公開リポジトリにも GitHub は 404 を返すので、ここでは「存在しない」と区別できない
    if (res.status === 404) throw new RepoError("not_found", "リポジトリが見つかりません(非公開の可能性もあります)");
    if (res.status === 401) throw unauthorized();
    if (res.status === 403 || res.status === 429) {
      throw new RepoError("rate_limited", "GitHub API の制限に達しました。しばらくしてから再度お試しください");
    }
    if (!res.ok) throw new RepoError("upstream", `GitHub API エラー (${res.status})`);
    // 空のリポジトリなどは 204 で本文が無い
    if (res.status === 204) return [] as T;
    return (await res.json()) as T;
  };

  const getMeta = async (owner: string, repo: string): Promise<RepoMeta> => {
    const meta = await getJson<RepoMeta>(`/repos/${owner}/${repo}`);
    if (meta.private && !opts.allowPrivate) throw new RepoError("private", "非公開リポジトリです。GitHub でログインし直すと読めます");
    return meta;
  };

  const getFile = async (owner: string, repo: string, branch: string, path: string): Promise<string> => {
    const ref = encodeURIComponent(branch);
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = opts.token
      ? await f(`${API}/repos/${owner}/${repo}/contents/${encoded}?ref=${ref}`, {
          headers: { ...headers, Accept: "application/vnd.github.raw+json" },
        })
      : await f(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encoded}`);
    if (res.status === 401) throw unauthorized();
    if (!res.ok) throw new RepoError("upstream", `ファイル取得に失敗しました: ${path}`);
    return res.text();
  };

  return { f, headers, getJson, getMeta, getFile };
}

/** ファイルは取得せず、リポジトリを読めるかどうかだけを確かめる(入力欄の即時チェック用)。 */
export async function checkRepo(urlInput: string, opts: FetchOptions = {}): Promise<RepoCheck> {
  const { owner, repo } = parseRepoUrl(urlInput);
  const meta = await githubClient(opts).getMeta(owner, repo);
  return { owner, repo, description: meta.description };
}

export async function fetchRepoSnapshot(urlInput: string, opts: FetchOptions = {}): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(urlInput);
  const { getJson, getMeta, getFile } = githubClient(opts);

  const meta = await getMeta(owner, repo);

  const tree = await getJson<{ tree: { path: string; type: string; size?: number }[] }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`,
  );
  const entries: TreeEntry[] = tree.tree
    .filter((t) => t.type === "blob")
    .map((t) => ({ path: t.path, size: t.size ?? 0 }));
  const size = measureSource(entries);
  const limits = typeof opts.limits === "function" ? opts.limits(size) : (opts.limits ?? LIMITS);
  const { selected, skipped } = selectFiles(entries, limits);
  if (selected.length === 0) throw new RepoError("empty", "解析できるソースコードが見つかりませんでした");

  const fetchContent = async (path: string): Promise<string> =>
    // コメントに答えが書かれていることがあるため、画面にも AI にも渡す前に除く(行番号は除去後のもの)
    stripComments(path, await getFile(owner, repo, meta.default_branch, path)).slice(0, limits.maxCharsPerFile);

  const files = await Promise.all(selected.map(async (e) => ({ path: e.path, content: await fetchContent(e.path) })));
  return { owner, repo, branch: meta.default_branch, description: meta.description, files, skipped, size };
}
