# 開発ルール

## ブランチ

`main` に直接コミットしません。`main` から `<種別>/<連番>-<内容>` のブランチを切り、1ブランチ1目的で作業します。

| 種別 | 用途 |
|---|---|
| `docs/` | ドキュメント |
| `chore/` | 環境構築・設定 |
| `feature/` | 機能 |
| `infra/` | デプロイ・クラウド設定 |
| `fix/` | 修正 |

## コミット

`feat:`, `fix:`, `docs:`, `chore:` の接頭辞を付けます。

## 実装順

| # | ブランチ | 内容 |
|---|---|---|
| 0 | `docs/00-spec` | 仕様書 |
| 1 | `chore/01-scaffold` | web / api の雛形 |
| 2 | `feature/02-repo-fetch` | GitHub リポジトリ取得 |
| 3 | `feature/03-question-generation` | Gemini 問題生成 |
| 4 | `feature/04-eval-harness` | 問題品質の検証 CLI |
| 5 | `feature/05-quiz-ui` | 出題・回答 UI |
| 6 | `feature/06-grading` | 採点 |
| 7 | `feature/07-result-view` | 結果表示 |
| 8 | `infra/08-deploy` | Cloud Run / Hosting |
| 9 | `feature/09-firestore-history` | 履歴保存 |
| 10 | `feature/10-github-app-auth` | 非公開リポジトリ・認証 |
| 11 | `feature/11-weakness-analysis` | 苦手分析 |
