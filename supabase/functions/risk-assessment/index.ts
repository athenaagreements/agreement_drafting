// ============================================================================
// Athena Agreements Studio — Claude risk-assessment proxy (Supabase Edge Function)
//
// WHY THIS EXISTS: the Anthropic API key must NEVER ship in the browser. This
// serverless function holds the key as a server-side secret, verifies the
// caller's Supabase login, then calls Claude and returns the result.
//
// Deploy:  supabase functions deploy risk-assessment
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   (SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically.)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // --- verify the caller is a signed-in workspace user ---
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Not authenticated." }, 401);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return json({ error: "ANTHROPIC_API_KEY is not configured on the server. Set it with `supabase secrets set`." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const system: string = body.system || "You are a senior contracts counsel performing a risk assessment. Be precise, cite the specific clause, explain the risk and its business impact, and recommend a position.";
    const prompt: string = body.prompt || "";
    const ourText: string = body.ourText || "";
    const theirText: string = body.theirText || "";
    const model: string = body.model || "claude-sonnet-5";

    const userContent = [
      prompt,
      ourText ? `\n\n=== OUR VERSION / PROPOSED ===\n${ourText}` : "",
      theirText ? `\n\n=== COUNTERPARTY VERSION / THEIR CHANGES ===\n${theirText}` : "",
    ].join("").trim();

    if (!userContent) return json({ error: "Nothing to assess — provide a prompt and at least one version." }, 400);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return json({ error: data?.error?.message || `Anthropic API error (${resp.status})` }, 502);
    }
    const text = (data.content || []).map((c: { text?: string }) => c.text || "").join("\n");
    return json({ text, model, usage: data.usage });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
