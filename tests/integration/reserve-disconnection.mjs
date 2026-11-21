// Run from the Website checkout with an isolated, migrated real-auth-stack.
// node tests/integration/reserve-disconnection.mjs <stack> <Reserve checkout> <npm toolchain>
// Toolchain dependencies: playwright and @supabase/supabase-js@2.119.0.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [stack, reserve, tools] = process.argv.slice(2);
const website = process.cwd();
const provider = 'http://127.0.0.1:56321';
const worker = 'http://127.0.0.1:5193';
const site = 'http://127.0.0.1:3000';
const callback = worker + '/auth/veni/callback';
const packages = createRequire(resolve(tools, 'package.json'));
const { chromium } = packages('playwright');
const sdk = resolve(tools, 'node_modules/@supabase/supabase-js');
assert.equal(JSON.parse(readFileSync(resolve(sdk, 'package.json'))).version, '2.119.0');
assert.match(readFileSync(resolve(stack, 'supabase/config.toml'), 'utf8'), /^project_id = "veni_disconnect_1118"$/m);
const cli = resolve(reserve, 'node_modules/supabase/dist/supabase.js');
const state = JSON.parse(execFileSync(process.execPath, [cli, 'status', '--workdir', resolve(stack), '-o', 'json'],
  { stdio: ['ignore', 'pipe', 'ignore'] }));
assert.equal(state.API_URL, provider);
const json = { 'Content-Type': 'application/json' };
const bearer = token => ({ Authorization: 'Bearer ' + token });
function request(origin, path, init = {}) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin);
  return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { ...(origin === provider ? { apikey: state.PUBLISHABLE_KEY } : {}), ...init.headers } });
}
const auth = (path, init) => request(provider, path, init);
const app = (path, init) => request(worker, path, init);
async function payload(response, label) {
  assert.ok(response.ok, label + ' returned HTTP ' + response.status);
  return response.json();
}
function cookie(response, name) {
  const match = response.headers.getSetCookie().find(value => value.startsWith(name + '='));
  assert.ok(match, name + ' cookie missing');
  return match.split(';')[0];
}
const admin = { ...json, apikey: state.SERVICE_ROLE_KEY, ...bearer(state.SERVICE_ROLE_KEY) };
const clients = '/auth/v1/admin/oauth/clients';
const registrations = [];
async function register(name) {
  const registration = await payload(await auth(clients, { method: 'POST', headers: admin,
    body: JSON.stringify({ name, redirect_uris: [callback], client_type: 'confidential',
      token_endpoint_auth_method: 'client_secret_basic' }) }), 'client registration');
  registrations.push(registration.client_id);
  return registration;
}
const varsFile = resolve(reserve, '.dev.vars');
let server, browser, websiteUser, ownsVars = false;
try {
  const version = await payload(await auth('/auth/v1/health'), 'Auth health');
  assert.equal(version.version, 'v2.198.0', 'Match the hosted OAuth logout behavior');
  const primary = await register('Isolated Reserve staging');
  const other = await register('Isolated control application');
  assert.match(primary.client_id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  // This empty loopback project uses its own confidential client and callback.
  execFileSync('docker', ['exec', 'supabase_db_veni_disconnect_1118', 'psql', '-Xq',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-c',
    `insert into reserve_internal.oauth_clients (client_id) values ('${primary.client_id}')`]);
  const vars = { SUPABASE_URL: provider, SUPABASE_PUBLISHABLE_KEY: state.PUBLISHABLE_KEY,
    VENI_ACCOUNT_MODE: 'shared', VENI_OAUTH_CLIENT_ID: primary.client_id,
    VENI_OAUTH_CLIENT_SECRET: primary.client_secret, VENI_OAUTH_COOKIE_KEY: randomBytes(32).toString('base64url') };
  writeFileSync(varsFile, Object.entries(vars).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n'),
    { flag: 'wx', mode: 0o600 });
  ownsVars = true;
  server = spawn(process.execPath, [resolve(reserve, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '5193', '--strictPort'], { cwd: reserve, stdio: 'ignore', windowsHide: true });
  for (let attempt = 0; attempt < 60; ++attempt) {
    assert.equal(server.exitCode, null, 'isolated Worker exited');
    try { if ((await app('/health')).ok) break; } catch { /* Wait for startup. */ }
    await delay(500);
  }
  const identity = await payload(await auth('/auth/v1/signup', { method: 'POST', headers: json,
    body: JSON.stringify({ email: randomUUID() + '@example.invalid', password: randomUUID() + 'aB!' }) }), 'QA identity');
  websiteUser = identity.user.id;
  const websiteHeaders = { ...json, ...bearer(identity.access_token) };

  async function consent(authorization, registration, fresh, approve = true) {
    const start = await auth(authorization);
    const destination = new URL(start.headers.get('location'));
    assert.equal(destination.origin, site);
    const id = destination.searchParams.get('authorization_id');
    assert.ok(id);
    const endpoint = '/auth/v1/oauth/authorizations/' + encodeURIComponent(id);
    const details = await payload(await auth(endpoint, { headers: websiteHeaders }), 'authorization details');
    assert.equal(!details.redirect_url, fresh, 'unexpected fresh-consent requirement');
    if (details.redirect_url) return details.redirect_url;
    assert.equal(details.client.id, registration.client_id);
    assert.equal(details.redirect_uri, callback);
    if (!approve) return;
    return (await payload(await auth(endpoint + '/consent', { method: 'POST', headers: websiteHeaders,
      body: JSON.stringify({ action: 'approve' }) }), 'consent')).redirect_url;
  }
  async function device(fresh) {
    const login = await app('/login');
    const start = await app(login.headers.get('location'));
    const target = await consent(start.headers.get('location'), primary, fresh);
    const finish = await app(target, { headers: { Cookie: cookie(start, 'vr_transaction') } });
    assert.equal(finish.status, 303, 'Worker OAuth callback');
    assert.equal(finish.headers.get('location'), '/app');
    const headers = { Cookie: cookie(finish, 'vr_session') };
    assert.equal((await app('/app', { headers })).status, 200);
    const workspace = await payload(await app('/api/workspace/session', { headers }), 'workspace');
    assert.ok(workspace.user.id === websiteUser, 'workspace belongs to the isolated identity');
    assert.deepEqual(workspace.tenants, []);
    return headers;
  }
  async function token(registration, fresh) {
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({ response_type: 'code', client_id: registration.client_id,
      redirect_uri: callback, scope: 'email', state: randomUUID(), code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    const target = await consent('/auth/v1/oauth/authorize?' + params, registration, fresh);
    const body = new URLSearchParams({ grant_type: 'authorization_code', redirect_uri: callback,
      code: new URL(target).searchParams.get('code'), code_verifier: verifier });
    const basic = Buffer.from(registration.client_id + ':' + registration.client_secret).toString('base64');
    return (await payload(await auth('/auth/v1/oauth/token', { method: 'POST',
      headers: { Authorization: 'Basic ' + basic }, body }), 'code exchange')).access_token;
  }
  const a = await device(true);
  const b = await device(false);
  assert.ok(a.Cookie !== b.Cookie, 'two independent Worker sessions');
  const jwt = await token(primary, false);
  const control = await token(other, true);
  const target = '/api/tenants/' + randomUUID() + '/business-settings';
  const settings = () => app(target, { headers: bearer(jwt) });
  assert.equal((await settings()).status, 404, 'live session, no such tenant');
  const oldLogout = await auth('/auth/v1/logout?scope=local', { method: 'POST', headers: bearer(jwt) });
  assert.equal(oldLogout.status, 403);
  assert.equal((await oldLogout.json()).error_code, 'no_authorization');
  const localOnly = await device(false);
  const localLogout = await app('/api/workspace/logout', { method: 'POST', headers: { ...localOnly, Origin: worker } });
  assert.equal(localLogout.status, 303);
  assert.ok(localLogout.headers.getSetCookie().some(value => value.startsWith('vr_session=;') && value.includes('Max-Age=0')));
  assert.equal((await app('/api/workspace/session')).status, 401);
  assert.equal((await app('/api/workspace/session', { headers: b })).status, 200);

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pinnedCdn = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0';
  const assets = resolve(website, 'assets');
  let deletes = 0;
  const successfulDelete = Promise.withResolvers();
  const releaseDelete = Promise.withResolvers();
  async function serveLocalWebsite(route) {
    const url = new URL(route.request().url());
    if (url.href === pinnedCdn) return route.fulfill({ path: resolve(sdk, 'dist/umd/supabase.js') });
    if (url.origin === site && /^\/(auth|rest)\/v1\//.test(url.pathname)) {
      if (route.request().method() === 'DELETE') {
        assert.equal(url.pathname, '/auth/v1/user/oauth/grants');
        assert.ok(url.searchParams.get('client_id') === primary.client_id, 'only the registered Reserve client');
        if (++deletes === 1) return route.fulfill({ status: 503, contentType: 'application/json',
          headers: { 'access-control-allow-origin': site }, body: '{"message":"Simulated provider outage"}' });
        successfulDelete.resolve();
        await releaseDelete.promise;
      }
      // Keep the virtual Website origin same-origin in Chromium. Every provider
      // response except the injected first failure comes from the real stack.
      const response = await route.fetch({ url: provider + url.pathname + url.search, maxRedirects: 0 });
      return route.fulfill({ response });
    }
    if (url.origin !== site) return route.abort();
    if (url.pathname === '/account/settings/') return route.fulfill({ path: resolve(website, 'account/settings/index.html') });
    if (url.pathname === '/assets/js/supabase-config.js') return route.fulfill({ contentType: 'text/javascript',
      body: 'window.VENI_SUPABASE=' + JSON.stringify({ url: site, publishableKey: state.PUBLISHABLE_KEY }) });
    if (url.pathname === '/assets/js/veni-oauth-clients.js') {
      const registry = readFileSync(resolve(assets, 'js/veni-oauth-clients.js'), 'utf8');
      return route.fulfill({ contentType: 'text/javascript',
        body: registry.replace(/clientId: "[^"]+"/, 'clientId: "' + primary.client_id + '"') });
    }
    const path = resolve(website, '.' + url.pathname);
    if (path.startsWith(assets + sep) && existsSync(path)) return route.fulfill({ path,
      ...(path.endsWith('.mjs') ? { contentType: 'text/javascript' } : {}) });
    return route.fulfill({ status: 404, body: '' });
  }
  await context.route('**/*', serveLocalWebsite);
  await page.goto(site + '/account/settings/#connected-applications');
  assert.equal(await page.getByRole('heading', { name: 'Connected applications' }).isVisible(), false);
  async function signInWebsite(tab) {
    const signedIn = await tab.evaluate(async session => {
      const { error } = await window.veniAccount.client.auth.setSession(session);
      return !error;
    }, { access_token: identity.access_token, refresh_token: identity.refresh_token });
    assert.ok(signedIn, 'Website session initialized');
  }
  await signInWebsite(page);
  const disconnect = page.getByRole('button', { name: 'Disconnect Reserve staging', exact: true });
  const status = page.locator('#connected-applications [data-connection-status]');
  function controls(tab) {
    const dialog = tab.getByRole('dialog', { name: 'Disconnect Reserve staging on all devices?', exact: true });
    return {
      dialog, open: tab.getByRole('button', { name: 'Disconnect Reserve staging', exact: true }),
      cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
      confirm: dialog.getByRole('button', { name: 'Disconnect on all devices', exact: true }),
    };
  }
  const ui = controls(page);
  const focused = locator => locator.evaluate(el => el === document.activeElement);
  async function checkDevices() {
    for (const headers of [a, b]) {
      const session = await payload(await app('/api/workspace/session', { headers }), 'existing Reserve session');
      assert.ok(session.user.id === websiteUser);
      assert.deepEqual(session.tenants, []);
    }
  }
  for (const dismissal of ['Cancel', 'Escape', 'backdrop', 'Enter', 'Cancel']) {
    await ui.open.click();
    await ui.dialog.waitFor();
    assert.ok(await ui.dialog.getByText('This will disconnect Reserve staging across your browsers and devices. Your Veni Account will remain signed in. Reconnecting Reserve will require fresh consent.', { exact: true }).isVisible());
    assert.ok(await focused(ui.cancel), 'Cancel has initial focus');
    assert.equal(deletes, 0, 'opening never revokes');
    if (dismissal === 'Cancel') await ui.cancel.click();
    else if (dismissal === 'backdrop') await page.mouse.click(2, 2);
    else await page.keyboard.press(dismissal);
    await ui.dialog.waitFor({ state: 'hidden' });
    assert.ok(await focused(ui.open), 'focus returned to opener');
    await checkDevices();
    assert.equal(deletes, 0, dismissal + ' never revokes');
  }
  await ui.open.dblclick();
  await page.reload();
  await ui.open.waitFor();
  assert.equal(await ui.dialog.isVisible(), false);
  // Model a handoff with a confirmation left open in another browser profile.
  const otherProfile = await browser.newContext();
  await otherProfile.route('**/*', serveLocalWebsite);
  const abandoned = await otherProfile.newPage();
  await abandoned.goto(site + '/account/settings/');
  await signInWebsite(abandoned);
  const abandonedUI = controls(abandoned);
  await abandonedUI.open.click();
  await abandonedUI.dialog.waitFor();
  await ui.open.click();
  await ui.cancel.click();
  await otherProfile.close();
  await checkDevices();
  assert.equal(deletes, 0, 'an interrupted confirmation never commits in either profile');
  const peer = await context.newPage();
  await peer.goto(site + '/account/settings/');
  const peerUI = controls(peer);
  await Promise.all([ui.open.click(), peerUI.open.click()]);
  await Promise.all([ui.cancel.click(), peerUI.cancel.click()]);
  await checkDevices();
  assert.equal(deletes, 0);
  // A normal keyboard activation of the explicit final button also works.
  await ui.open.click();
  await ui.cancel.press('Tab');
  assert.ok(await focused(ui.confirm));
  await ui.confirm.press('Enter');
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.match(await status.textContent(), /Could not confirm disconnection/);
  assert.equal(deletes, 1, 'one failed attempt');
  await checkDevices();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await ui.open.waitFor();
  assert.equal(deletes, 1, 'Retry only checks the grant');
  await Promise.all([ui.open.click(), peerUI.open.click()]);
  assert.equal(deletes, 1);
  try {
    await ui.confirm.dblclick();
    await Promise.race([successfulDelete.promise, delay(5000).then(() => { throw new Error('expected explicit DELETE'); })]);
    assert.ok(await page.locator('#reserve-disconnection [data-confirm-disconnection]').isDisabled());
    assert.match(await status.innerText(), /Disconnecting/);
    // This tab explicitly confirms too, while the first request is in flight.
    await peerUI.confirm.click();
    assert.equal(deletes, 2, 'only one in-flight DELETE across both tabs');
  } finally {
    releaseDelete.resolve();
  }
  await page.getByText('Reserve staging disconnected on all devices.', { exact: true }).waitFor();
  await peer.getByText('Reserve staging is disconnected.', { exact: true }).waitFor();
  assert.equal(deletes, 2);
  assert.equal(await disconnect.isVisible(), false);
  const remaining = await page.evaluate(async () => {
    const { auth } = window.veniAccount.client;
    const { data, error } = await auth.oauth.listGrants();
    if (error) throw new Error('grant listing failed');
    return { user: (await auth.getUser()).data.user?.id, grants: data.map(grant => grant.client.id) };
  });
  assert.ok(remaining.user === websiteUser, 'Website account remains signed in');
  assert.ok(remaining.grants.length === 1 && remaining.grants[0] === other.client_id, 'control grant remains');
  for (const headers of [a, b]) {
    assert.equal((await app('/api/workspace/session', { headers })).status, 401);
    assert.equal((await app('/app', { headers })).status, 302);
  }
  assert.equal((await settings()).status, 403, 'previously issued Reserve JWT is unauthorized');
  assert.equal((await auth('/auth/v1/user', { headers: bearer(control) })).status, 200);
  const activeControl = await auth('/rest/v1/rpc/reserve_current_reserve_user', {
    method: 'POST', headers: { ...json, ...bearer(control) }, body: '{}',
  });
  assert.equal(await payload(activeControl, 'control client Reserve identity'), null);
  await page.reload();
  await page.getByText('Reserve staging is disconnected.', { exact: true }).waitFor();
  assert.equal(await disconnect.isVisible(), false);
  const restart = await app('/auth/veni/start');
  await consent(restart.headers.get('location'), primary, true, false);
  console.log('PASS GoTrue v2.198.0: open, Cancel, Escape, backdrop, keyboard, reload and concurrent dismissals sent zero DELETEs. One simulated failed DELETE and one successful DELETE. Both Worker sessions and a bearer denied; Website and control app retained; fresh consent and empty workspace.');
} finally {
  await browser?.close();
  server?.kill();
  if (ownsVars) unlinkSync(varsFile);
  for (const id of registrations) await auth(clients + '/' + id, { method: 'DELETE', headers: admin });
  if (websiteUser) await auth('/auth/v1/admin/users/' + websiteUser, { method: 'DELETE', headers: admin });
}
