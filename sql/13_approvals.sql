-- ============================================================================
-- Athena Agreements Studio — Two-step approval governance
-- Every governed action (deletes, template changes, edits, status changes,
-- library uploads) becomes: (1) action requested + approver assigned →
-- (2) approver approves (applies it) or rejects. Approvals are ON for everyone
-- by default; an admin can exempt a person (profiles.approval_exempt).
--
-- Idempotent. Run in the Supabase SQL editor after ALL_IN_ONE.sql + 12_*.sql.
-- ============================================================================

-- 1) Per-user exemption from approvals (default: everyone needs approval)
alter table public.profiles add column if not exists approval_exempt boolean not null default false;

create or replace function public.admin_set_approval_exempt(target uuid, val boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Only an admin can change approval exemption.';
  end if;
  update public.profiles set approval_exempt = val where id = target;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), case when val then 'approval_exempt_on' else 'approval_exempt_off' end, 'profile', target::text, null);
end; $$;
grant execute on function public.admin_set_approval_exempt(uuid, boolean) to authenticated;

-- 2) The pending-actions queue
create table if not exists public.pending_actions (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,          -- e.g. template.save, agreement.delete, agreement.execute, executed.create ...
  title             text not null,          -- human summary shown in the queue
  target_table      text,
  target_id         text,
  payload           jsonb,                  -- data needed to apply on approval
  status            text not null default 'pending' check (status in ('pending','approved','rejected','applied','failed')),
  note              text,                   -- requester note / rejection reason
  requested_by      uuid references public.profiles(id),
  assigned_approver uuid references public.profiles(id),
  decided_by        uuid references public.profiles(id),
  decided_at        timestamptz,
  applied_at        timestamptz,
  apply_error       text,
  created_at        timestamptz not null default now()
);
create index if not exists pa_approver_idx on public.pending_actions(assigned_approver, status, created_at desc);
create index if not exists pa_status_idx   on public.pending_actions(status, created_at desc);
create index if not exists pa_requester_idx on public.pending_actions(requested_by, created_at desc);

alter table public.pending_actions enable row level security;
drop policy if exists pa_read   on public.pending_actions;
drop policy if exists pa_insert on public.pending_actions;
drop policy if exists pa_update on public.pending_actions;
drop policy if exists pa_delete on public.pending_actions;
-- everyone signed in can see the queue (so requesters can track their items and approvers can act)
create policy pa_read   on public.pending_actions for select to authenticated using (true);
-- a user can only request in their own name
create policy pa_insert on public.pending_actions for insert to authenticated with check (requested_by = auth.uid());
-- only the assigned approver or an admin can decide (approve/reject/apply)
create policy pa_update on public.pending_actions for update to authenticated
  using (assigned_approver = auth.uid() or public.is_admin())
  with check (assigned_approver = auth.uid() or public.is_admin());
-- requester can withdraw a still-pending request; admin can remove any
create policy pa_delete on public.pending_actions for delete to authenticated
  using (public.is_admin() or (requested_by = auth.uid() and status = 'pending'));

-- Done.
