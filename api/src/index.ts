import { serve } from "@hono/node-server";

// ローカル開発用に、リポジトリ直下の .env を読む。無ければ何もしない(本番は環境変数を直接設定する)
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // .env が無い
}

import { createApp } from "./app.js";
import { authFromEnv, parseAllowlist } from "./auth.js";
import { parsePrivateRepos } from "./privateRepos.js";
import { FirestoreMistakeStore, FirestoreSessionStore, FirestoreStatsStore } from "./store/firestore.js";

// STORE=firestore のとき Firestore に保存する。未指定ならメモリ(ローカル開発用)。
const useFirestore = process.env.STORE === "firestore";
// AUTH=firebase のとき Firebase ID token を検証する。未指定なら開発用で、全員を同じユーザーとして扱う。
const auth = authFromEnv();
const allowed = parseAllowlist(process.env.ALLOWED_GITHUB_IDS);
if (auth && allowed.size === 0) console.warn("ALLOWED_GITHUB_IDS が空なので、誰もログインして使えません");
// PRIVATE_REPOS=on のときだけ、ログインした人の非公開リポジトリも読む(Gemini を有料枠にするまでは付けない。#34 の D26)
const privateRepos = parsePrivateRepos(process.env.PRIVATE_REPOS);

const app = createApp({
  auth,
  allowed,
  privateRepos,
  ...(useFirestore ? { store: new FirestoreSessionStore(), stats: new FirestoreStatsStore(), mistakes: new FirestoreMistakeStore() } : {}),
});
const port = Number(process.env.PORT ?? 8080);
const authLabel = auth ? `firebase, allowed: ${allowed.size}` : "dev";
serve({ fetch: app.fetch, port }, () =>
  console.log(
    `api listening on :${port} (store: ${useFirestore ? "firestore" : "memory"}, auth: ${authLabel}, private repos: ${privateRepos ? "on" : "off"})`,
  ),
);
