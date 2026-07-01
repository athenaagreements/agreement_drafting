# Athena Agreements Studio — Edge Functions

## `risk-assessment`
Server-side proxy that lets the browser app run Claude risk assessments **without ever exposing the Anthropic API key**. The key lives only as a Supabase secret; the function verifies the caller's Supabase login before calling Claude.

### One-time setup
You need the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker installed, and to be logged in (`supabase login`).

```bash
# from the project root
supabase link --project-ref ihfdmpkfzkxucsyymaou

# store the Anthropic key as a server secret (never goes to the browser)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

# deploy the function
supabase functions deploy risk-assessment
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected into the function automatically — you do **not** set those.

### What it accepts (POST JSON)
```json
{
  "system":   "optional system prompt",
  "prompt":   "the standard risk-assessment prompt",
  "ourText":  "our proposed clause text (optional)",
  "theirText":"the counterparty's changed text (optional)",
  "model":    "claude-sonnet-5"
}
```
Returns `{ "text": "...", "model": "...", "usage": {...} }` or `{ "error": "..." }`.

### How the app calls it
`modules/negotiate.js` calls `sb.functions.invoke("risk-assessment", { body })`; the user's session token is attached automatically, so the function knows who is asking.

### Cost
Each run bills your Anthropic account for the tokens used (roughly the size of the two document versions plus the response). Long agreements = more tokens.
