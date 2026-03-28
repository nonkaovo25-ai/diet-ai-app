-- users table hardening for LINE diagnosis app
-- Run this in Supabase SQL Editor.

create table if not exists public.users (
  line_user_id text primary key,
  diagnosis_step integer not null default 7,
  ideal text,
  temptation text,
  support_style text,
  selected_character text,
  current_weight numeric,
  goal_weight numeric,
  activity text,
  deadline text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  alter column diagnosis_step set default 7,
  alter column diagnosis_step set not null;

alter table public.users
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_line_user_id_format_chk'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_line_user_id_format_chk
      check (line_user_id ~ '^U[0-9a-f]{32}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_diagnosis_step_range_chk'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_diagnosis_step_range_chk
      check (diagnosis_step between 0 and 7);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_selected_character_chk'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_selected_character_chk
      check (
        selected_character is null
        or selected_character in ('ひまり', '凛', 'ななみ')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_support_style_chk'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_support_style_chk
      check (
        support_style is null
        or support_style in ('優しく 癒し系', 'クール・理論系', '元気・ギャル系で')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_weight_positive_chk'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_weight_positive_chk
      check (
        (current_weight is null or current_weight > 0)
        and (goal_weight is null or goal_weight > 0)
      );
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_users_updated_at'
      and tgrelid = 'public.users'::regclass
  ) then
    create trigger set_users_updated_at
    before update on public.users
    for each row
    execute function public.set_updated_at();
  end if;
end
$$;

alter table public.users enable row level security;

revoke all on table public.users from anon;
revoke all on table public.users from authenticated;

drop policy if exists "service_role_full_access_users" on public.users;
create policy "service_role_full_access_users"
on public.users
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
