-- RAG用 pgvector セットアップ
-- Supabase SQL Editor で1回だけ実行してください。

-- pgvector 拡張を有効化
create extension if not exists vector;

-- ナレッジチャンクテーブル
create table if not exists public.knowledge_chunks (
  id        bigserial primary key,
  source    text    not null,          -- ファイル名（例: calories, nutrition, training）
  content   text    not null,          -- チャンクのテキスト本文
  embedding vector(1536),              -- text-embedding-3-small の次元数
  created_at timestamptz default now()
);

-- 高速検索用インデックス（データが100件以上になったら有効）
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 類似検索関数（コサイン類似度）
create or replace function match_knowledge(
  query_embedding vector(1536),
  match_threshold float default 0.75,
  match_count     int   default 3
)
returns table (content text, similarity float)
language sql stable
as $$
  select
    kc.content,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where 1 - (kc.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;

-- RLS: service_role のみアクセス可
alter table public.knowledge_chunks enable row level security;

drop policy if exists "service_role_full_access_knowledge" on public.knowledge_chunks;
create policy "service_role_full_access_knowledge"
  on public.knowledge_chunks
  for all
  to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
