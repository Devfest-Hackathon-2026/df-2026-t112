# EVC (Escape VibeCoder)

AI に作らせたコードを「作っただけ」で終わらせないための理解度チェック Web アプリ。

GitHub の公開リポジトリ URL を渡すと、Gemini がそのコードを読んで問題を作ります。回答すると、コードをどれだけ理解しているかがスコアで分かります。

- 仕様: [docs/spec.md](docs/spec.md)
- 開発ルール: [docs/workflow.md](docs/workflow.md)

## 技術スタック

| 領域 | 採用 |
|---|---|
| フロント | React + Vite + TypeScript(`/web`) |
| API | Hono + TypeScript、Cloud Run(`/api`) |
| AI | Gemini |
| データ | Firestore |
| 認証 | Firebase Auth(MVP 後) |
| 配信 | Firebase Hosting |
| 秘密情報 | Secret Manager |
