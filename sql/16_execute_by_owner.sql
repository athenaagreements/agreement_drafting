-- ============================================================================
-- 16) Let the DRAFTER (creator) close out their own agreement.
--
-- Operational flow: after final approval, the drafter assigns the agreement
-- number, downloads the document, sends it for signature, and — once BOTH
-- parties have signed — marks it executed. So mark_executed now also accepts
-- the agreement's creator (in addition to a Reviewer/Admin). The approval step
-- already happened at "approved"; executing just records the signed fact.
-- (When the e-signature tool is connected, it will call this automatically.)
--
-- Still enforced: the agreement must be 'approved' and must have an agreement
-- number before it can be marked executed. Safe to run multiple times.
-- ============================================================================
create or replace function public.mark_executed(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role;
begin
  select * into ag from public.agreements where id=p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  v_role := public.my_role();
  if not (ag.created_by = auth.uid() or v_role in ('approver','admin')) then
    raise exception 'Not authorised';
  end if;
  if ag.status <> 'approved' then raise exception 'Only an approved agreement can be marked executed'; end if;
  if coalesce(ag.agreement_no,'') = '' then raise exception 'Assign an agreement number before marking executed'; end if;
  update public.agreements set status='executed' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'executed','agreement',p_id::text, coalesce(p_note,'Marked executed (signed)'));
  perform public.notify(ag.created_by, p_id, 'executed', 'Your agreement "'||ag.title||'" has been marked executed.');
end $$;
