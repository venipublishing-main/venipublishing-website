import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAuthorizationId, signInResumeUrl, getRegisteredClient,
  getRequestedScopes, getApprovedRedirect, knownCallbacks
} from "../assets/js/veni-oauth-contract.mjs";
import { initOAuthConsent } from "../assets/js/veni-oauth-consent.mjs";

const CLIENT_ID = "c7a9b410-21c9-4cde-938a-11fddcca1590";
const OTHER_ID = "c7a9b410-21c9-4cde-938a-11fddcca1591";
const AUTH_ID = "2deee000-1a2b-4ca2-a125-111111111111";
const CALLBACK = "https://reserve.venipublishing.co.za/auth/callback";
const BAD_CALLBACK = "https://reserve.venipublishing.co.za.evil.test/auth/callback";
const allowlist = [{ clientId: CLIENT_ID, label: "Veni Reserve", redirectUris: [CALLBACK], allowedScopes: ["openid", "email", "profile"] }];
const details = {
  authorization_id: AUTH_ID,
  client: { id: CLIENT_ID, name: "<img src=x onerror=alert(1)>" },
  user: { id: "user-001", email: "ian@example.test" },
  redirect_uri: CALLBACK,
  scope: "openid email"
};

test("parses only one well-formed authorization ID and no smuggled parameters", () => {
  assert.equal(parseAuthorizationId(`?authorization_id=${AUTH_ID}`), AUTH_ID);
  assert.equal(parseAuthorizationId(`?authorization_id=${AUTH_ID}&authorization_id=${AUTH_ID}`), null);
  assert.equal(parseAuthorizationId(`?authorization_id=${AUTH_ID}&redirect_uri=https://evil.test`), null);
  assert.equal(parseAuthorizationId("?authorization_id=../../evil"), null);
  assert.equal(parseAuthorizationId("?authorization_id=%0A%0D"), null);
  assert.equal(parseAuthorizationId(""), null);
});

test("login resume stays on the website even with an authorization request", () => {
  const url = new URL(signInResumeUrl("https://venipublishing.co.za", AUTH_ID));
  assert.equal(url.origin, "https://venipublishing.co.za");
  assert.equal(url.pathname, "/account/sign-in/");
  assert.equal(url.searchParams.get("next"), `/account/authorize/?authorization_id=${AUTH_ID}`);
  assert.throws(() => signInResumeUrl("javascript:alert(1)", AUTH_ID));
});

test("validates client UUID, exact callback and least-privilege scopes", () => {
  assert.deepEqual(getRegisteredClient(details, allowlist), {
    clientId: CLIENT_ID, label: "Veni Reserve", redirectUri: CALLBACK, scopes: ["openid", "email"]
  });
  assert.equal(getRegisteredClient({ ...details, client: { id: OTHER_ID } }, allowlist), null);
  assert.equal(getRegisteredClient({ ...details, redirect_uri: BAD_CALLBACK }, allowlist), null);
  assert.equal(getRegisteredClient({ ...details, scope: "openid email admin" }, allowlist), null);
  assert.equal(getRegisteredClient({ ...details, scope: "openid openid" }, allowlist), null);
  assert.equal(getRegisteredClient(details, []), null);
  assert.deepEqual(knownCallbacks(allowlist), [CALLBACK]);
  assert.deepEqual(getRequestedScopes("openid email"), ["openid", "email"]);
});

test("validates completed callback without accepting lookalikes or open redirects", () => {
  const valid = `${CALLBACK}?code=once&state=random`;
  assert.equal(getApprovedRedirect(valid, [CALLBACK]), valid);
  assert.equal(getApprovedRedirect(`${CALLBACK}?error=access_denied&state=random`, [CALLBACK]),
    `${CALLBACK}?error=access_denied&state=random`);
  for (const url of [
    `${BAD_CALLBACK}?code=secret`,
    "javascript:alert(1)",
    `https://user@reserve.venipublishing.co.za/auth/callback?code=secret`,
    `${CALLBACK}/other?code=secret`,
    `${CALLBACK}?code=one&code=two`,
    `${CALLBACK}?code=one&error=access_denied`,
    `${CALLBACK}?state=one`,
    `${CALLBACK}?code=one#fragment`,
    `http://reserve.venipublishing.co.za/auth/callback?code=one`,
  ]) assert.equal(getApprovedRedirect(url, [CALLBACK]), null, url);
  assert.equal(getApprovedRedirect(`${CALLBACK}?code=one`, []), null);
});

function element() {
  return {
    textContent: "", hidden: false, disabled: false, dataset: {}, children: [], handlers: {},
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); },
    addEventListener(type, fn) { this.handlers[type] = fn; }
  };
}

function harness({ user = { id: "user-001", email: "ian@example.test" },
                   data = details, registered = allowlist, approveUrl = `${CALLBACK}?code=once&state=abc` } = {}) {
  const names = ["status", "consent", "client-label", "email", "redirect", "scopes", "approve", "deny"];
  const elements = Object.fromEntries(names.map(name => [name, element()]));
  const events = { getUser: 0, getDetails: 0, decisions: [], redirects: [] };
  const auth = {
    getUser: async () => { events.getUser++; return { data: { user }, error: null }; },
    oauth: {
      getAuthorizationDetails: async id => {
        assert.equal(id, AUTH_ID); events.getDetails++; return { data, error: null };
      },
      approveAuthorization: async (id, options) => {
        events.decisions.push({ action: "approve", id, options });
        return { data: { redirect_url: approveUrl }, error: null };
      },
      denyAuthorization: async (id, options) => {
        events.decisions.push({ action: "deny", id, options });
        return { data: { redirect_url: `${CALLBACK}?error=access_denied&state=abc` }, error: null };
      }
    }
  };
  const win = {
    location: { origin: "https://venipublishing.co.za", search: `?authorization_id=${AUTH_ID}`,
      replace(url) { events.redirects.push(url); } },
    VENI_OAUTH_ALLOWED_CLIENTS: registered,
    VENI_SUPABASE: { url: "https://test.supabase.co", publishableKey: "sb_publishable_public" },
    supabase: { createClient() { return { auth }; } }
  };
  const doc = {
    querySelector(selector) { return elements[selector.replace(/^\[data-oauth-/, "").replace(/\]$/, "")]; },
    createElement() { return element(); }
  };
  return { win, doc, elements, events };
}

test("inactive preview never calls Auth or shows consent", async () => {
  const h = harness({ registered: [] });
  const result = await initOAuthConsent(h.win, h.doc);
  assert.equal(result.state, "error");
  assert.equal(h.events.getUser, 0);
  assert.equal(h.elements.consent.hidden, true);
});

test("signed-out visitor returns to same-origin login preserving the request", async () => {
  const h = harness({ user: null });
  const result = await initOAuthConsent(h.win, h.doc);
  assert.equal(result.state, "redirected");
  assert.equal(h.events.getDetails, 0);
  assert.equal(new URL(h.events.redirects[0]).searchParams.get("next"),
    `/account/authorize/?authorization_id=${AUTH_ID}`);
});

test("unknown client or account mismatch never exposes approve button", async () => {
  const unknown = harness({ data: { ...details, client: { id: OTHER_ID, name: "Impostor" } } });
  assert.equal((await initOAuthConsent(unknown.win, unknown.doc)).state, "error");
  assert.equal(unknown.elements.approve.disabled, true);
  const mismatch = harness({ data: { ...details, user: { id: "someone-else" } } });
  assert.equal((await initOAuthConsent(mismatch.win, mismatch.doc)).state, "error");
});

test("consent uses trusted label, renders scope text, and verifies approval redirect", async () => {
  const h = harness();
  assert.deepEqual(await initOAuthConsent(h.win, h.doc), { state: "ready", clientId: CLIENT_ID });
  assert.equal(h.elements["client-label"].textContent, "Veni Reserve");
  assert.equal(h.elements["scopes"].children.length, 2);
  assert.equal(h.elements.consent.hidden, false);
  await h.elements.approve.handlers.click();
  assert.deepEqual(h.events.decisions, [{ action: "approve", id: AUTH_ID,
    options: { skipBrowserRedirect: true } }]);
  assert.deepEqual(h.events.redirects, [`${CALLBACK}?code=once&state=abc`]);
});

test("denial uses skipBrowserRedirect and returns only to registered callback", async () => {
  const h = harness();
  await initOAuthConsent(h.win, h.doc);
  await h.elements.deny.handlers.click();
  assert.equal(h.events.decisions[0].action, "deny");
  assert.deepEqual(h.events.decisions[0].options, { skipBrowserRedirect: true });
  assert.deepEqual(h.events.redirects, [`${CALLBACK}?error=access_denied&state=abc`]);
});

test("malicious approval response remains blocked after consent", async () => {
  const h = harness({ approveUrl: `${BAD_CALLBACK}?code=stolen` });
  await initOAuthConsent(h.win, h.doc);
  await h.elements.approve.handlers.click();
  assert.deepEqual(h.events.redirects, []);
  assert.equal(h.elements.approve.disabled, false);
  assert.equal(h.elements.status.dataset.kind, "error");
});

test("previously granted authorization may redirect only to allowlisted callback", async () => {
  const allowed = harness({ data: { redirect_url: `${CALLBACK}?code=once` } });
  assert.equal((await initOAuthConsent(allowed.win, allowed.doc)).state, "redirected");
  const blocked = harness({ data: { redirect_url: `${BAD_CALLBACK}?code=once` } });
  assert.equal((await initOAuthConsent(blocked.win, blocked.doc)).state, "error");
  assert.deepEqual(blocked.events.redirects, []);
});
