const confirmation = "Disconnect Reserve staging on all devices?\n\n" +
  "This will end your Reserve staging access across all browsers and devices. " +
  "You will remain signed in to your Veni Account. Connecting Reserve again will require fresh consent.";

export function initConnectedApplications(win, doc) {
  const section = doc.getElementById("connected-applications");
  if (!section) return;
  const status = section.querySelector("[data-connection-status]");
  const disconnect = section.querySelector("[data-disconnect-reserve]");
  const retry = section.querySelector("[data-retry-connections]");
  const auth = win.veniAccount?.client?.auth;
  const registrations = (win.VENI_OAUTH_ALLOWED_CLIENTS ?? []).filter(app => app.app === "reserve-staging");
  const clientId = registrations.length === 1 && registrations[0].clientId;
  if (!auth?.oauth?.listGrants || !auth.oauth.revokeGrant ||
      typeof clientId !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(clientId)) {
    status.textContent = "Connected applications are temporarily unavailable. Reload this page to retry.";
    return;
  }

  let userId;
  let generation = 0;
  let revoking = false;

  function show(message, connected = false, canRetry = false) {
    status.textContent = message;
    disconnect.hidden = !connected;
    retry.hidden = !canRetry;
  }

  async function load() {
    if (!userId || revoking) return;
    const current = ++generation;
    show("Checking your connections…");
    try {
      const { data, error } = await auth.oauth.listGrants();
      if (current !== generation) return;
      if (error || !Array.isArray(data)) throw new Error();
      const connected = data.some(grant => grant.client?.id === clientId);
      show(connected ? "Reserve staging is connected." : "Reserve staging is disconnected.", connected);
    } catch {
      if (current === generation) show("Could not check your connections.", false, true);
    }
  }

  disconnect.addEventListener("click", async () => {
    if (!userId || disconnect.hidden || revoking || !win.confirm(confirmation)) return;
    const current = ++generation;
    revoking = true;
    show("Disconnecting Reserve staging…");
    try {
      const identity = await auth.getUser();
      if (current !== generation) return;
      if (identity.error || identity.data.user?.id !== userId) throw new Error();
      const result = await auth.oauth.revokeGrant({ clientId });
      if (current !== generation) return;
      if (result.error !== null || !result.data) throw new Error();
      show("Reserve staging disconnected on all devices.");
    } catch {
      // The response may have been lost after the provider committed. A retry
      // reads the user's grants again before presenting another confirmation.
      if (current === generation) show("Could not confirm disconnection. Retry to check your connection.", false, true);
    } finally {
      if (current === generation) revoking = false;
    }
  });
  retry.addEventListener("click", load);
  doc.addEventListener("visibilitychange", () => { if (!doc.hidden) void load(); });
  auth.onAuthStateChange((_event, session) => {
    const next = session?.user.id ?? null;
    if (next === userId) return;
    userId = next;
    ++generation;
    revoking = false;
    show(next ? "Checking your connections…" : "");
    // Supabase holds its Auth lock while delivering the session event.
    if (next) win.setTimeout(load, 0);
  });
}

if (typeof window !== "undefined") initConnectedApplications(window, document);
