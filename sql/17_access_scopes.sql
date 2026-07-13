-- ============================================================================
-- Athena Agreements Studio — migration v17: per-member access scopes + Groups
--
-- Model (set by admin in Team & Access):
--   • Every agreement can carry ONE free-text "Group" tag (a department or a
--     project — e.g. "WASH", "Client X", "Finance").
--   • Each member has THREE independent access settings: VIEW / EDIT / DELETE.
--     Each is one of:
--        'own'    — only agreements they created (the default for new members)
--        'groups' — agreements whose Group is in their assigned access_groups
--        'all'    — every agreement
--   • Admins always have full access. The owner can always view/edit their own
--     and delete their own draft. A reviewer still sees items routed to them
--     (assigned_approver), so the approval flow is unaffected.
--
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent).
-- Depends on: sql/00 (profiles, has_role) and sql/12 (is_admin()).
-- ============================================================================

-- ---------- 1. Group tag on agreements -------------------------------------
alter table public.agreements  add column if not exists group_tag text;
create index if not exists agreements_group_idx on public.agreements(group_tag);

-- ---------- 2. Access-scope columns on profiles ----------------------------
alter table public.profiles add column if not exists view_scope   text not null default 'own';
alter table public.profiles add column if not exists edit_scope   text not null default 'own';
alter table public.profiles add column if not exists delete_scope text not null default 'own';
alter table public.profiles add column if not exists access_groups text[] not null default '{}';

do $$ begin
  alter table public.profiles add constraint profiles_view_scope_chk   check (view_scope   in ('own','groups','all'));
  alter table public.profiles add constraint profiles_edit_scope_chk   check (edit_scope   in ('own','groups','all'));
  alter table public.profiles add constraint profiles_delete_scope_chk check (delete_scope in ('own','groups','all'));
exception when duplicate_object then null; end $$;

-- Preserve today's behaviour on first run: admins/approvers currently see & edit
-- everything, so seed their scopes to 'all'. Everyone else starts 'own'.
-- (Delete stays 'own' for all except admins, who are covered by is_admin() anyway.)
update public.profiles set view_scope='all', edit_scope='all'
 where role in ('admin','approver') and view_scope='own' and edit_scope='own';

-- ---------- 3. Scope-check helpers (SECURITY DEFINER: read profiles safely) --
create or replace function public.can_view_agreement(a_created_by uuid, a_approver uuid, a_group text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or a_created_by = auth.uid()
      or a_approver   = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid()
                 and ( p.view_scope = 'all'
                    or (p.view_scope = 'groups' and a_group is not null and a_group = any(p.access_groups)) ));
$$;

create or replace function public.can_edit_agreement(a_created_by uuid, a_group text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or a_created_by = auth.uid()
      or public.has_role(array['approver']::user_role[])   -- reviewers act on any (approve/reject/execute)
      or exists (select 1 from public.profiles p where p.id = auth.uid()
                 and ( p.edit_scope = 'all'
                    or (p.edit_scope = 'groups' and a_group is not null and a_group = any(p.access_groups)) ));
$$;

create or replace function public.can_delete_agreement(a_created_by uuid, a_group text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or a_created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid()
                 and ( p.delete_scope = 'all'
                    or (p.delete_scope = 'groups' and a_group is not null and a_group = any(p.access_groups)) ));
$$;

-- ---------- 4. Rewire the agreements RLS policies to use the scopes ---------
drop policy if exists agreements_read on public.agreements;
create policy agreements_read on public.agreements
  for select to authenticated
  using ( public.can_view_agreement(created_by, assigned_approver, group_tag) );

-- keep the original owner + approver UPDATE policies, and ADD a scope-based one
drop policy if exists agreements_update_scope on public.agreements;
create policy agreements_update_scope on public.agreements
  for update to authenticated
  using ( public.can_edit_agreement(created_by, group_tag) );

-- delete: owner (draft) / admin already covered; ADD scope-based delete
drop policy if exists agreements_delete_scope on public.agreements;
create policy agreements_delete_scope on public.agreements
  for delete to authenticated
  using ( public.can_delete_agreement(created_by, group_tag) );

-- ---------- 5. Admin RPC to set a member's access --------------------------
create or replace function public.admin_set_access(
  target uuid, p_view text, p_edit text, p_delete text, p_groups text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']::user_role[]) then
    raise exception 'Only admins can change access';
  end if;
  if p_view   not in ('own','groups','all') then raise exception 'bad view_scope';   end if;
  if p_edit   not in ('own','groups','all') then raise exception 'bad edit_scope';   end if;
  if p_delete not in ('own','groups','all') then raise exception 'bad delete_scope'; end if;
  update public.profiles
     set view_scope = p_view, edit_scope = p_edit, delete_scope = p_delete,
         access_groups = coalesce(p_groups, '{}')
   where id = target;
  insert into public.audit_log(actor, action, entity, entity_id, note)
  values (auth.uid(), 'access_changed', 'profile', target::text,
          'view='||p_view||' edit='||p_edit||' delete='||p_delete||
          ' groups='||array_to_string(coalesce(p_groups,'{}'), ','));
end $$;

grant execute on function public.admin_set_access(uuid,text,text,text,text[]) to authenticated;

-- ============================================================================
-- Done. New members default to 'own' visibility. To let someone see everything,
-- set their View = All in Team & Access. To scope a Project Manager, set their
-- View/Edit = Their groups and list the groups.
-- ============================================================================
