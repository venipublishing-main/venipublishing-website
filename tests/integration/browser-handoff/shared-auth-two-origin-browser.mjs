/**
 * Two-origin *browser* experiment against one real disposable GoTrue/PostgREST.
 * The pages are deliberately synthetic test fixtures, not production Website
 * or Reserve screens. This demonstrates identity and storage boundaries; it
 * does NOT deliver silent cross-origin SSO or prove either production UI.
 *
 * Requires the disposable integrated-target stack and the LOCAL-ONLY
 * public.veni_account_active_session() prototype installed in that stack.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

assert.equal(process.env.VENI_DUAL_AUTH_DISPOSABLE, 'yes');
assert.equal(process.env.VENI_ATOMIC_RESERVE_REHEARSAL, 'yes');
assert.equal(process.env.VENI_BROWSER_REAL_AUTH, 'yes');

function localSupabaseApi(value) {
  assert.ok(value, 'Missing disposable TARGET_API_URL');
  const url = new URL(value);
  assert.equal(url.protocol, 'http:', 'Hosted HTTPS Auth is not a permitted test target');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.ok(Number(url.port) >= 20000 && Number(url.port) <= 32767);
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return url.origin;
}

const api = localSupabaseApi(process.env.TARGET_API_URL);
const anon = process.env.TARGET_ANON_KEY;
assert.ok(typeof anon === 'string' && anon.length >= 12, 'Missing disposable public API key');
const marker = randomBytes(9).toString('hex');
const actor = {
  email: `browser-handoff-${marker}@example.invalid`,
  password: `Veni-CI-${marker}-Adult-42!`,
};

async function signUpFictionalActor() {
  const result = await fetch(`${api}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: actor.email,
      password: actor.password,
      data: {
        display_name: 'Disposable Browser Actor',
        role: 'owner',
        tenant_id: 'c1111111-1111-4111-8111-111111111111',
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(result.status, 200, `Disposable sign-up rejected (HTTP ${result.status})`);
  const data = await result.json();
  assert.match(data.user?.id ?? '', /^[0-9a-f-]{36}$/i);
  assert.ok(data.access_token && data.refresh_token, 'Local GoTrue must issue a real session');
  return data.user.id;
}

function fixturePage(label) {
  // Only the publicly usable anon key and loopback API origin enter the page.
  // Credentials are sent to the browser by Playwright in memory, never via URL.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="referrer" content="no-referrer"><title>${label} synthetic Auth boundary</title>
  </head><body><h1>${label} synthetic Auth origin</h1><p>Disposable CI only.</p>
  <script>
  (() => {
    const api = ${JSON.stringify(api)};
    const anon = ${JSON.stringify(anon)};
    const storageKey = 'veni:browser-handoff-synthetic-session';
    const read = () => { try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; } };
    const json = async (url, options = {}) => {
      const response = await fetch(api + url, {
        method: options.method || 'GET',
        headers: { apikey: anon, ...options.headers },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    };
    window.syntheticAuth = Object.freeze({
      subject: () => read()?.id || null,
      async signIn({ email, password }) {
        const result = await json('/auth/v1/token?grant_type=password', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: { email, password },
        });
        if (result.status !== 200 || !result.data?.user?.id ||
            !result.data?.access_token || !result.data?.refresh_token) {
          throw new Error('Synthetic password sign-in failed (HTTP ' + result.status + ')');
        }
        localStorage.setItem(storageKey, JSON.stringify({
          id: result.data.user.id, token: result.data.access_token,
          refresh: result.data.refresh_token,
        }));
        return result.data.user.id;
      },
      async activeSession() {
        const session = read();
        if (!session?.token) return false;
        const result = await json('/rest/v1/rpc/veni_account_active_session', {
          method: 'POST', headers: {
            authorization: 'Bearer ' + session.token,
            'content-type': 'application/json',
          }, body: {},
        });
        if (result.status !== 200 || typeof result.data !== 'boolean') {
          throw new Error('Live-session RPC unavailable (HTTP ' + result.status + ')');
        }
        return result.data;
      },
      async ownWebsiteProfile() {
        const session = read();
        if (!session?.token) return [];
        const result = await json('/rest/v1/profiles?select=id', {
          headers: { authorization: 'Bearer ' + session.token },
        });
        if (result.status !== 200 || !Array.isArray(result.data)) {
          throw new Error('Website profile read denied unexpectedly (HTTP ' + result.status + ')');
        }
        return result.data.map(row => row.id);
      },
      async visibleReserveTenants() {
        const session = read();
        if (!session || !(await this.activeSession())) return [];
        const result = await json('/rest/v1/tenants?select=id', {
          headers: {
            authorization: 'Bearer ' + session.token,
            'accept-profile': 'reserve',
          },
        });
        if (result.status !== 200 || !Array.isArray(result.data)) {
          throw new Error('Reserve tenant read failed (HTTP ' + result.status + ')');
        }
        return result.data.map(row => row.id);
      },
      async signOutGlobally() {
        const session = read();
        if (!session?.token) return false;
        const response = await fetch(api + '/auth/v1/logout?scope=global', {
          method: 'POST', headers: { apikey: anon, authorization: 'Bearer ' + session.token },
        });
        if (!response.ok) throw new Error('Global logout failed (HTTP ' + response.status + ')');
        localStorage.removeItem(storageKey);
        return true;
      },
    });
  })();
  </script></body></html>`;
}

async function newOrigin(label) {
  const pageHtml = fixturePage(label);
  const referrers = [];
  const server = createServer((req, res) => {
    if (req.url === '/no-secret-referrer') {
      referrers.push(String(req.headers.referer || ''));
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    res.end(pageHtml);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/`, referrers, close: () => new Promise(resolve => server.close(resolve)) };
}

async function run() {
  const originalSubject = await signUpFictionalActor();
  const website = await newOrigin('Website');
  const reserve = await newOrigin('Reserve');
  let browser;
  try {
    const executablePath = process.env.VENI_CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
    const context = await browser.newContext({ ignoreHTTPSErrors: false });
    const page = await context.newPage();

    await page.goto(website.url);
    assert.equal(await page.evaluate(() => window.syntheticAuth.subject()), null);
    const websiteSubject = await page.evaluate(credentials => window.syntheticAuth.signIn(credentials), actor);
    assert.equal(websiteSubject, originalSubject);
    assert.equal(await page.evaluate(() => window.syntheticAuth.activeSession()), true);
    assert.deepEqual(await page.evaluate(() => window.syntheticAuth.ownWebsiteProfile()), [originalSubject]);
    console.log('PASS: genuine Website-origin browser login matches one disposable Auth UUID');

    // Different port == different browser origin. Never read one Sphere's
    // localStorage, access token, refresh token, or session cookie in another.
    await page.goto(reserve.url);
    assert.equal(await page.evaluate(() => window.syntheticAuth.subject()), null);
    assert.equal(await page.evaluate(() => window.syntheticAuth.activeSession()), false);
    assert.deepEqual(await page.evaluate(() => window.syntheticAuth.visibleReserveTenants()), []);
    console.log('PASS: separate Reserve origin does not inherit Website localStorage/session');

    const reserveSubject = await page.evaluate(credentials => window.syntheticAuth.signIn(credentials), actor);
    assert.equal(reserveSubject, websiteSubject, 'A second login must not create a second identity');
    assert.equal(await page.evaluate(() => window.syntheticAuth.activeSession()), true);
    assert.deepEqual(await page.evaluate(() => window.syntheticAuth.ownWebsiteProfile()), [originalSubject]);
    assert.deepEqual(await page.evaluate(() => window.syntheticAuth.visibleReserveTenants()), [],
      'Untrusted role=owner metadata must never create Reserve membership');
    console.log('PASS: same Auth user across both origins; no automatic Reserve tenant/Owner grant');

    assert.equal(new URL(page.url()).search, '', 'No credential/token in Reserve URL query');
    assert.equal(new URL(page.url()).hash, '', 'No credential/token in Reserve URL fragment');
    await page.evaluate(() => fetch('/no-secret-referrer'));
    assert.deepEqual(reserve.referrers, [''], 'Browser must not forward secret-bearing referrer');

    await page.goto(website.url);
    assert.equal(await page.evaluate(() => window.syntheticAuth.subject()), originalSubject);
    assert.equal(await page.evaluate(() => window.syntheticAuth.signOutGlobally()), true);
    assert.equal(await page.evaluate(() => window.syntheticAuth.subject()), null);

    await page.goto(reserve.url);
    assert.equal(await page.evaluate(() => window.syntheticAuth.subject()), originalSubject,
      'Reserve-local browser storage persists independently after Website logout');
    assert.equal(await page.evaluate(() => window.syntheticAuth.activeSession()), false,
      'A cached Reserve bearer token must not count as an active shared Auth session');
    assert.deepEqual(await page.evaluate(() => window.syntheticAuth.visibleReserveTenants()), [],
      'Reserve must fail closed on a revoked original session');
    console.log('PASS: Website global logout revokes Reserve session at the live-session RPC boundary');

    const reloggedSubject = await page.evaluate(credentials => window.syntheticAuth.signIn(credentials), actor);
    assert.equal(reloggedSubject, originalSubject);
    assert.equal(await page.evaluate(() => window.syntheticAuth.activeSession()), true);
    assert.deepEqual(await page.evaluate(() => window.syntheticAuth.visibleReserveTenants()), []);
    console.log('PASS: fresh Reserve login restores identity, never grants a business membership');

    await context.close();
    console.log('BROWSER GATE: one shared identity and cross-origin containment proven locally; seamless SSO NOT proven.');
  } finally {
    await browser?.close();
    await Promise.all([website.close(), reserve.close()]);
  }
}

await run();
