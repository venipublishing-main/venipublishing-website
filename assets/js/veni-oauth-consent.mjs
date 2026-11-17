import {
  parseAuthorizationId,
  signInResumeUrl,
  getRegisteredClient,
  getRequestedScopes,
  getApprovedRedirect,
  knownCallbacks
} from "./veni-oauth-contract.mjs";

const SCOPE_LABELS = Object.freeze({
  openid: "Confirm your Veni Account identity",
  email: "Share your account email address",
  profile: "Share basic account profile information",
  phone: "Share your account phone number"
});

export async function initOAuthConsent(win = window, doc = document) {
  const status = doc.querySelector("[data-oauth-status]");
  const panel = doc.querySelector("[data-oauth-consent]");
  const clientName = doc.querySelector("[data-oauth-client-label]");
  const accountEmail = doc.querySelector("[data-oauth-email]");
  const redirectUri = doc.querySelector("[data-oauth-redirect]");
  const scopeList = doc.querySelector("[data-oauth-scopes]");
  const approve = doc.querySelector("[data-oauth-approve]");
  const deny = doc.querySelector("[data-oauth-deny]");

  function report(message, kind = "info") {
    if (status) {
      status.textContent = message;
      status.dataset.kind = kind;
      status.hidden = false;
    }
  }
  function fail(message) { report(message, "error"); return { state: "error" }; }
  function redirect(checkedUrl) { win.location.replace(checkedUrl); return { state: "redirected" }; }

  if (!status || !panel || !clientName || !accountEmail || !redirectUri || !scopeList ||
      !approve || !deny) return { state: "incomplete" };
  panel.hidden = true;
  approve.disabled = true;
  deny.disabled = true;

  const authorizationId = parseAuthorizationId(win.location.search);
  if (!authorizationId) return fail("This authorization link is invalid. Please begin again in the Veni app.");

  const allowlist = win.VENI_OAUTH_ALLOWED_CLIENTS;
  // No registered apps: the page is a harmless preview, not a live consent endpoint.
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return fail("Veni app sign-in is not enabled yet. Please return to the app.");
  }

  const config = win.VENI_SUPABASE;
  if (!config || typeof config.url !== "string" ||
      typeof config.publishableKey !== "string" || !config.url.startsWith("https://") ||
      !config.publishableKey.startsWith("sb_publishable_") ||
      !win.supabase?.createClient) {
    return fail("Veni Account is temporarily unavailable.");
  }

  try {
    const client = win.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    if (!client.auth?.getUser || !client.auth?.oauth?.getAuthorizationDetails ||
        !client.auth.oauth.approveAuthorization || !client.auth.oauth.denyAuthorization) {
      return fail("Veni app sign-in needs an account update before it can continue.");
    }

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) {
      return redirect(signInResumeUrl(win.location.origin, authorizationId));
    }

    const { data: details, error: detailsError } =
      await client.auth.oauth.getAuthorizationDetails(authorizationId);
    if (detailsError || !details) {
      return fail("This authorization request has expired or could not be verified. Please retry from the app.");
    }

    // A previously consented request returns a redirect only, no client metadata.
    if (!Object.hasOwn(details, "authorization_id")) {
      const approved = getApprovedRedirect(details.redirect_url, knownCallbacks(allowlist));
      if (!approved) return fail("The app's return address is not approved by Veni.");
      return redirect(approved);
    }

    if (details.authorization_id !== authorizationId ||
        details.user?.id !== userData.user.id) {
      return fail("The request does not match your signed-in account.");
    }
    const registered = getRegisteredClient(details, allowlist);
    if (!registered || !getRequestedScopes(details.scope)) {
      return fail("This app or its requested access has not been approved by Veni.");
    }

    clientName.textContent = registered.label;
    accountEmail.textContent = userData.user.email || "Veni member";
    redirectUri.textContent = registered.redirectUri;
    scopeList.replaceChildren();
    for (const scope of registered.scopes) {
      const item = doc.createElement("li");
      item.textContent = SCOPE_LABELS[scope] || `Requested scope: ${scope}`;
      scopeList.appendChild(item);
    }

    let pending = false;
    async function decide(action) {
      if (pending) return;
      pending = true;
      approve.disabled = true;
      deny.disabled = true;
      report(action === "approve" ? "Connecting securely…" : "Declining request…");
      try {
        // The SDK redirects automatically unless skipBrowserRedirect is true.
        // We must inspect the returned URL BEFORE navigating off-site.
        const { data, error } = action === "approve"
          ? await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
          : await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
        if (error || !data) throw new Error("Consent decision failed");
        const approved = getApprovedRedirect(data.redirect_url, [registered.redirectUri]);
        if (!approved) throw new Error("Unregistered return address");
        redirect(approved);
      } catch {
        report("We could not complete the request. Please return to the app and retry.", "error");
        pending = false;
        approve.disabled = false;
        deny.disabled = false;
      }
    }
    approve.addEventListener("click", () => decide("approve"));
    deny.addEventListener("click", () => decide("deny"));
    panel.hidden = false;
    approve.disabled = false;
    deny.disabled = false;
    report("Confirm the app and requested information below.");
    return { state: "ready", clientId: registered.clientId };
  } catch {
    return fail("We could not verify this request. Please try again from the app.");
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  // Classic deferred Supabase configuration scripts are guaranteed loaded at window load.
  if (document.readyState === "complete") void initOAuthConsent(window, document);
  else window.addEventListener("load", () => { void initOAuthConsent(window, document); }, { once: true });
}
