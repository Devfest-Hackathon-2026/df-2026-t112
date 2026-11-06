import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { FirebaseAuthenticator } from "./auth.js";
import { FirestoreSessionStore, FirestoreStatsStore } from "./store/firestore.js";

// STORE=firestore のとき Firestore に保存する。未指定ならメモリ(ローカル開発用)。
const useFirestore = process.env.STORE === "firestore";
// AUTH=firebase のとき Firebase ID token を検証してログインユーザーを扱う。
const auth = process.env.AUTH === "firebase" ? new FirebaseAuthenticator() : undefined;

const app = createApp({
  auth,
  ...(useFirestore ? { store: new FirestoreSessionStore(), stats: new FirestoreStatsStore() } : {}),
});
const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () =>
  console.log(
    `api listening on :${port} (store: ${useFirestore ? "firestore" : "memory"}, auth: ${auth ? "firebase" : "off"})`,
  ),
);
