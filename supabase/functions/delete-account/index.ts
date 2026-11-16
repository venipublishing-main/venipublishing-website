import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { reserveDeletionDecision } from "../_shared/reserve-account-deletion-policy.mjs";

const allowedOrigins = new Set([
  "https://venipublishing-main.github.io",
  "https://venipublishing.co.za",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://venipublishing-main.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return new Response(JSON.stringify({ error: "Account deletion is not available." }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Authentication required." }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  // This flag is OFF unless the shared Reserve schema, self-only RPC and
  // privacy workflow have been reviewed and explicitly enabled together.
  // No hosted configuration change is made by this draft.
  if (Deno.env.get("VENI_SHARED_RESERVE_DELETE_PREFLIGHT") === "enabled") {
    // User JWT + invoker RLS, never service role: the RPC reads only the
    // caller's Reserve projection and owner assignments, not arbitrary IDs.
    const { data: state, error: preflightError } = await userClient.rpc(
      "reserve_account_deletion_preflight"
    );
    const decision = reserveDeletionDecision(state, preflightError);
    if (decision) {
      return new Response(JSON.stringify({ error: decision.error, code: decision.code }), {
        status: decision.status, headers: { ...cors, "Content-Type": "application/json" }
      });
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, false);
  if (deleteError) {
    console.error("delete-account failed", { userId: user.id, message: deleteError.message });
    return new Response(JSON.stringify({ error: "We could not delete this account. Please try again." }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ deleted: true }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" }
  });
});
