/*
 * DELIBERATELY INACTIVE IN THIS DRAFT.
 * A reviewed release must add actual Supabase OAuth client UUIDs, exact registered
 * HTTPS callback URLs, approved scopes, and labels for each environment.
 * Example (illustrative only; DO NOT paste test values into the active array):
 * { clientId: "<registered-UUID>", label: "Veni Reserve",
 *   redirectUris: ["https://reserve.example.test/auth/callback"],
 *   allowedScopes: ["openid", "email", "profile"] }
 * Never include OAuth client secrets or Supabase secret/service-role keys here.
 */
window.VENI_OAUTH_ALLOWED_CLIENTS = Object.freeze([]);
