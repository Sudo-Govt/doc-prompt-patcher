create table public.rag_documents (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  source_prompt text not null,
  act text not null,
  article_id text not null,
  filename text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index rag_documents_batch_id_idx on public.rag_documents(batch_id);
create index rag_documents_created_at_idx on public.rag_documents(created_at desc);

alter table public.rag_documents enable row level security;

-- Single-user app using personal Gemini API key in browser. Open access.
create policy "Anyone can read rag_documents"
  on public.rag_documents for select
  using (true);

create policy "Anyone can insert rag_documents"
  on public.rag_documents for insert
  with check (true);

create policy "Anyone can delete rag_documents"
  on public.rag_documents for delete
  using (true);

-- Tracks which documents have already been generated, keyed by input hash.
create table if not exists public.generated_documents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  list_item_id    text not null,
  input_hash      text not null,
  filename        text not null,
  output_path     text not null,
  prompt_version  text,
  generated_at    timestamptz not null default now()
);

create unique index if not exists generated_documents_user_hash_uniq
  on public.generated_documents (user_id, input_hash);

create index if not exists generated_documents_user_id_idx
  on public.generated_documents (user_id);

alter table public.generated_documents enable row level security;

create policy "own rows: select"
  on public.generated_documents for select
  to authenticated
  using (auth.uid() = user_id);

create policy "own rows: insert"
  on public.generated_documents for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "own rows: delete"
  on public.generated_documents for delete
  to authenticated
  using (auth.uid() = user_id);
