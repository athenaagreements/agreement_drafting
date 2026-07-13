-- ============================================================================
-- Athena Agreements Studio — migration v18: let users CLEAR their notifications
--
-- The bell panel now has a "Clear all" button. Deleting a notification needs a
-- DELETE policy + grant (previously only select + update were granted, so the
-- delete silently affected 0 rows). We also re-assert the UPDATE policy/grant so
-- "Mark all read" is guaranteed to work on any project state.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- ============================================================================

-- a user may read / update / delete ONLY their own notifications
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());

grant select, update, delete on public.notifications to authenticated;

-- Done. "Mark all read" and "Clear all" now work for every signed-in user.
