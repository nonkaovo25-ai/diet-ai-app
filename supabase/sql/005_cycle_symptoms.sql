-- 生理周期テーブルに症状カラムを追加
-- Supabase SQL Editor で実行してください。

alter table public.menstrual_cycles
  add column if not exists pms_symptoms     text,  -- JSON配列 例: '["イライラ","頭痛"]'
  add column if not exists period_symptoms  text,  -- JSON配列 例: '["腹痛","腰痛"]'
  add column if not exists symptom_severity text;  -- "重い" | "普通" | "軽め"
