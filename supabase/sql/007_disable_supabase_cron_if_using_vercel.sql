-- Vercel Cron（vercel.json）で /api/remind を叩く場合、
-- 004 で登録した Supabase pg_cron と二重送信になるので、こちらで止める。
-- Supabase SQL Editor で実行。

select cron.unschedule('daily-period-remind');
