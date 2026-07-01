# Athena Agreements Studio — Data Security

A summary of the controls built into the tool, and what you must do operationally to keep it secure.

## Identity & access
- **Authentication:** Supabase Auth (email + password). Sign-up is **restricted to the `@athenainfonomics.com` domain** (enforced in the database).
- **Roles:** `drafter`, `approver`, `admin`. The first sign-up becomes admin; admins set roles in **Team & Access**.
- **Row-Level Security (RLS):** every table has RLS enabled. Users only see/modify what their role and ownership allow — enforced by the **database**, not just the UI, so it can't be bypassed by tampering with the browser.
- **Least-privilege keys:** the browser only ever holds the Supabase **publishable (anon) key**. The **service-role key is never shipped to the browser**. Approval/role/permission changes go through server-side RPCs that re-check the caller's rights.
- **Permissioned tabs:** the Vendor/Client contract-review tabs are grant-based (admins grant access per user).

## Secrets (AI & e-signature)
- The **Anthropic API key never touches the browser.** It lives only as a secret inside the `risk-assessment` Supabase Edge Function, which verifies the caller's login before calling Claude.
- Any future **e-signature** (Dropbox Sign / HelloSign) integration will follow the same rule — the provider API key stays server-side in an edge function.

## Documents & files
- **Private storage:** signed agreements and negotiation files are stored in **private** Supabase Storage buckets. They are never public; downloads use short-lived (120-second) **signed URLs**.
- **Stored-XSS defence:** all clause/annexure HTML from the rich-text editor is **sanitised** (scripts, inline event handlers, `javascript:` URLs and active tags are stripped) before it is stored, rendered, or exported — so a drafter cannot inject code that runs on a reviewer's screen. Formatting (bold/italic/lists/tables) is preserved.

## Browser hardening
- **Content-Security-Policy** on both pages restricts where code can load from and, critically, **where data can be sent** (`connect-src` is limited to Supabase). This blocks scripted attempts to exfiltrate data to other domains.
- External links opened from the app use `noopener`.
- Served over **HTTPS** (GitHub Pages / your host). The service worker never caches Supabase API responses.

## Auditability
- **Audit log:** creates/edits/approvals/rejections/template changes/AI runs are recorded with actor + timestamp (admins view under **Audit**).
- **Access log:** records who viewed sensitive records.

## Your operational responsibilities
1. Keep **email confirmation ON** (Supabase → Authentication → Providers → Email).
2. Grant **admin/approver** roles sparingly.
3. Store the **Anthropic** (and later **Dropbox Sign**) API keys only as Supabase **secrets** — never in `config.js` or any file that ships to the browser.
4. Review the **Audit log** periodically.
5. If you ever rotate keys, do it in the Supabase dashboard / `supabase secrets set`, not in the front-end.

## Note on the CSP
If, after deploying, something legitimately fails to load (e.g. you add a new CDN or a custom Supabase domain), update the `Content-Security-Policy` `<meta>` tag in `index.html` and `studio.html` to whitelist it. It is the one setting most likely to need adjustment when adding new external services.
