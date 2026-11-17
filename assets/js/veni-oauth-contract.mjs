/* Veni Account OAuth consent: browser-safe, dependency-free validation helpers.
 * This is a second guard; Supabase Auth must independently register exact callbacks. */

const AUTH_ID_PATTERN = /^[A-Za-z0-9._~-]{8,512}$/;
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function parseAuthorizationId(search) {
  if (typeof search !== "string" || search.length > 2048) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  // Supabase sends only authorization_id; ignore neither duplicates nor extra inputs.
  if ([...params.keys()].some(key => key !== "authorization_id")) return null;
  const ids = params.getAll("authorization_id");
  return ids.length === 1 && AUTH_ID_PATTERN.test(ids[0]) ? ids[0] : null;
}

export function signInResumeUrl(origin, authorizationId) {
  if (!AUTH_ID_PATTERN.test(String(authorizationId ?? ""))) {
    throw new Error("Invalid authorization request");
  }
  const signIn = new URL("/account/sign-in/", origin);
  if (!/^https?:$/.test(signIn.protocol) || signIn.username || signIn.password) {
    throw new Error("Invalid account origin");
  }
  const resume = `/account/authorize/?authorization_id=${encodeURIComponent(authorizationId)}`;
  signIn.searchParams.set("next", resume);
  return signIn.href;
}

function safeCallback(callback) {
  if (typeof callback !== "string") return null;
  let url;
  try { url = new URL(callback); } catch { return null; }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) return null;
  if (url.username || url.password || url.hash || url.search || url.origin === "null") return null;
  if (url.href !== callback || !url.pathname || url.pathname === "/") return null;
  return url;
}

function validClient(entry) {
  return entry && typeof entry === "object" && CLIENT_ID_PATTERN.test(entry.clientId) &&
    typeof entry.label === "string" && entry.label.trim().length > 0 &&
    entry.label.length <= 80 && Array.isArray(entry.redirectUris) &&
    entry.redirectUris.length > 0 && entry.redirectUris.every(uri => safeCallback(uri)) &&
    Array.isArray(entry.allowedScopes) && entry.allowedScopes.length > 0 &&
    entry.allowedScopes.every(scope => typeof scope === "string" && SCOPE_PATTERN.test(scope));
}

export function getRequestedScopes(scope) {
  if (typeof scope !== "string" || !scope.trim() || scope.length > 500) return null;
  const scopes = scope.trim().split(/\s+/);
  return scopes.every(item => SCOPE_PATTERN.test(item)) && new Set(scopes).size === scopes.length
    ? scopes : null;
}

export function getRegisteredClient(details, allowlist) {
  if (!details || typeof details !== "object" || !Array.isArray(allowlist)) return null;
  if (!AUTH_ID_PATTERN.test(String(details.authorization_id ?? ""))) return null;
  const scopes = getRequestedScopes(details.scope);
  if (!scopes || typeof details.client?.id !== "string" || typeof details.redirect_uri !== "string") return null;
  for (const entry of allowlist) {
    if (!validClient(entry) || details.client.id !== entry.clientId) continue;
    if (!entry.redirectUris.includes(details.redirect_uri)) continue;
    if (!scopes.every(scope => entry.allowedScopes.includes(scope))) continue;
    return { clientId: entry.clientId, label: entry.label.trim(), redirectUri: details.redirect_uri, scopes };
  }
  return null;
}

export function getApprovedRedirect(redirectUrl, registeredCallbacks) {
  if (typeof redirectUrl !== "string" || redirectUrl.length > 4096 ||
      !Array.isArray(registeredCallbacks)) return null;
  let response;
  try { response = new URL(redirectUrl); } catch { return null; }
  if (response.username || response.password || response.hash) return null;
  const success = response.searchParams.getAll("code");
  const failure = response.searchParams.getAll("error");
  if ((success.length === 1) === (failure.length === 1)) return null;
  if ((success.length === 1 && !success[0]) || (failure.length === 1 && !failure[0])) return null;
  const state = response.searchParams.getAll("state");
  // Veni clients are required to generate and verify a unique OAuth state.
  if (success.length > 1 || failure.length > 1 || state.length !== 1 || !state[0] ||
      state[0].length > 512) return null;
  const acceptedKeys = success.length === 1
    ? new Set(["code", "state", "iss"])
    : new Set(["error", "error_description", "error_uri", "state", "iss"]);
  for (const key of response.searchParams.keys()) {
    if (!acceptedKeys.has(key) || response.searchParams.getAll(key).length !== 1) return null;
  }

  for (const callback of registeredCallbacks) {
    const allowed = safeCallback(callback);
    if (!allowed) continue;
    if (allowed.protocol === response.protocol && allowed.host === response.host &&
        allowed.pathname === response.pathname) return response.href;
  }
  return null;
}

export function knownCallbacks(allowlist) {
  if (!Array.isArray(allowlist)) return [];
  return allowlist.filter(validClient).flatMap(entry => entry.redirectUris);
}
