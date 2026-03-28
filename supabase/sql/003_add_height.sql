-- 身長カラム追加 & 診断ステップ上限更新
-- Supabase SQL Editor で実行してください。

-- 身長カラムを追加
alter table public.users
  add column if not exists height numeric;

-- 身長の正値制約
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_height_positive_chk'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_height_positive_chk
      check (height is null or height > 0);
  end if;
end
$$;

-- diagnosis_step のデフォルト値を 8 に更新（設問が8問になるため）
alter table public.users
  alter column diagnosis_step set default 8;

-- diagnosis_step の上限制約を 0〜8 に更新
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'users_diagnosis_step_range_chk'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      drop constraint users_diagnosis_step_range_chk;
  end if;

  alter table public.users
    add constraint users_diagnosis_step_range_chk
    check (diagnosis_step between 0 and 8);
end
$$;

-- 既存の診断完了済みユーザー（step=7）を新しい完了値（step=8）に移行
update public.users
  set diagnosis_step = 8
  where diagnosis_step = 7;
