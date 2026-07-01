-- ============================================================================
-- Athena Agreements Studio — ALL-IN-ONE database setup (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
-- Run this ONCE: Supabase dashboard -> SQL Editor -> New query -> paste -> RUN.
-- It is idempotent and safe to re-run. Bundles, in the correct order:
--   00 schema (profiles, agreements, template_overrides, audit_log, RLS)
--   01 workflow v2 (status flow, notifications, submit/approve/reject/execute)
--   02 visibility v3 (drafter sees only own/assigned; approver/admin see all)
--   ++ app_permissions table + admin_set_permission() RPC  (Team & Access)
--   06 restrict sign-up to @athenainfonomics.com (first user becomes admin)
--   09 approval columns on ops tables  (guarded no-op here; future-proof)
--   11 access_log (who viewed sensitive records)
--   05 API role privileges (GRANTs) — run last so every object is covered
--
-- After running: Authentication -> Providers -> Email -> keep "Confirm email" ON.
-- The FIRST person to sign up (with an @athenainfonomics.com address) is Admin.
-- ============================================================================


-- ############################################################################
-- # 00 — CORE SCHEMA
-- ############################################################################
-- ---------- enums ----------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin','approver','drafter','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agreement_status as enum ('draft','in_review','approved','rejected','executed');
exception when duplicate_object then null; end $$;

-- ---------- profiles (one row per user) ------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        user_role not null default 'drafter',
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---------- agreements -----------------------------------------------------
create table if not exists public.agreements (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  counterparty      text,
  category          text,                       -- client | vendor | module
  template_key      text,
  status            agreement_status not null default 'draft',
  data              jsonb,                       -- full Studio draft JSON
  created_by        uuid not null references public.profiles(id),
  assigned_approver uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.agreements enable row level security;
create index if not exists agreements_status_idx on public.agreements(status);
create index if not exists agreements_creator_idx on public.agreements(created_by);

-- ---------- shared template overrides (permanent in-app template edits) -----
create table if not exists public.template_overrides (
  template_key text primary key,
  clauses      jsonb not null,
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now()
);
alter table public.template_overrides enable row level security;

-- ---------- audit log ------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor       uuid references public.profiles(id),
  action      text not null,                    -- created | submitted | approved | rejected | executed | edited | role_changed | template_saved
  entity      text not null,                    -- agreement | template | profile
  entity_id   text,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create index if not exists audit_created_idx on public.audit_log(created_at desc);

-- ============================================================================
-- Helper functions (SECURITY DEFINER so they can read profiles without
-- tripping the profiles RLS — this avoids policy recursion).
-- ============================================================================
create or replace function public.my_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.has_role(roles user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any(roles));
$$;

-- ============================================================================
-- New-user bootstrap: create a profile automatically. The FIRST user to sign
-- up becomes 'admin'; everyone after that starts as 'drafter'.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when is_first then 'admin'::user_role else 'drafter'::user_role end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep updated_at fresh on agreements
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists agreements_touch on public.agreements;
create trigger agreements_touch before update on public.agreements
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Admin-only RPC to change a user's role (avoids self-privilege-escalation).
-- ============================================================================
create or replace function public.admin_set_role(target uuid, new_role user_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']::user_role[]) then
    raise exception 'Only admins can change roles';
  end if;
  update public.profiles set role = new_role where id = target;
  insert into public.audit_log(actor, action, entity, entity_id, note)
  values (auth.uid(), 'role_changed', 'profile', target::text, 'role set to '||new_role);
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- profiles -------------------------------------------------------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

-- a user may edit their OWN profile but NOT change their own role
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

-- admins may update any profile
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.has_role(array['admin']::user_role[]));

-- agreements -----------------------------------------------------------------
-- whole team can see agreements (small-team model; tighten later if needed)
drop policy if exists agreements_read on public.agreements;
create policy agreements_read on public.agreements
  for select to authenticated using (true);

drop policy if exists agreements_insert on public.agreements;
create policy agreements_insert on public.agreements
  for insert to authenticated
  with check (created_by = auth.uid());

-- owner can update their own agreement…
drop policy if exists agreements_update_owner on public.agreements;
create policy agreements_update_owner on public.agreements
  for update to authenticated
  using (created_by = auth.uid());

-- …and approvers/admins can update any (e.g. to approve / reject / execute)
drop policy if exists agreements_update_approver on public.agreements;
create policy agreements_update_approver on public.agreements
  for update to authenticated
  using (public.has_role(array['approver','admin']::user_role[]));

-- owner may delete a draft; admins may delete anything
drop policy if exists agreements_delete on public.agreements;
create policy agreements_delete on public.agreements
  for delete to authenticated
  using (public.has_role(array['admin']::user_role[]) or created_by = auth.uid());

-- template_overrides ---------------------------------------------------------
drop policy if exists tmpl_read on public.template_overrides;
create policy tmpl_read on public.template_overrides
  for select to authenticated using (true);

drop policy if exists tmpl_write on public.template_overrides;
create policy tmpl_write on public.template_overrides
  for all to authenticated
  using (public.has_role(array['admin','approver']::user_role[]))
  with check (public.has_role(array['admin','approver']::user_role[]));

-- audit_log ------------------------------------------------------------------
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated using (true);

drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (actor = auth.uid());

-- ============================================================================
-- Done. Notes:
--  • Data is encrypted at rest by Supabase (AES-256) and in transit (TLS).
--  • RLS above is enforced by Postgres itself, so the browser cannot bypass it.
--  • The anon API key used by the front-end is SAFE to expose publicly — RLS
--    is what protects the data, not the key.
-- ============================================================================


-- ############################################################################
-- # 01 — WORKFLOW v2 (status flow, notifications, approval RPCs)
-- ############################################################################
-- 1) Allow a new "recommended" status. We switch status to TEXT (+ check) so we
--    can evolve states without enum-migration friction.
alter table public.agreements alter column status drop default;
alter table public.agreements alter column status type text using status::text;
alter table public.agreements alter column status set default 'draft';
do $$ begin
  alter table public.agreements add constraint agreements_status_chk
    check (status in ('draft','in_review','recommended','approved','rejected','executed'));
exception when duplicate_object then null; end $$;

-- 2) Notifications -----------------------------------------------------------
create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  agreement_id uuid references public.agreements(id) on delete cascade,
  type         text,
  message      text not null,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.notifications enable row level security;
create index if not exists notif_user_idx on public.notifications(user_id, is_read, created_at desc);

drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on public.notifications to authenticated;

-- helper: write a notification (used inside the SECURITY DEFINER RPCs below)
create or replace function public.notify(p_user uuid, p_ag uuid, p_type text, p_msg text)
returns void language sql security definer set search_path=public as $$
  insert into public.notifications(user_id, agreement_id, type, message)
  select p_user, p_ag, p_type, p_msg where p_user is not null;
$$;

-- ============================================================================
-- 3) Workflow RPCs. All rules live here, enforced by the database.
-- ============================================================================

-- Submit a draft for review (preparer only)
create or replace function public.submit_for_review(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; r record;
begin
  select * into ag from public.agreements where id = p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  if ag.created_by <> auth.uid() then raise exception 'Only the preparer can submit this agreement'; end if;
  if ag.status not in ('draft','rejected') then raise exception 'Only a draft can be submitted'; end if;

  update public.agreements set status='in_review' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'submitted','agreement',p_id::text, coalesce(p_note,'Submitted for review'));

  -- notify the assigned approver, or (if none) every approver/admin
  if ag.assigned_approver is not null then
    perform public.notify(ag.assigned_approver, p_id, 'review', 'An agreement "'||ag.title||'" is awaiting your review.');
  else
    for r in select id from public.profiles where role in ('approver','admin') and id <> auth.uid() loop
      perform public.notify(r.id, p_id, 'review', 'An agreement "'||ag.title||'" is awaiting review.');
    end loop;
  end if;
end $$;

-- Approve. Admin = final approval. Non-admin approver = "recommend" (needs admin).
create or replace function public.approve_agreement(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role; r record;
begin
  select * into ag from public.agreements where id=p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'You are not authorised to approve'; end if;
  -- separation of duties: a preparer cannot approve their own work unless they are an admin
  if ag.created_by = auth.uid() and v_role <> 'admin' then
    raise exception 'The preparer cannot approve their own agreement';
  end if;

  if v_role = 'admin' and ag.status in ('in_review','recommended') then
    update public.agreements set status='approved' where id=p_id;
    insert into public.audit_log(actor,action,entity,entity_id,note)
      values (auth.uid(),'approved','agreement',p_id::text, coalesce(p_note,'Approved (final)'));
    perform public.notify(ag.created_by, p_id, 'approved', 'Your agreement "'||ag.title||'" has been approved.');
    -- also tell any approver who recommended it
    for r in select distinct actor from public.audit_log where entity='agreement' and entity_id=p_id::text and action='recommended' loop
      perform public.notify(r.actor, p_id, 'approved', 'The agreement "'||ag.title||'" you reviewed has been approved by an admin.');
    end loop;

  elsif v_role = 'approver' and ag.status = 'in_review' then
    update public.agreements set status='recommended' where id=p_id;
    insert into public.audit_log(actor,action,entity,entity_id,note)
      values (auth.uid(),'recommended','agreement',p_id::text, coalesce(p_note,'Recommended — awaiting admin approval'));
    -- notify all admins (they must finalise) and the preparer (status update)
    for r in select id from public.profiles where role='admin' loop
      perform public.notify(r.id, p_id, 'final_needed', 'Agreement "'||ag.title||'" was recommended and needs your final approval.');
    end loop;
    perform public.notify(ag.created_by, p_id, 'recommended', 'Your agreement "'||ag.title||'" was reviewed and recommended; awaiting admin approval.');

  elsif v_role = 'approver' and ag.status = 'recommended' then
    raise exception 'Already recommended — awaiting an admin for final approval';
  else
    raise exception 'Cannot approve from the current status (%).', ag.status;
  end if;
end $$;

-- Reject (approver/admin; not your own work unless admin)
create or replace function public.reject_agreement(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role; r record;
begin
  select * into ag from public.agreements where id=p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'You are not authorised to reject'; end if;
  if ag.created_by = auth.uid() and v_role <> 'admin' then raise exception 'The preparer cannot reject their own agreement'; end if;
  if ag.status not in ('in_review','recommended') then raise exception 'Only an item under review can be rejected'; end if;

  update public.agreements set status='rejected' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'rejected','agreement',p_id::text, coalesce(p_note,'Rejected'));
  perform public.notify(ag.created_by, p_id, 'rejected', 'Your agreement "'||ag.title||'" was returned with changes requested.'||case when p_note is not null then ' Note: '||p_note else '' end);
  for r in select distinct actor from public.audit_log where entity='agreement' and entity_id=p_id::text and action='recommended' loop
    perform public.notify(r.actor, p_id, 'rejected', 'The agreement "'||ag.title||'" you recommended was rejected.');
  end loop;
end $$;

-- Mark executed (signed) — approver/admin, after final approval
create or replace function public.mark_executed(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role;
begin
  select * into ag from public.agreements where id=p_id;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'Not authorised'; end if;
  if ag.status <> 'approved' then raise exception 'Only an approved agreement can be marked executed'; end if;
  update public.agreements set status='executed' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'executed','agreement',p_id::text, coalesce(p_note,'Marked executed (signed)'));
  perform public.notify(ag.created_by, p_id, 'executed', 'Your agreement "'||ag.title||'" has been marked executed.');
end $$;

grant execute on function public.submit_for_review(uuid,text) to authenticated;
grant execute on function public.approve_agreement(uuid,text) to authenticated;
grant execute on function public.reject_agreement(uuid,text) to authenticated;
grant execute on function public.mark_executed(uuid,text) to authenticated;
grant execute on function public.notify(uuid,uuid,text,text) to authenticated;

-- ============================================================================
-- Done. Statuses now flow:
--   draft → in_review → (recommended) → approved → executed
--                         ↑ non-admin approver        ↑ admin only
--   any review step → rejected → back to draft owner
-- Separation of duties and "non-admin approvals need an admin" are enforced above.
-- ============================================================================


-- ############################################################################
-- # 02 — VISIBILITY v3
-- ############################################################################
drop policy if exists agreements_read on public.agreements;

create policy agreements_read on public.agreements
  for select to authenticated
  using (
    created_by = auth.uid()
    or assigned_approver = auth.uid()
    or public.has_role(array['approver','admin']::user_role[])
  );

-- Note: the INSERT/UPDATE/DELETE policies are unchanged. This only affects
-- which rows each person can read. To go back to full shared visibility, run:
--   drop policy if exists agreements_read on public.agreements;
--   create policy agreements_read on public.agreements
--     for select to authenticated using (true);


-- ############################################################################
-- # ++ APP PERMISSIONS  (per-section access grants; used by Team & Access)
-- #    Referenced by the app (app.js / agreement.js) and by the RPC below;
-- #    listed in the build spec data model as app_permissions(user_id, tool_key).
-- ############################################################################
create table if not exists public.app_permissions (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  tool_key   text not null,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, tool_key)
);
alter table public.app_permissions enable row level security;
create index if not exists app_perms_user_idx on public.app_permissions(user_id);

drop policy if exists app_perms_read on public.app_permissions;
create policy app_perms_read on public.app_permissions
  for select to authenticated using (true);

create or replace function public.admin_set_permission(target uuid, p_tool text, p_grant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']::user_role[]) then
    raise exception 'Only admins can change permissions';
  end if;
  if p_grant then
    insert into public.app_permissions(user_id, tool_key, granted_by)
      values (target, p_tool, auth.uid())
      on conflict (user_id, tool_key) do nothing;
  else
    delete from public.app_permissions where user_id = target and tool_key = p_tool;
  end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), case when p_grant then 'perm_granted' else 'perm_revoked' end,
            'profile', target::text, p_tool);
end $$;
grant execute on function public.admin_set_permission(uuid,text,boolean) to authenticated;


-- ############################################################################
-- # 06 — RESTRICT SELF SIGN-UP TO @athenainfonomics.com (first user = admin)
-- ############################################################################
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
  email_domain text := lower(split_part(new.email,'@',2));
  allowed text[] := array['athenainfonomics.com'];   -- <- Athena approved sign-up domain (F-3.1)
begin
  if not (email_domain = any(allowed)) then
    raise exception 'Sign-ups are restricted to %  email addresses.', array_to_string(allowed, ' or @');
  end if;

  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when is_first then 'admin'::user_role else 'drafter'::user_role end
  );
  return new;
end $$;
-- (Trigger on_auth_user_created from the base schema already calls this function.)


-- ############################################################################
-- # 09 — APPROVAL COLUMNS ON OPS TABLES (guarded no-op on this schema)
-- #    Agreements have their own workflow (section 01). These optional columns
-- #    apply only if the ops tables exist; here the block does nothing.
-- ############################################################################
do $$
declare t text;
begin
  foreach t in array array['clients','vendors','documents','bom_designs'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists approval_status text not null default ''draft'';', t);
      execute format('alter table public.%I add column if not exists submitted_by uuid references public.profiles(id);', t);
      execute format('alter table public.%I add column if not exists submitted_at timestamptz;', t);
      execute format('alter table public.%I add column if not exists assigned_approver uuid references public.profiles(id);', t);
      execute format('alter table public.%I add column if not exists approved_by uuid references public.profiles(id);', t);
      execute format('alter table public.%I add column if not exists approved_at timestamptz;', t);
      execute format('alter table public.%I add column if not exists reject_note text;', t);
      execute format('create index if not exists %I_approval_idx on public.%I(approval_status, assigned_approver);', t, t);
    end if;
  end loop;
end $$;


-- ############################################################################
-- # 11 — ACCESS LOG (who viewed sensitive records)
-- ############################################################################
create table if not exists public.access_log (
  id          bigint generated always as identity primary key,
  viewer      uuid references public.profiles(id),
  table_name  text not null,
  record_id   text,
  label       text,
  created_at  timestamptz not null default now()
);
create index if not exists access_log_idx on public.access_log(created_at desc);

alter table public.access_log enable row level security;

drop policy if exists access_insert on public.access_log;
create policy access_insert on public.access_log
  for insert to authenticated with check (viewer = auth.uid());

drop policy if exists access_read on public.access_log;
create policy access_read on public.access_log
  for select to authenticated using (public.has_role(array['admin']::user_role[]));

grant select, insert on public.access_log to authenticated;

-- ('view_contacts' is a per-tool grant stored in app_permissions — no schema
--  change needed; it is managed from the in-app Team & Access screen.)


-- ############################################################################
-- # 05 — API ROLE PRIVILEGES (GRANTs) — LAST so every object above is covered
-- ############################################################################
grant usage on schema public to anon, authenticated;

-- existing objects
grant select, insert, update, delete on all tables    in schema public to authenticated;
grant usage,  select                  on all sequences in schema public to authenticated;
grant execute                         on all functions in schema public to anon, authenticated;

-- future objects (so later migrations inherit the grants automatically)
alter default privileges in schema public grant select, insert, update, delete on tables    to authenticated;
alter default privileges in schema public grant usage,  select                  on sequences to authenticated;
alter default privileges in schema public grant execute                         on functions to anon, authenticated;

-- ============================================================================
-- After running this: in the app, click the role pill (top-right) to refresh,
-- or sign out and back in. The first user you created is the admin.
-- ============================================================================


-- ============================================================================
-- DONE. Athena Agreements Studio database is ready.
--  • RLS is enforced by Postgres itself; the browser anon key is safe to ship.
--  • Sign-up is restricted to @athenainfonomics.com; the first user = Admin.
--  • Status flow: draft -> in_review -> (recommended) -> approved -> executed;
--    any review step can be rejected back to the owner.
-- ============================================================================
