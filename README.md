# diet-ai-app

LINE ボット（ダイエット伴走）+ Next.js + Supabase。

## 本番デプロイ（まずここ）

**ローカルを使わず本番だけで動かす手順**は次のドキュメントにまとめています。

→ **[docs/本番デプロイ.md](./docs/本番デプロイ.md)**

- Vercel の環境変数（`REMIND_SECRET` / `CRON_SECRET` 含む）
- LINE Webhook URL
- 生理リマインド（Vercel Cron と Supabase のどちらか一方）

## 開発サーバー（任意）

```bash
npm run dev
```

## 技術スタック

Next.js、LINE Messaging API、OpenAI、Supabase。

詳細は [Next.js Documentation](https://nextjs.org/docs) を参照。
