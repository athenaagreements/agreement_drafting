-- ============================================================================
-- Athena Agreements Studio — Phase 2
-- Executed-agreement libraries (Vendor + Client) + Contract negotiation/review
-- workspace (versions, comments, AI risk assessments) + app settings.
--
-- Idempotent. Safe to run on top of ALL_IN_ONE.sql. Run in the Supabase SQL editor.
-- ============================================================================

-- ---------- helper: is the current user an admin? ----------
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ============================================================================
-- 1) Executed-agreement libraries (signed PDFs/DOCX)
-- ============================================================================
create table if not exists public.executed_agreements (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('vendor','client')),
  title        text not null,
  counterparty text,
  category     text,
  entity       text,
  signed_date  date,
  file_path    text,          -- object path in storage bucket 'executed-agreements'
  file_name    text,
  notes        text,
  uploaded_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists exec_kind_idx on public.executed_agreements(kind, created_at desc);

-- ============================================================================
-- 2) Negotiations (a contract under review — vendor-side or client-side)
-- ============================================================================
create table if not exists public.negotiations (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('vendor','client')),
  title        text not null,
  counterparty text,
  entity       text,
  agreement_id uuid references public.agreements(id) on delete set null,
  status       text not null default 'open' check (status in ('open','in_review','closed')),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists neg_kind_idx on public.negotiations(kind, updated_at desc);

-- ============================================================================
-- 3) Versions of the document under negotiation (full version history)
-- ============================================================================
create table if not exists public.agreement_versions (
  id             uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  version_no     int  not null default 1,
  source         text not null default 'ours' check (source in ('ours','theirs','final')),
  label          text,
  content        text,          -- text/markup of the version (used for diff + AI)
  file_path      text,          -- optional uploaded file in 'negotiation-files'
  file_name      text,
  note           text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists ver_neg_idx on public.agreement_versions(negotiation_id, created_at);

-- ============================================================================
-- 4) Reviewer comments
-- ============================================================================
create table if not exists public.review_comments (
  id             uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  version_id     uuid references public.agreement_versions(id) on delete set null,
  clause_ref     text,
  body           text not null,
  author         uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists cmt_neg_idx on public.review_comments(negotiation_id, created_at);

-- ============================================================================
-- 5) Stored AI risk assessments
-- ============================================================================
create table if not exists public.risk_assessments (
  id             uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references public.negotiations(id) on delete cascade,
  version_id     uuid references public.agreement_versions(id) on delete set null,
  compared_to    uuid references public.agreement_versions(id) on delete set null,
  prompt_key     text,
  model          text,
  result         text,          -- markdown/text returned by Claude
  run_by         uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists risk_neg_idx on public.risk_assessments(negotiation_id, created_at desc);

-- ============================================================================
-- 6) Key/value app settings (stores the standard risk-assessment prompts)
-- ============================================================================
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);
insert into public.app_settings(key, value) values
  ('risk_prompt_client', '{"text":""}'::jsonb),
  ('risk_prompt_vendor', '{"text":""}'::jsonb),
  ('risk_model',         '{"text":"claude-sonnet-5"}'::jsonb)
on conflict (key) do nothing;

-- ============================================================================
-- RLS — shared internal workspace: any authenticated user may read/collaborate;
-- deletes limited to the owner or an admin; settings writable only by admins.
-- ============================================================================
alter table public.executed_agreements enable row level security;
alter table public.negotiations        enable row level security;
alter table public.agreement_versions  enable row level security;
alter table public.review_comments     enable row level security;
alter table public.risk_assessments    enable row level security;
alter table public.app_settings        enable row level security;

-- executed_agreements
drop policy if exists ea_read   on public.executed_agreements;
drop policy if exists ea_insert on public.executed_agreements;
drop policy if exists ea_update on public.executed_agreements;
drop policy if exists ea_delete on public.executed_agreements;
create policy ea_read   on public.executed_agreements for select to authenticated using (true);
create policy ea_insert on public.executed_agreements for insert to authenticated with check (uploaded_by = auth.uid());
create policy ea_update on public.executed_agreements for update to authenticated using (uploaded_by = auth.uid() or public.is_admin());
create policy ea_delete on public.executed_agreements for delete to authenticated using (uploaded_by = auth.uid() or public.is_admin());

-- negotiations
drop policy if exists ng_read   on public.negotiations;
drop policy if exists ng_insert on public.negotiations;
drop policy if exists ng_update on public.negotiations;
drop policy if exists ng_delete on public.negotiations;
create policy ng_read   on public.negotiations for select to authenticated using (true);
create policy ng_insert on public.negotiations for insert to authenticated with check (created_by = auth.uid());
create policy ng_update on public.negotiations for update to authenticated using (true);
create policy ng_delete on public.negotiations for delete to authenticated using (created_by = auth.uid() or public.is_admin());

-- agreement_versions
drop policy if exists av_read   on public.agreement_versions;
drop policy if exists av_insert on public.agreement_versions;
drop policy if exists av_update on public.agreement_versions;
drop policy if exists av_delete on public.agreement_versions;
create policy av_read   on public.agreement_versions for select to authenticated using (true);
create policy av_insert on public.agreement_versions for insert to authenticated with check (created_by = auth.uid());
create policy av_update on public.agreement_versions for update to authenticated using (created_by = auth.uid() or public.is_admin());
create policy av_delete on public.agreement_versions for delete to authenticated using (created_by = auth.uid() or public.is_admin());

-- review_comments
drop policy if exists rc_read   on public.review_comments;
drop policy if exists rc_insert on public.review_comments;
drop policy if exists rc_update on public.review_comments;
drop policy if exists rc_delete on public.review_comments;
create policy rc_read   on public.review_comments for select to authenticated using (true);
create policy rc_insert on public.review_comments for insert to authenticated with check (author = auth.uid());
create policy rc_update on public.review_comments for update to authenticated using (author = auth.uid() or public.is_admin());
create policy rc_delete on public.review_comments for delete to authenticated using (author = auth.uid() or public.is_admin());

-- risk_assessments
drop policy if exists ra_read   on public.risk_assessments;
drop policy if exists ra_insert on public.risk_assessments;
drop policy if exists ra_delete on public.risk_assessments;
create policy ra_read   on public.risk_assessments for select to authenticated using (true);
create policy ra_insert on public.risk_assessments for insert to authenticated with check (run_by = auth.uid());
create policy ra_delete on public.risk_assessments for delete to authenticated using (run_by = auth.uid() or public.is_admin());

-- app_settings
drop policy if exists as_read   on public.app_settings;
drop policy if exists as_write  on public.app_settings;
drop policy if exists as_update on public.app_settings;
create policy as_read   on public.app_settings for select to authenticated using (true);
create policy as_write  on public.app_settings for insert to authenticated with check (public.is_admin());
create policy as_update on public.app_settings for update to authenticated using (public.is_admin());

-- ============================================================================
-- Storage buckets (private) + policies
-- ============================================================================
insert into storage.buckets (id, name, public) values ('executed-agreements','executed-agreements', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('negotiation-files','negotiation-files', false)     on conflict (id) do nothing;

drop policy if exists store_read   on storage.objects;
drop policy if exists store_insert on storage.objects;
drop policy if exists store_update on storage.objects;
drop policy if exists store_delete on storage.objects;
create policy store_read on storage.objects for select to authenticated
  using (bucket_id in ('executed-agreements','negotiation-files'));
create policy store_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('executed-agreements','negotiation-files'));
create policy store_update on storage.objects for update to authenticated
  using (bucket_id in ('executed-agreements','negotiation-files'));
create policy store_delete on storage.objects for delete to authenticated
  using (bucket_id in ('executed-agreements','negotiation-files') and (owner = auth.uid() or public.is_admin()));

-- Done.
