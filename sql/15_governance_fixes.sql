-- ============================================================================
-- 15) Governance apply-layer + approval integrity fixes
--
-- Problem this fixes: the two-step approval "apply" used to run in the APPROVER's
-- database context, but row-level security on the target tables is owner-keyed.
-- So an approved delete/edit of someone else's record silently affected 0 rows
-- (and was reported as "applied"), and an approved library upload hard-failed the
-- RLS insert check. This moves the apply into ONE SECURITY DEFINER function that
-- authorises the approver, then performs the action with definer rights.
--
-- Also: (a) let signed-in users create notifications (so approval requests/decisions
-- actually notify), (b) guarantee an agreement number before "executed" on the
-- server for both agreements and negotiations, (c) tighten who can update a review.
--
-- Safe to run multiple times. Run AFTER ALL_IN_ONE.sql + sql/12,13,14.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (a) Notifications: allow authenticated users to insert (internal tool).
--     Previously only the SECURITY DEFINER notify() could write, so every
--     client-side notification was silently blocked by RLS.
-- ---------------------------------------------------------------------------
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications
  for insert to authenticated with check (true);
grant insert on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- (b) mark_executed: an agreement number is now required server-side.
-- ---------------------------------------------------------------------------
create or replace function public.mark_executed(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role;
begin
  select * into ag from public.agreements where id=p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'Not authorised'; end if;
  if ag.status <> 'approved' then raise exception 'Only an approved agreement can be marked executed'; end if;
  if coalesce(ag.agreement_no,'') = '' then raise exception 'Assign an agreement number before marking executed'; end if;
  update public.agreements set status='executed' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'executed','agreement',p_id::text, coalesce(p_note,'Marked executed (signed)'));
  perform public.notify(ag.created_by, p_id, 'executed', 'Your agreement "'||ag.title||'" has been marked executed.');
end $$;

-- ---------------------------------------------------------------------------
-- (c) apply_pending_action: the single, authorised apply path for the queue.
-- ---------------------------------------------------------------------------
create or replace function public.apply_pending_action(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare pa public.pending_actions; r jsonb; p jsonb;
begin
  select * into pa from public.pending_actions where id = p_id;
  if pa.id is null then raise exception 'Action not found'; end if;
  if pa.status <> 'pending' then raise exception 'This action is already %.', pa.status; end if;
  -- Only the assigned approver or an admin may apply it.
  if not (pa.assigned_approver = auth.uid() or public.is_admin()) then
    raise exception 'You are not authorised to approve this action';
  end if;

  if pa.kind = 'template.save' then
    insert into public.template_overrides(template_key, clauses, updated_by, updated_at)
    values (pa.payload->>'templateKey', pa.payload->'payload', auth.uid(), now())
    on conflict (template_key) do update
      set clauses = excluded.clauses, updated_by = excluded.updated_by, updated_at = now();

  elsif pa.kind = 'template.reset' then
    delete from public.template_overrides where template_key = pa.target_id;

  elsif pa.kind = 'agreement.delete' then
    delete from public.agreements where id = pa.target_id::uuid;

  elsif pa.kind = 'agreement.execute' then
    if not exists (select 1 from public.agreements where id = pa.target_id::uuid and coalesce(agreement_no,'') <> '') then
      raise exception 'Assign an agreement number before marking executed';
    end if;
    update public.agreements set status='executed' where id = pa.target_id::uuid;

  elsif pa.kind = 'executed.create' then
    r := pa.payload->'row';
    insert into public.executed_agreements
      (kind,title,counterparty,category,entity,signed_date,file_path,file_name,notes,agreement_no,uploaded_by)
    values
      (r->>'kind', r->>'title', r->>'counterparty', r->>'category', r->>'entity',
       nullif(r->>'signed_date','')::date, r->>'file_path', r->>'file_name', r->>'notes',
       r->>'agreement_no', coalesce(nullif(r->>'uploaded_by','')::uuid, pa.requested_by));

  elsif pa.kind = 'executed.edit' then
    p := pa.payload->'patch';
    update public.executed_agreements set
      title        = case when p ? 'title'        then p->>'title'        else title end,
      counterparty = case when p ? 'counterparty' then p->>'counterparty' else counterparty end,
      category     = case when p ? 'category'     then p->>'category'     else category end,
      entity       = case when p ? 'entity'       then p->>'entity'       else entity end,
      signed_date  = case when p ? 'signed_date'  then nullif(p->>'signed_date','')::date else signed_date end,
      notes        = case when p ? 'notes'        then p->>'notes'        else notes end,
      agreement_no = case when p ? 'agreement_no' then p->>'agreement_no' else agreement_no end
    where id = pa.target_id::uuid;

  elsif pa.kind = 'executed.delete' then
    delete from public.executed_agreements where id = pa.target_id::uuid;

  elsif pa.kind = 'negotiation.delete' then
    delete from public.negotiations where id = pa.target_id::uuid;

  else
    raise exception 'Unknown action kind: %', pa.kind;
  end if;

  update public.pending_actions
    set status='applied', decided_by=auth.uid(), decided_at=now(), applied_at=now()
    where id = p_id;

  insert into public.notifications(user_id, type, message)
    values (pa.requested_by, 'approved', 'Approved: '||pa.title);
end $$;

grant execute on function public.apply_pending_action(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (d) Negotiations: tighten who can update (was 'using (true)' = anyone),
--     and block "executed" without an agreement number.
-- ---------------------------------------------------------------------------
drop policy if exists ng_update on public.negotiations;
create policy ng_update on public.negotiations for update to authenticated
  using (created_by = auth.uid() or public.my_role()::text in ('approver','admin'))
  with check (created_by = auth.uid() or public.my_role()::text in ('approver','admin'));

create or replace function public.neg_require_number()
returns trigger language plpgsql as $$
begin
  if new.status = 'executed' and coalesce(new.agreement_no,'') = '' then
    raise exception 'Assign an agreement number before marking this review executed';
  end if;
  return new;
end $$;
drop trigger if exists neg_require_number_trg on public.negotiations;
create trigger neg_require_number_trg before insert or update on public.negotiations
  for each row execute function public.neg_require_number();
