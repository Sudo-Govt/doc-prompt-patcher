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