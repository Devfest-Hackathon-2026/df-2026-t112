import { LIMITS, selectFiles, type TreeEntry } from "./filter.js";
import { RepoError, parseRepoUrl } from "./url.js";

export type RepoFile = { path: string; content: string };
export type RepoSnapshot = {
  owner: string;
  repo: string;
  branch: string;
  description: string | null;
  files: RepoFile[];
  skipped: number;
};

export type FetchOptions = {
  /** GitHub App の installation token など。指定時は非公開リポジトリも読める。 */
  token?: string;
  fetchImpl?: typeof fetch;
};

const API = "https://api.github.com";

export async function fetchRepoSnapshot(urlInput: string, opts: FetchOptions = {}): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(urlInput);
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "User-Agent": "evc-app", Accept: "application/vnd.github+json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const getJson = async <T>(path: string): Promise<T> => {
    const res = await f(`${API}${path}`, { headers });
    if (res.status === 404) throw new RepoError("not_found", "リポジトリが見つかりません(非公開の可能性もあります)");
    if (res.status === 403 || res.status === 429) {
      throw new RepoError("rate_limited", "GitHub API の制限に達しました。しばらくしてから再度お試しください");
    }
    if (!res.ok) throw new RepoError("upstream", `GitHub API エラー (${res.status})`);
    return (await res.json()) as T;
  };

  const meta = await getJson<{ default_branch: string; description: string | null; private: boolean }>(
    `/repos/${owner}/${repo}`,
  );
  if (meta.private && !opts.token) throw new RepoError("private", "非公開リポジトリは対応していません");

  const tree = await getJson<{ tree: { path: string; type: string; size?: number }[] }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`,
  );
  const entries: TreeEntry[] = tree.tree
    .filter((t) => t.type === "blob")
    .map((t) => ({ path: t.path, size: t.size ?? 0 }));
  const { selected, skipped } = selectFiles(entries);
  if (selected.length === 0) throw new RepoError("empty", "解析できるソースコードが見つかりませんでした");

  const branch = encodeURIComponent(meta.default_branch);
  const fetchContent = async (path: string): Promise<string> => {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = opts.token
      ? await f(`${API}/repos/${owner}/${repo}/contents/${encoded}?ref=${branch}`, {
          headers: { ...headers, Accept: "application/vnd.github.raw+json" },
        })
      : await f(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encoded}`);
    if (!res.ok) throw new RepoError("upstream", `ファイル取得に失敗しました: ${path}`);
    return (await res.text()).slice(0, LIMITS.maxCharsPerFile);
  };

  const files = await Promise.all(selected.map(async (e) => ({ path: e.path, content: await fetchContent(e.path) })));
  return { owner, repo, branch: meta.default_branch, description: meta.description, files, skipped };
}
