import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED = new Set([
  "aau_bridge_begin_nvidia_intent_execution",
  "aau_bridge_apply_nvidia_intent_execution",
]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const name = String(payload?.name || "").trim();
  const args =
    payload?.args && typeof payload.args === "object" && !Array.isArray(payload.args)
      ? payload.args
      : null;

  if (!ALLOWED.has(name) || !args) {
    return new Response(JSON.stringify({ error: "rpc_not_allowed" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRole) {
    return new Response(JSON.stringify({ error: "edge_service_role_unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const upstream = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
    },
  });
});
