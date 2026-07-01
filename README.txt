AGREEMENT STUDIO — PRE-CLEANED STARTER
======================================
This folder is a working, neutral-branded, AGREEMENT-ONLY starter (drafting +
tracking + approval). ALL prior-client references have already been removed
(verified: zero matches for the prior company name / code / regulator). The
ops modules (billing, HR, dashboards, field trackers, partner portal) are gone.

WHAT YOU FILL IN (search for these placeholders and replace, or set via config):
  Athena Infonomics        - short company name (header, footer, text)
  Athena Infonomics India Private Limited  - full legal name (letterhead, agreements)
  Athena Agreements Studio            - app/product name (e.g. "Athena Agreements")
  Agreements Studio         - small tagline under the name
  #2A, Jeyamkondar, New No. 40 (Old No. 12), Murrays Gate Road, Chennai, Tamil Nadu, 600018,
  Alwarpet, Chennai 600018                         - address (letterhead/footer)
                                   - tax/registration number
  44 423 27112, info@athenainfonomics.com              - contact details (footer)
  Authorised Signatory                                - default signatory
  Brand COLOURS: edit the CSS variables at the top of index.html (--green etc.)
  FONT:          change the Google Font link + font-family in index.html
  LOGO:          paste your logo data URL into logo.js (window.APP_LOGO_DATAURL)
  ICONS:         replace the files in icons/ with your own (same sizes)

TEMPLATES (IMPORTANT):
  studio.html still contains PLACEHOLDER agreement templates (company name
  neutralised). REPLACE the template/clause library in studio.html with the
  client's final agreement templates, used VERBATIM. The drafting engine (gallery,
  clause toggles, merge fields, Word export) is reusable as-is.

SUPABASE & DEPLOY:
  1. config.js is already set with Athena's Supabase URL + publishable (anon) key.
  2. Run the database setup in ONE step: open Supabase -> SQL Editor -> New query,
     paste all of sql/ALL_IN_ONE.sql and click RUN. (It bundles 00,01,02,06,09,11,05
     in the correct order, sets the @athenainfonomics.com sign-up domain, and adds
     the app_permissions table + admin_set_permission() RPC the app needs. Idempotent.)
     The individual numbered files remain for reference / incremental runs.
     Then: Authentication -> Providers -> Email -> keep "Confirm email" ON.
  3. Host on GitHub Pages (the required .nojekyll file is included). Deploy = push.
  4. Optional local preview: powershell -ExecutionPolicy Bypass -File server.ps1 -Port 8770

PHASE 2 — LIBRARIES + CONTRACT REVIEW (AI):
  Adds: Vendor & Client libraries of executed (signed) agreements; a contract
  negotiation/review workspace (version history, ours-vs-theirs diff, team
  comments) with a Claude-powered risk assessment.

  5. DATABASE: open Supabase -> SQL Editor and RUN sql/12_negotiations_library.sql
     once (creates the new tables, RLS, the two private Storage buckets, and the
     app_settings prompt store). Idempotent.
  6. CLAUDE (edge function): the Anthropic API key must NEVER be in the browser.
     Deploy the proxy and set the secret (needs Supabase CLI + Docker):
        supabase link --project-ref ihfdmpkfzkxucsyymaou
        supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
        supabase functions deploy risk-assessment
     See supabase/functions/README.md for details.
  7. PROMPTS: sign in as an admin -> Team & Access -> "AI prompts", and paste your
     standard client-side and vendor-side risk-assessment prompts (and optionally
     the model, default claude-sonnet-5). Until set, "Run risk assessment" warns.
  8. ACCESS: the Vendor/Client review tabs are permissioned — grant them per user
     in Team & Access. Admins always have access.
  9. TWO-STEP APPROVALS: RUN sql/13_approvals.sql once (adds the pending_actions
     queue + profiles.approval_exempt + admin_set_approval_exempt RPC). After this,
     governed actions (deletes, template Save/Reset, mark-executed, edits, library
     uploads) require the actor to assign an approver; the approver approves them in
     Review / Approvals, which applies them. Approvals are ON for everyone by default;
     an admin can untick "Approvals required" for a person in Team & Access to let
     their actions take effect immediately. (Until sql/13 is run, these actions error.)

NOTE: config.js is intentionally NOT included (no live keys travel with this starter).
