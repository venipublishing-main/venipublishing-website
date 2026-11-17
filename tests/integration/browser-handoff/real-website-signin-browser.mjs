/**
 * Browser gate for the ACTUAL Website account/sign-in and account hub HTML/JS.
 *
 * A disposable shared GoTrue/PostgREST stack supplies an entirely fictional
 * adult actor. The Website files are read directly from the checked-out repo;
 * only its public Supabase config is replaced with the loopback test target.
 * A synthetic second origin represents Reserve's *browser storage boundary*,
 * not Reserve's production SSR or a seamless Website -> Reserve SSO journey.
 *
 * Fail closed unless this is explicitly the disposable integrated rehearsal.
 * Hosted Supabase URLs, production accounts and external scripts are forbidden.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';

for (const key of [
  'VENI_DUAL_AUTH_DISPOSABLE',
  'VENI_ATOMIC_RESERVE_REHEARSAL',
  'VENI_BROWSER_REAL_AUTH',
]) {
  assert.equal(process.env[key], 'yes', `${key}=yes is required`);
}

function requireLocalTarget(value) {
  assert.ok(value, 'Missing disposable TARGET_API_URL');
  const url = new URL(value);
  assert.equal(url.protocol, 'http:', 'HTTPS/hosted Auth is prohibited');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(Number(url.port) >= 20000 && Number(url.port) <= 32767);
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return url.origin;
}

const api = requireLocalTarget(process.env.TARGET_API_URL);
const anon = process.env.TARGET_ANON_KEY;
assert.ok(typeof anon === 'string' && anon.length >= 12, 'Local anon key is required');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await readFile(new URL('./node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url));
assert.ok(bundle.length > 10000, 'Pinned local Supabase browser bundle is unavailable');

const marker = randomBytes(9).toString('hex');
const actor = {
  email: `website-ui-${marker}@example.invalid`,
  password: `Veni-UI-CI-${marker}-Adult-42!`,
};

async function registerFictionalActor() {
  const response = await fetch(`${api}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: actor.email,
      password: actor.password,
      data: {
        display_name: 'Disposable Website Browser Actor',
        role: 'owner', // Untrusted metadata must never create Reserve permissions.
        tenant_id: 'c1111111-1111-4111-8111-111111111111',
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 200, `Local GoTrue signup HTTP ${response.status}`);
  const data = await response.json();
  assert.match(data.user?.id ?? '', /^[0-9a-f-]{36}$/i);
  assert.ok(data.access_token && data.refresh_token, 'Disposable local session is required');
  return data.user.id;
}

const files = new Map([
  ['/account/sign-in/', 'account/sign-in/index.html'],
  ['/account/', 'account/index.html'],
  ['/assets/js/site.js', 'assets/js/site.js'],
  ['/assets/js/veni-account.js', 'assets/js/veni-account.js'],
  ['/assets/css/site.css', 'assets/css/site.css'],
  ['/assets/css/v2.css', 'assets/css/v2.css'],
  ['/assets/css/account-v2.css', 'assets/css/account-v2.css'],
  ['/assets/images/favicon.svg', 'assets/images/favicon.svg'],
  ['/assets/images/veni-crest.svg', 'assets/images/veni-crest.svg'],
  ['/site.webmanifest', 'site.webmanifest'],
]);

function contentType(pathname) {
  if (pathname.endsWith('.html') || pathname.endsWith('/')) return 'text/html; charset=utf-8';
  if (pathname.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.webmanifest')) return 'application/manifest+json';
  return 'application/octet-stream';
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function actualWebsiteOrigin() {
  return listen((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed');
      return;
    }
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;

    // Never serve the checked-in production Supabase config, even accidentally.
    if (pathname === '/assets/js/supabase-config.js') {
      const override = `window.VENI_SUPABASE = Object.freeze(${JSON.stringify({
        url: api,
        publishableKey: anon,
      })});`;
      send(res, 200, req.method === 'HEAD' ? '' : override, contentType(pathname));
      return;
    }

    const relativePath = files.get(pathname);
    if (!relativePath) { send(res, 404, 'Not available in disposable Website fixture'); return; }
    readFile(join(root, relativePath))
      .then(bytes => send(res, 200, req.method === 'HEAD' ? '' : bytes, contentType(pathname)))
      .catch(() => send(res, 500, 'Checked-out Website asset unavailable'));
  });
}

function reserveSyntheticHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="referrer" content="no-referrer"><title>Reserve synthetic storage fixture</title>
  </head><body><h1>Synthetic Reserve origin (not its production app)</h1>
  <script>
  (() => {
    const api = ${JSON.stringify(api)};
    const anon = ${JSON.stringify(anon)};
    const key = 'veni:synthetic-reserve-session';
    const read = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
    const query = async (route, options = {}) => {
      const response = await fetch(api + route, {
        method: options.method || 'GET',
        headers: { apikey: anon, ...options.headers },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { status: response.status, data: await response.json().catch(() => null) };
    };
    window.syntheticReserve = Object.freeze({
      subject: () => read()?.id || null,
      authStorageCount: () => Object.keys(localStorage).filter(k => k.startsWith('sb-')).length,
      async signIn({ email, password }) {
        const result = await query('/auth/v1/token?grant_type=password', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: { email, password },
        });
        if (result.status !== 200 || !result.data?.user?.id || !result.data?.access_token) {
          throw new Error('Synthetic Reserve login denied (HTTP ' + result.status + ')');
        }
        localStorage.setItem(key, JSON.stringify({
          id: result.data.user.id, token: result.data.access_token,
        }));
        return result.data.user.id;
      },
      async activeSession() {
        const session = read();
        if (!session?.token) return false;
        const result = await query('/rest/v1/rpc/veni_account_active_session', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + session.token, 'content-type': 'application/json' },
          body: {},
        });
        if (result.status !== 200 || typeof result.data !== 'boolean') {
          throw new Error('Local live-session RPC unavailable (HTTP ' + result.status + ')');
        }
        return result.data;
      },
      async visibleTenants() {
        const session = read();
        if (!session || !(await this.activeSession())) return [];
        const result = await query('/rest/v1/tenants?select=id', {
          headers: { authorization: 'Bearer ' + session.token, 'accept-profile': 'reserve' },
        });
        if (result.status !== 200 || !Array.isArray(result.data)) {
          throw new Error('Reserve tenant RLS query unavailable (HTTP ' + result.status + ')');
        }
        return result.data.map(row => row.id);
      },
    });
  })();
  </script></body></html>`;
}

async function syntheticReserveOrigin() {
  const html = reserveSyntheticHtml();
  return listen((req, res) => {
    if (req.url !== '/') { send(res, 404, 'Not available'); return; }
    send(res, 200, html, 'text/html; charset=utf-8');
  });
}

async function run() {
  const expectedId = await registerFictionalActor();
  const website = await actualWebsiteOrigin();
  const reserve = await syntheticReserveOrigin();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.VENI_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: false });
    const blockedOrigins = new Set();
    const allowed = new Set([api, website.origin, reserve.origin]);
    await context.route('**/*', async route => {
      const request = new URL(route.request().url());
      if (allowed.has(request.origin)) { await route.continue(); return; }
      if (request.origin === 'https://cdn.jsdelivr.net' &&
          request.pathname === '/npm/@supabase/supabase-js@2' && !request.search) {
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript; charset=utf-8',
          body: bundle,
        });
        return;
      }
      // Block CSS fonts, outbound navigation or any new external script.
      // In particular, credentials and tokens never travel to a hosted system.
      blockedOrigins.add(request.origin);
      await route.abort();
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    // A malicious external next= must fail closed to the local account hub.
    const maliciousNext = encodeURIComponent('https://untrusted.example.invalid/collect');
    await page.goto(`${website.origin}/account/sign-in/?next=${maliciousNext}`);
    await page.waitForFunction(() => window.veniAccount?.client &&
      document.documentElement.dataset.accountState === 'signed-out');
    assert.equal(await page.evaluate(() => window.VENI_SUPABASE.url), api,
      'Real Website page must only use the disposable Auth endpoint');
    assert.equal(await page.locator('[data-sign-in-form]').count(), 1);
    await page.locator('[data-sign-in-form] [name="email"]').fill(actor.email);
    await page.locator('[data-sign-in-form] [name="password"]').fill(actor.password);
    await Promise.all([
      page.waitForURL(url => url.origin === website.origin && url.pathname === '/account/' &&
        !url.search && !url.hash, { timeout: 30000 }),
      page.locator('[data-sign-in-form] button[type="submit"]').click(),
    ]);
    await page.waitForFunction(() => document.documentElement.dataset.accountState === 'signed-in');

    const websiteState = await page.evaluate(async () => {
      const client = window.veniAccount.client;
      const userResult = await client.auth.getUser();
      const id = userResult.data.user?.id;
      const profileResult = await client.from('profiles').select('id,display_name').eq('id', id).maybeSingle();
      return {
        id,
        authError: userResult.error?.message || null,
        profileId: profileResult.data?.id || null,
        profileError: profileResult.error?.message || null,
        signedInShown: !document.querySelector('[data-auth-view="signed-in"]').hidden,
        displayedEmail: document.querySelector('[data-user-email]').textContent,
        authStorageCount: Object.keys(localStorage).filter(key => /^sb-.*-auth-token$/.test(key)).length,
      };
    });
    assert.equal(websiteState.authError, null);
    assert.equal(websiteState.profileError, null);
    assert.equal(websiteState.id, expectedId);
    assert.equal(websiteState.profileId, expectedId);
    assert.equal(websiteState.signedInShown, true);
    assert.equal(websiteState.displayedEmail, actor.email);
    assert.ok(websiteState.authStorageCount >= 1);
    console.log('PASS: real Website sign-in form, checked-in JS, redirect, account hub and profile RLS');
    console.log('PASS: real Website next= rejects an external redirect and exposes no credentials in URL');

    await page.goto(`${reserve.origin}/`);
    assert.equal(await page.evaluate(() => window.syntheticReserve.subject()), null);
    assert.equal(await page.evaluate(() => window.syntheticReserve.authStorageCount()), 0);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.deepEqual(await page.evaluate(() => window.syntheticReserve.visibleTenants()), []);
    const reserveId = await page.evaluate(credentials => window.syntheticReserve.signIn(credentials), actor);
    assert.equal(reserveId, expectedId, 'Second explicit login must reuse the Website identity');
    assert.equal(await page.evaluate(() => window.syntheticReserve.activeSession()), true);
    assert.deepEqual(await page.evaluate(() => window.syntheticReserve.visibleTenants()), [],
      'Forged role=owner metadata must not grant Reserve tenant membership');
    assert.equal(new URL(page.url()).search, '');
    assert.equal(new URL(page.url()).hash, '');
    console.log('PASS: synthetic Reserve origin has no Website browser session; second login uses same UUID');
    console.log('PASS: Reserve tenant RLS refuses user_metadata role spoofing');

    await page.goto(`${website.origin}/account/`);
    await page.waitForFunction(() => document.documentElement.dataset.accountState === 'signed-in');
    const logoutMenu = page.locator('.desktop-nav [data-account-menu-button]');
    await logoutMenu.click();
    await page.locator('.desktop-nav [data-account-signout]').click();
    await page.waitForURL(url => url.origin === website.origin && url.pathname === '/account/' &&
      !url.search && !url.hash, { timeout: 30000 });
    await page.waitForFunction(() => document.documentElement.dataset.accountState === 'signed-out');
    assert.equal(await page.evaluate(() => Object.keys(localStorage)
      .filter(key => /^sb-.*-auth-token$/.test(key)).length), 0);

    await page.goto(`${reserve.origin}/`);
    assert.equal(await page.evaluate(() => window.syntheticReserve.subject()), expectedId,
      'Reserve localStorage is separate and remains cached until revoked/cleared there');
    assert.equal(await page.evaluate(() => window.syntheticReserve.activeSession()), false,
      'Reserve must reject cached JWT at the local live-session RPC after Website logout');
    assert.deepEqual(await page.evaluate(() => window.syntheticReserve.visibleTenants()), []);
    console.log('PASS: real Website navigation logout globally revokes cached Reserve token at tested RPC');

    assert.deepEqual(pageErrors, [], 'No Website/fixture JavaScript exceptions');
    assert.ok(!blockedOrigins.has('https://untrusted.example.invalid'),
      'Website must never navigate to a malicious next= target');
    await context.close();
    console.log('WEBSITE UI GATE: real sign-in + logout PASS against disposable Auth.');
    console.log('LIMIT: Reserve origin is synthetic; seamless SSO and Reserve SSR are NOT proven.');
  } finally {
    await browser?.close();
    await Promise.all([website.close(), reserve.close()]);
  }
}

await run();
