-- ============================================================================
-- Athena Agreements Studio — Dashboard support + Agreement Numbers
--  • agreement_no on agreements / executed_agreements / negotiations (manual,
--    assigned after approval and before execution; shown in every listing).
--  • widen the negotiation status set so the vendor/client lifecycle
--    (under_review → agreed → approved → executed) can be tracked for the dashboard.
-- Idempotent. Run after ALL_IN_ONE.sql + 12 + 13.
-- ============================================================================

alter table public.agreements          add column if not exists agreement_no text;
alter table public.executed_agreements  add column if not exists agreement_no text;
alter table public.negotiations         add column if not exists agreement_no text;

-- The negotiation status was constrained to (open,in_review,closed); allow the
-- fuller lifecycle used by the dashboard. Drop the old inline check if present.
alter table public.negotiations drop constraint if exists negotiations_status_check;

-- helpful indexes for the dashboard roll-ups
create index if not exists ag_status_updated_idx  on public.agreements(status, updated_at desc);
create index if not exists neg_status_updated_idx on public.negotiations(status, updated_at desc);

-- Done.
