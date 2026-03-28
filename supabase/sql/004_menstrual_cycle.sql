-- 生理周期トラッキング セットアップ
-- Supabase SQL Editor で実行してください。
-- ※ pg_cron のスケジュール設定の REMIND_SECRET_VALUE は実際の値に書き換えてから実行してください。

-- 生理周期記録テーブル
create table if not exists public.menstrual_cycles (
  id           bigserial primary key,
  line_user_id text not null references public.users(line_user_id) on delete cascade,
  start_date   date not null,
  end_date     date,
  created_at   timestamptz default now()
);

create index if not exists menstrual_cycles_user_idx
  on public.menstrual_cycles(line_user_id, start_date desc);

-- RLS
alter table public.menstrual_cycles enable row level security;
drop policy if exists "service_role_full_access_cycles" on public.menstrual_cycles;
create policy "service_role_full_access_cycles"
  on public.menstrual_cycles for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- usersテーブルに生理周期関連カラムを追加
alter table public.users
  add column if not exists pms_symptoms          text,    -- JSON配列 例: '["イライラ","頭痛"]'
  add column if not exists period_symptoms       text,    -- JSON配列 例: '["腹痛","腰痛"]'
  add column if not exists cycle_reg_step        integer, -- 登録フロー進捗 (null=未開始, 0〜3)
  add column if not exists cycle_reg_start_date  text,    -- 登録中の開始日を一時保存
  add column if not exists pending_period_check  date;    -- 生理確認メッセージを送った日

-- pg_cron + pg_net: 毎朝9:00 JST (00:00 UTC) にリマインドを送信
-- ★ REMIND_SECRET_VALUE を実際の値に書き換えてから実行してください ★
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daily-period-remind',
  '0 0 * * *',
  $cron$
    select net.http_post(
      url     := 'https://diet-ai-app-navy.vercel.app/api/remind',
      headers := '{"Content-Type":"application/json","x-remind-secret":"REMIND_SECRET_VALUE"}'::jsonb,
      body    := '{}'::jsonb
    )
  $cron$
);
