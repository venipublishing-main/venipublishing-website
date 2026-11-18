export function initConnectedApplications(win, doc) {
  const section = doc.getElementById("connected-applications");
  if (!section || section.dataset.connectionsInitialized) return;
  const status = section.querySelector("[data-connection-status]");
  const disconnect = section.querySelector("[data-open-disconnection]");
  const retry = section.querySelector("[data-retry-connections]");
  const panel = section.querySelector("#reserve-disconnection");
  const cancel = panel?.querySelector("[data-cancel-disconnection]");
  const confirm = panel?.querySelector("[data-confirm-disconnection]");
  const auth = win.veniAccount?.client?.auth;
  const registrations = (win.VENI_OAUTH_ALLOWED_CLIENTS ?? []).filter(app => app.app === "reserve-staging");
  const clientId = registrations.length === 1 && registrations[0].clientId;
  if (!disconnect || !panel?.showModal || !cancel || !confirm || !auth?.oauth?.listGrants || !auth.oauth.revokeGrant ||
      typeof clientId !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(clientId)) {
    status.textContent = "Connected applications are temporarily unavailable. Reload this page to retry.";
    return;
  }

  section.dataset.connectionsInitialized = "true";
  let userId;
  let generation = 0;
  let revoking = false;

  function show(message, connected = false, canRetry = false) {
    status.textContent = message;
    disconnect.hidden = !connected;
    retry.hidden = !canRetry;
  }

  async function hasReserveGrant() {
    const { data, error } = await auth.oauth.listGrants();
    if (error || !Array.isArray(data)) throw new Error();
    return data.some(grant => grant.client?.id === clientId);
  }
  async function load() {
    if (!userId || revoking) return;
    const current = ++generation;
    show("Checking your connections…");
    try {
      const connected = await hasReserveGrant();
      if (current !== generation) return;
      show(connected ? "Reserve staging is connected." : "Reserve staging is disconnected.", connected);
    } catch {
      if (current === generation) show("Could not check your connections.", false, true);
    }
  }

  function dismiss() {
    if (panel.open) panel.close();
  }
  disconnect.addEventListener("click", () => {
    if (!userId || disconnect.hidden || revoking || panel.open) return;
    confirm.disabled = false;
    panel.showModal();
  });
  cancel.addEventListener("click", dismiss);
  win.addEventListener("pagehide", dismiss);

  confirm.addEventListener("click", async () => {
    if (!panel.open || confirm.disabled || !userId || disconnect.hidden || revoking || doc.hidden) return;
    const current = ++generation;
    revoking = true;
    confirm.disabled = true;
    dismiss();
    show("Disconnecting Reserve staging…");
    status.focus();
    async function revokeConfirmedGrant() {
      if (current !== generation) return;
      const identity = await auth.getUser();
      if (current !== generation) return;
      if (identity.error || identity.data.user?.id !== userId) throw new Error();
      const connected = await hasReserveGrant();
      if (current !== generation) return;
      if (!connected) {
        show("Reserve staging is disconnected.");
        return;
      }
      const result = await auth.oauth.revokeGrant({ clientId });
      if (current !== generation) return;
      if (result.error !== null || !result.data) throw new Error();
      show("Reserve staging disconnected on all devices.");
    }
    try {
      // Serialize explicit confirmations across tabs in the same browser profile.
      if (win.navigator.locks) {
        await win.navigator.locks.request("veni-reserve-disconnect:" + clientId, revokeConfirmedGrant);
      } else {
        await revokeConfirmedGrant();
      }
    } catch {
      // The response may have been lost after the provider committed. A retry
      // reads the user's grants again before presenting another confirmation.
      if (current === generation) show("Could not confirm disconnection. Retry to check your connection.", false, true);
    } finally {
      if (current === generation) revoking = false;
    }
  });
  retry.addEventListener("click", load);
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) dismiss();
    else void load();
  });
  auth.onAuthStateChange((_event, session) => {
    const next = session?.user.id ?? null;
    if (next === userId) return;
    dismiss();
    userId = next;
    ++generation;
    revoking = false;
    show(next ? "Checking your connections…" : "");
    // Supabase holds its Auth lock while delivering the session event.
    if (next) win.setTimeout(load, 0);
  });
}

if (typeof window !== "undefined") initConnectedApplications(window, document);
