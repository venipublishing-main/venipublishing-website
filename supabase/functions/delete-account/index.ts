import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { guardedAccountDeletion } from "../_shared/delete-account-guard.mjs";

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

  let requestBody;
  try {
    requestBody = await req.json();
  } catch {
    return new Response(JSON.stringify({
      code: "DELETE_CONFIRMATION_REQUIRED",
      error: "Type DELETE MY ACCOUNT and provide your current password."
    }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // All privileged deletes use the trusted Auth user ID. There is no client-
  // supplied target ID, and an unset Reserve preflight flag now fails closed.
  const outcome = await guardedAccountDeletion({
    enabled: Deno.env.get("VENI_SHARED_RESERVE_DELETE_PREFLIGHT"),
    user: { id: user.id, email: user.email },
    requestBody,
    runPreflight: async () => userClient.rpc("reserve_account_deletion_preflight"),
    reauthenticate: async (email, password) => {
      // Verify the current password against this same Supabase Auth service.
      // A refreshed JWT is not evidence of recent password verification.
      const verifier = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data, error } = await verifier.auth.signInWithPassword({ email, password });
      return {
        userId: data?.user?.id,
        hasSession: Boolean(data?.session?.access_token),
        error
      };
    },
    deleteAuthenticatedUser: async (verifiedUserId) => {
      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      return admin.auth.admin.deleteUser(verifiedUserId, false);
    }
  });

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status, headers: { ...cors, "Content-Type": "application/json" }
  });
});
