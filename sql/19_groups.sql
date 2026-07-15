-- ============================================================================
-- Athena Agreements Studio — migration v19: admin-managed Groups list
--
-- Lets admins create/delete the group/project tags used for agreement access
-- scoping (Team & Access → Groups). Everyone can read the list (to populate
-- pick-lists); only admins can add / change / remove groups.
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Depends on has_role (sql/00).
-- ============================================================================

create table if not exists public.agreement_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
alter table public.agreement_groups enable row level security;

drop policy if exists ag_groups_read on public.agreement_groups;
create policy ag_groups_read on public.agreement_groups
  for select to authenticated using (true);

drop policy if exists ag_groups_write on public.agreement_groups;
create policy ag_groups_write on public.agreement_groups
  for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));

grant select, insert, update, delete on public.agreement_groups to authenticated;

-- Done. Manage the list under Team & Access → Groups.
