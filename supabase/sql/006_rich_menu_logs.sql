-- リッチメニュー連動: 入力待ちフラグ・体重ログ・運動ログ
-- Supabase SQL Editor で実行してください。

alter table public.users
  add column if not exists awaiting_rich_input text;

-- 1ユーザー1日1件（同日は上書き更新でOK）
create table if not exists public.weight_logs (
  line_user_id text not null references public.users (line_user_id) on delete cascade,
  logged_date date not null,
  weight_kg numeric not null check (weight_kg > 0 and weight_kg < 500),
  created_at timestamptz not null default now(),
  primary key (line_user_id, logged_date)
);

create index if not exists weight_logs_user_date_idx
  on public.weight_logs (line_user_id, logged_date desc);

alter table public.weight_logs enable row level security;

drop policy if exists "service_role_full_access_weight_logs" on public.weight_logs;
create policy "service_role_full_access_weight_logs"
  on public.weight_logs for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.exercise_logs (
  id bigint generated always as identity primary key,
  line_user_id text not null references public.users (line_user_id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists exercise_logs_user_created_idx
  on public.exercise_logs (line_user_id, created_at desc);

alter table public.exercise_logs enable row level security;

drop policy if exists "service_role_full_access_exercise_logs" on public.exercise_logs;
create policy "service_role_full_access_exercise_logs"
  on public.exercise_logs for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
