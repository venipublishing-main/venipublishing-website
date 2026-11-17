/**
 * CI-only browser proof of the REAL Website sign-in + OAuth consent UI and the
 * REAL Reserve React Router SSR OAuth/PKCE receiving client.
 *
 * All identities, OAuth clients, TLS certificates, Worker secrets and database
 * state are disposable. Only explicitly permitted loopback network addresses
 * may be reached; never use this against a hosted Supabase project.
 *
 * The Website's HTTPS/publishable-key and registered-client guards remain
 * unchanged. This runner supplies an isolated HTTPS-to-loopback facade and a
 * test-only allowlist at the local static-file server boundary.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer as createHTTPServer, request as httpRequest } from 'node:http';
import { createServer as createHTTPSServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEBSITE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RESERVE_ROOT = resolve(WEBSITE_ROOT, '../reserve');
const CONSENT_ROOT = resolve(WEBSITE_ROOT, '../website-consent');
const DEV_VARS = join(RESERVE_ROOT, '.dev.vars');
const WEBSITE = 'http://127.0.0.1:3000';
const RESERVE = 'http://127.0.0.1:5193';
const GOTRUE = 'http://127.0.0.1:54321';
const API_FACADE = 'https://127.0.0.1:54443';
const CALLBACK = `${RESERVE}/auth/veni/callback`;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FILES = new Map([
  ['/account/sign-in/', [WEBSITE_ROOT, 'account/sign-in/index.html']],
  ['/account/', [WEBSITE_ROOT, 'account/index.html']],
  ['/account/authorize/', [CONSENT_ROOT, 'account/authorize/index.html']],
  ['/assets/js/site.js', [WEBSITE_ROOT, 'assets/js/site.js']],
  ['/assets/js/veni-account.js', [WEBSITE_ROOT, 'assets/js/veni-account.js']],
  ['/assets/js/veni-oauth-consent.mjs', [CONSENT_ROOT, 'assets/js/veni-oauth-consent.mjs']],
  ['/assets/js/veni-oauth-contract.mjs', [CONSENT_ROOT, 'assets/js/veni-oauth-contract.mjs']],
  ['/assets/css/site.css', [WEBSITE_ROOT, 'assets/css/site.css']],
  ['/assets/css/v2.css', [WEBSITE_ROOT, 'assets/css/v2.css']],
  ['/assets/css/account-v2.css', [WEBSITE_ROOT, 'assets/css/account-v2.css']],
  ['/assets/css/veni-oauth-consent.css', [CONSENT_ROOT, 'assets/css/veni-oauth-consent.css']],
  ['/assets/images/favicon.svg', [WEBSITE_ROOT, 'assets/images/favicon.svg']],
  ['/assets/images/veni-crest.svg', [WEBSITE_ROOT, 'assets/images/veni-crest.svg']],
  ['/site.webmanifest', [WEBSITE_ROOT, 'site.webmanifest']],
]);

let phase = 'local guard';
let assertions = 0;
let anonKey = '';
let serviceKey = '';
let clientId = '';
let syntheticUserId = '';
let actor;
let browser;
let websiteServer;
let proxyServer;
let reserveProcess;
let temporaryCertificateDirectory;
let createdDevVars = false;
let completed = false;

function check(value, label) { assert.ok(value, label); assertions++; }
function response(res, status, data, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  res.end(data);
}
function contentType(path) {
  if (path.endsWith('/') || path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}
function serverListen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
}
function serverClose(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise(resolveClose => server.close(resolveClose));
}
function localTarget(path) {
  const url = new URL(path, GOTRUE);
  assert.equal(url.origin, GOTRUE, 'Provider must be disposable loopback');
  return url;
}
async function gotrue(path, { method = 'GET', body, auth } = {}) {
  const r = await fetch(localTarget(path), {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    headers: {
      apikey: anonKey,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  check(r.ok, `Local Auth ${method} accepted`);
  const payload = await r.text();
  return payload ? JSON.parse(payload) : null;
}
async function admin(path, method, body) {
  return gotrue(path, { method, body, auth: serviceKey });
}

async function reserveRequest(path, cookie = '') {
  const url = new URL(path, RESERVE);
  assert.equal(url.origin, RESERVE, 'Only the disposable Reserve local origin is allowed');
  return fetch(url, {
    redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function responseCookie(response, name) {
  return response.headers.getSetCookie().find(entry => entry.startsWith(`${name}=`))?.split(';')[0] ?? '';
}

async function startWebsiteServer(fakeKey) {
  websiteServer = createHTTPServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      response(res, 405, 'Read-only Website rehearsal'); return;
    }
    const path = new URL(req.url, WEBSITE).pathname;
    if (path === '/assets/js/supabase-config.js') {
      const config = `window.VENI_SUPABASE = Object.freeze(${JSON.stringify({
        url: API_FACADE, publishableKey: fakeKey,
      })});`;
      response(res, 200, req.method === 'HEAD' ? '' : config, contentType(path)); return;
    }
    if (path === '/assets/js/veni-oauth-clients.js') {
      const clients = [{
        clientId, label: 'Veni Reserve (disposable)', redirectUris: [CALLBACK],
        allowedScopes: ['email', 'openid'],
      }];
      const allowlist = `window.VENI_OAUTH_ALLOWED_CLIENTS = Object.freeze(${JSON.stringify(clients)});`;
      response(res, 200, req.method === 'HEAD' ? '' : allowlist, contentType(path)); return;
    }
    const fixture = FILES.get(path);
    if (!fixture) { response(res, 404, 'Not part of isolated Website rehearsal'); return; }
    readFile(join(...fixture))
      .then(bytes => response(res, 200, req.method === 'HEAD' ? '' : bytes, contentType(path)))
      .catch(() => response(res, 500, 'Expected checked-out asset missing'));
  });
  await serverListen(websiteServer, 3000);
}

async function startLocalHTTPSFacade(fakeKey) {
  temporaryCertificateDirectory = mkdtempSync(join(tmpdir(), 'veni-account-browser-tls-'));
  const cert = join(temporaryCertificateDirectory, 'test.crt');
  const key = join(temporaryCertificateDirectory, 'test.key');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', key, '-out', cert,
  ], { stdio: 'ignore', timeout: 15000 });
  proxyServer = createHTTPSServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) {
      response(res, 400, 'Invalid local proxy path'); return;
    }
    const corsHeaders = {
      'access-control-allow-origin': WEBSITE,
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile',
      'access-control-expose-headers': 'content-range,x-total-count',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsHeaders, 'cache-control': 'no-store' }); res.end(); return;
    }
    const headers = { ...req.headers, host: '127.0.0.1:54321', apikey: anonKey };
    delete headers.origin;
    delete headers.cookie;
    if (headers.authorization === `Bearer ${fakeKey}`) {
      headers.authorization = `Bearer ${anonKey}`;
    }
    const upstream = httpRequest(localTarget(req.url), { method: req.method, headers }, upstreamRes => {
      res.writeHead(upstreamRes.statusCode ?? 502, {
        ...upstreamRes.headers, ...corsHeaders,
        'cache-control': 'no-store',
      });
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) response(res, 502, 'Local provider not available');
      else res.destroy();
    });
    req.pipe(upstream);
  });
  await serverListen(proxyServer, 54443);
}

async function awaitReserve() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (reserveProcess?.exitCode !== null) throw new Error('Reserve development server stopped');
    try {
      const res = await fetch(`${RESERVE}/health`, {
        redirect: 'manual', signal: AbortSignal.timeout(2000),
      });
      if (res.status === 200) return;
    } catch { /* development startup is not instantaneous */ }
    await delay(1000);
  }
  throw new Error('Reserve development server did not become ready');
}

async function waitForConsent(page, userId, email) {
  await page.locator('[data-oauth-consent]').waitFor({ state: 'visible', timeout: 30000 });
  check(await page.locator('[data-oauth-approve]').isEnabled(), 'Actual Website approve action enabled');
  check(await page.locator('[data-oauth-deny]').isEnabled(), 'Actual Website deny action enabled');
  check((await page.locator('[data-oauth-client-label]').innerText()) === 'Veni Reserve (disposable)',
    'Actual consent labels correct OAuth client');
  check((await page.locator('[data-oauth-email]').innerText()) === email,
    'Actual consent binds the signed-in synthetic adult');
  check((await page.locator('[data-oauth-redirect]').innerText()) === CALLBACK,
    'Actual consent displays precise registered SSR callback');
  check((await page.locator('[data-oauth-scopes]').innerText()).includes('email'),
    'Actual consent describes the requested email scope');
  const browserId = await page.evaluate(async () =>
    (await window.supabase.createClient(window.VENI_SUPABASE.url,
      window.VENI_SUPABASE.publishableKey).auth.getUser()).data.user?.id);
  check(browserId === userId, 'Actual consent shares Website Auth identity');
}

try {
  phase = 'strict disposal and environment boundary';
  check(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
    'Only a GitHub-hosted disposable runner may execute');
  check(process.env.VENI_OAUTH_BROWSER_DISPOSABLE === 'yes', 'Explicit browser rehearsal flag required');
  check(process.env.SUPABASE_EXPERIMENTAL_STACK === '0', 'Pinned local Supabase stack required');
  check(process.platform === 'linux' && process.versions.node.startsWith('24.'), 'Linux Node24 pinned');
  check(!existsSync(DEV_VARS), 'Never overwrite another Reserve development secret file');
  const cli = join(RESERVE_ROOT, 'node_modules/supabase/dist/supabase.js');
  const status = JSON.parse(execFileSync(process.execPath, [cli, 'status', '-o', 'json'], {
    cwd: RESERVE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  }));
  check(status.API_URL === GOTRUE, 'Supabase CLI points to the exact disposable loopback project');
  check(typeof status.ANON_KEY === 'string' && typeof status.SERVICE_ROLE_KEY === 'string',
    'Local provider keys supplied by isolated CLI stack');
  anonKey = status.ANON_KEY;
  serviceKey = status.SERVICE_ROLE_KEY;

  phase = 'create synthetic OAuth client and identity';
  const registered = await admin('/auth/v1/admin/oauth/clients', 'POST', {
    name: `Reserve browser rehearsal ${randomUUID()}`,
    redirect_uris: [CALLBACK], client_type: 'confidential',
    token_endpoint_auth_method: 'client_secret_basic',
  });
  check(UUID.test(registered.client_id ?? '') && (registered.client_secret?.length ?? 0) >= 16,
    'Real local GoTrue registered confidential OAuth client');
  clientId = registered.client_id;
  actor = {
    email: `reserve-browser-${randomUUID()}@example.invalid`,
    password: `${randomBytes(24).toString('base64url')}Aa!9`,
  };
  const user = await admin('/auth/v1/admin/users', 'POST', {
    ...actor, email_confirm: true,
  });
  check(UUID.test(user.id ?? ''), 'Real disposable GoTrue synthetic user created');
  syntheticUserId = user.id;

  phase = 'start actual Reserve SSR and local Website servers';
  writeFileSync(DEV_VARS, [
    `VENI_OAUTH_CLIENT_ID=${JSON.stringify(clientId)}`,
    `VENI_OAUTH_CLIENT_SECRET=${JSON.stringify(registered.client_secret)}`,
    `VENI_OAUTH_PUBLISHABLE_KEY=${JSON.stringify(anonKey)}`,
    `VENI_OAUTH_COOKIE_KEY=${JSON.stringify(randomBytes(32).toString('base64url'))}`,
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  createdDevVars = true;
  const fakePublicKey = `sb_publishable_local_${randomBytes(18).toString('hex')}`;
  await Promise.all([startWebsiteServer(fakePublicKey), startLocalHTTPSFacade(fakePublicKey)]);
  reserveProcess = spawn(process.execPath, ['local/veni-oauth-start.mjs'], {
    cwd: RESERVE_ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, VENI_LOCAL_OAUTH: '1' },
  });
  await awaitReserve();

  phase = 'malformed SSR state, callback and next-path rejection';
  const started = await reserveRequest('/auth/veni/start?next=%2Fapp');
  check(started.status === 303, 'Real Reserve SSR starts an isolated OAuth transaction');
  const authorizeURL = new URL(started.headers.get('location'), RESERVE);
  check(authorizeURL.origin === GOTRUE && authorizeURL.pathname === '/auth/v1/oauth/authorize' &&
    authorizeURL.searchParams.get('code_challenge_method') === 'S256',
  'Reserve redirects only to loopback PKCE S256 Auth');
  const trueState = authorizeURL.searchParams.get('state');
  const transactionCookie = responseCookie(started, 'vr_local_oauth_transaction');
  check(!!trueState && !!transactionCookie, 'Unique local state and sealed transaction cookie exist');
  const fakeCode = randomBytes(32).toString('base64url');
  const invalidState = randomBytes(32).toString('base64url');
  const tamperedState = await reserveRequest(
    `/auth/veni/callback?code=${fakeCode}&state=${invalidState}`, transactionCookie);
  check(tamperedState.status === 400 &&
    !responseCookie(tamperedState, 'vr_local_oauth_session'),
  'Forged OAuth state cannot establish a Reserve session');
  const duplicateState = await reserveRequest(
    `/auth/veni/callback?code=${fakeCode}&state=${trueState}&state=${trueState}`, transactionCookie);
  check(duplicateState.status === 400 &&
    !responseCookie(duplicateState, 'vr_local_oauth_session'),
  'Duplicated callback parameters fail before token exchange');
  const duplicateNext = await reserveRequest('/auth/veni/start?next=%2Fapp&next=%2Fapp');
  check(duplicateNext.status === 400,
    'Duplicated Reserve return destination is refused');
  const externalNext = await reserveRequest('/auth/veni/start?next=https%3A%2F%2Fsteal.example.invalid%2F');
  check(externalNext.status === 303 &&
    new URL(externalNext.headers.get('location'), RESERVE).origin === GOTRUE,
  'Malicious external return destination cannot become an open redirect');
  console.log('PASS: real Reserve SSR rejects altered state, duplicate parameters and untrusted destinations');

  phase = 'real Chromium Website and Reserve redirects';
  const bundle = await readFile(new URL('./node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url));
  check(bundle.length > 10000, 'Pinned offline browser SDK available');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const allowedOrigins = new Set([WEBSITE, RESERVE, GOTRUE, API_FACADE]);
  const blocked = new Set();
  const guardRequest = async route => {
    const request = new URL(route.request().url());
    if (allowedOrigins.has(request.origin)) { await route.continue(); return; }
    if (request.origin === 'https://cdn.jsdelivr.net' &&
        ['/npm/@supabase/supabase-js@2', '/npm/@supabase/supabase-js@2.119.0'].includes(request.pathname) &&
        !request.search && !request.hash) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: bundle });
      return;
    }
    blocked.add(request.origin);
    await route.abort();
  };
  await context.route('**/*', guardRequest);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', () => pageErrors.push('browser-script-error'));
  await page.goto(`${RESERVE}/development/veni-account`, { waitUntil: 'domcontentloaded' });
  check((await page.locator('body').innerText()).includes('No verified local Veni Account session'),
    'Reserve SSR initially has no connected account');

  phase = 'Reserve start to actual Website sign-in';
  await Promise.all([
    page.waitForURL(url => url.origin === WEBSITE && url.pathname === '/account/sign-in/',
      { timeout: 60000 }),
    page.getByRole('link', { name: 'Start local consent test' }).click(),
  ]);
  const next = new URL(page.url()).searchParams.get('next');
  check(next?.startsWith('/account/authorize/?authorization_id='),
    'Website sign-in maintains same-origin opaque authorization resume');
  await page.waitForFunction(() => document.documentElement.dataset.accountState === 'signed-out');
  check(await page.locator('[data-sign-in-form]').count() === 1,
    'Actual Website password form reached through OAuth');
  await page.locator('[data-sign-in-form] [name="email"]').fill(actor.email);
  await page.locator('[data-sign-in-form] [name="password"]').fill(actor.password);
  await Promise.all([
    page.waitForURL(url => url.origin === WEBSITE && url.pathname === '/account/authorize/',
      { timeout: 60000 }),
    page.locator('[data-sign-in-form] button[type="submit"]').click(),
  ]);
  await waitForConsent(page, syntheticUserId, actor.email);
  console.log('PASS: Reserve SSR start → real OAuth2/PKCE → real Website sign-in and consent metadata');

  phase = 'actual Website decline and Reserve SSR rejection';
  await Promise.all([
    page.waitForURL(url => url.origin === RESERVE && url.pathname === '/login',
      { timeout: 60000 }),
    page.locator('[data-oauth-deny]').click(),
  ]);
  check(!(await context.cookies(RESERVE)).some(c => c.name === 'vr_local_oauth_session'),
    'Declined OAuth consent creates no Reserve connected-session cookie');
  await page.goto(`${RESERVE}/development/veni-account`);
  check((await page.locator('body').innerText()).includes('No verified local Veni Account session'),
    'Reserve SSR confirms denial did not establish a session');
  console.log('PASS: actual Website Decline returns to blocked Reserve without a connected session');

  phase = 'second Reserve start with existing Website session';
  await Promise.all([
    page.waitForURL(url => url.origin === WEBSITE && url.pathname === '/account/authorize/',
      { timeout: 60000 }),
    page.getByRole('link', { name: 'Start local consent test' }).click(),
  ]);
  await waitForConsent(page, syntheticUserId, actor.email);
  check(new URL(page.url()).pathname === '/account/authorize/',
    'Already-signed-in account resumes consent without entering a second password');

  phase = 'actual Website Allow and Reserve SSR code exchange';
  const originalTxCookie = (await context.cookies(RESERVE)).find(c => c.name === 'vr_local_oauth_transaction');
  check(originalTxCookie?.httpOnly && originalTxCookie.sameSite === 'Lax',
    'Pre-approval state is kept in a sealed HttpOnly transaction cookie');
  let consumedCallbackURL = '';
  const rememberCallback = request => {
    const u = new URL(request.url());
    if (u.origin === RESERVE && u.pathname === '/auth/veni/callback') consumedCallbackURL = u.href;
  };
  page.on('request', rememberCallback);
  await Promise.all([
    page.waitForURL(url => url.origin === RESERVE && url.pathname === '/development/veni-account',
      { timeout: 60000 }),
    page.locator('[data-oauth-approve]').click(),
  ]);
  page.off('request', rememberCallback);
  check(!!consumedCallbackURL && new URL(consumedCallbackURL).searchParams.has('code'),
    'Actual browser navigated through a real one-time OAuth callback');
  const reserveHTML = await page.content();
  check(reserveHTML.includes(syntheticUserId) && reserveHTML.includes('not granted'),
    'Real Reserve SSR verified matching identity but kept business access locked');
  check(!reserveHTML.includes(actor.email) && !reserveHTML.includes(actor.password),
    'Server-rendered Reserve HTML does not disclose Website login credentials');
  const connected = (await context.cookies(RESERVE)).find(c => c.name === 'vr_local_oauth_session');
  check(!!connected?.httpOnly && connected.sameSite === 'Lax',
    'Local Reserve SSR established bounded HttpOnly SameSite session cookie');
  check(connected.expires > Math.floor(Date.now() / 1000) &&
    connected.expires <= Math.ceil(Date.now() / 1000) + 300,
  'Local Reserve connected cookie never outlives five-minute pilot limit');
  check(!(await page.evaluate(() => document.cookie)).includes('vr_local_oauth_session'),
    'HttpOnly connected cookie is unreadable to browser JavaScript');
  check(new URL(page.url()).search === '' && new URL(page.url()).hash === '',
    'Final browser address has neither OAuth code nor credential fragments');
  await page.goto(`${RESERVE}/app`);
  check(new URL(page.url()).pathname === '/login',
    'Successful OAuth identity does not bypass Reserve tenant/business login');
  console.log('PASS: actual Website Allow → real Reserve SSR PKCE callback, bound UUID and locked tenant gate');

  phase = 'used OAuth code replay and tampered SSR session rejection';
  const replayURL = new URL(consumedCallbackURL);
  const replay = await reserveRequest(`${replayURL.pathname}${replayURL.search}`,
    `vr_local_oauth_transaction=${originalTxCookie.value}`);
  check(replay.status === 503 && !responseCookie(replay, 'vr_local_oauth_session'),
    'A redeemed OAuth code fails even with its original valid state and transaction cookie');
  const [iv, encryptedSession] = connected.value.split('.');
  check(!!iv && !!encryptedSession, 'Reserve session is an authenticated sealed value');
  const modified = `${iv}.${encryptedSession[0] === 'A' ? 'B' : 'A'}${encryptedSession.slice(1)}`;
  const forgedSessionResponse = await reserveRequest('/development/veni-account',
    `vr_local_oauth_session=${modified}`);
  check(forgedSessionResponse.status === 200 &&
    (await forgedSessionResponse.text()).includes('No verified local Veni Account session'),
  'Tampering with a sealed session is rejected by actual Reserve SSR');

  phase = 'independent browser context cannot inherit first context';
  const isolatedContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await isolatedContext.route('**/*', guardRequest);
    const otherPage = await isolatedContext.newPage();
    await otherPage.goto(`${RESERVE}/development/veni-account`);
    check((await otherPage.locator('body').innerText()).includes('No verified local Veni Account session'),
      'A second Chromium browser context has no Reserve connection');
    await otherPage.goto(`${WEBSITE}/account/sign-in/`);
    await otherPage.waitForFunction(() => document.documentElement.dataset.accountState === 'signed-out');
    check(await otherPage.locator('[data-sign-in-form]').isVisible(),
      'A second Chromium browser context does not inherit Website sign-in');
  } finally { await isolatedContext.close(); }
  console.log('PASS: one-time code replay, sealed-cookie forgery and cross-context session isolation');

  phase = 'Reserve browser-session loss and fresh Website reauthorization';
  // Model expiry/eviction at the browser boundary without waiting five minutes.
  // This does not claim the Reserve server clock or refresh path was exercised.
  await context.clearCookies({ name: 'vr_local_oauth_session' });
  check(!(await context.cookies(RESERVE)).some(c => c.name === 'vr_local_oauth_session'),
    'Only the browser-held Reserve connected session was removed');
  console.log('RECOVERY: removed browser-held Reserve cookie');
  await page.goto(`${WEBSITE}/account/`);
  await page.waitForFunction(() => ['signed-in', 'signed-out'].includes(
    document.documentElement.dataset.accountState));
  check(await page.evaluate(() => document.documentElement.dataset.accountState) === 'signed-in',
    'Central Website session remains authenticated when Reserve cookie is removed');
  console.log('RECOVERY: Website sign-in remains independently valid');
  await page.goto(`${RESERVE}/development/veni-account`);
  check((await page.locator('body').innerText()).includes('No verified local Veni Account session'),
    'Real Reserve SSR refuses the removed/expired browser session');
  const reconnectLink = page.getByRole('link', { name: 'Start local consent test' });
  check(await reconnectLink.isVisible(), 'Signed-out Reserve SSR still offers a fresh account link');
  console.log('RECOVERY: Reserve SSR is unverified and offers reconnect');
  let freshCallbackSeen = false;
  const observeRecoveryCallback = request => {
    const u = new URL(request.url());
    if (u.origin === RESERVE && u.pathname === '/auth/veni/callback' &&
        u.searchParams.has('code') && u.searchParams.has('state')) {
      freshCallbackSeen = true;
    }
  };
  page.on('request', observeRecoveryCallback);
  await reconnectLink.click();
  let recoveryPath = '';
  for (let attempt = 0; attempt < 150 && !recoveryPath; attempt++) {
    const u = new URL(page.url());
    if (u.origin === RESERVE && u.pathname === '/development/veni-account') {
      recoveryPath = 'consent-reused';
    } else if (u.origin === WEBSITE && u.pathname === '/account/authorize/' &&
        await page.locator('[data-oauth-consent]').isVisible()) {
      recoveryPath = 'consent-required';
    } else if (u.origin === WEBSITE && u.pathname === '/account/sign-in/' &&
        await page.locator('[data-sign-in-form]').isVisible()) {
      recoveryPath = 'password-required';
    } else {
      await delay(100);
    }
  }
  check(recoveryPath === 'consent-required' || recoveryPath === 'consent-reused',
    'Existing Website account resumes OAuth without requiring a second password');
  if (recoveryPath === 'consent-required') {
    await waitForConsent(page, syntheticUserId, actor.email);
    await Promise.all([
      page.waitForURL(url => url.origin === RESERVE && url.pathname === '/development/veni-account',
        { timeout: 60000 }),
      page.locator('[data-oauth-approve]').click(),
    ]);
  }
  page.off('request', observeRecoveryCallback);
  check(freshCallbackSeen, 'Reauthorization travels through a fresh one-time Reserve OAuth callback');
  console.log('RECOVERY: Website reauthorization completed with ' + recoveryPath);
  const reconnectedBody = await page.content();
  check(reconnectedBody.includes(syntheticUserId) && reconnectedBody.includes('not granted'),
    'Fresh OAuth approval restores the same verified UUID but no Reserve business authority');
  const reconnectedCookie = (await context.cookies(RESERVE)).find(c => c.name === 'vr_local_oauth_session');
  check(reconnectedCookie?.httpOnly && reconnectedCookie.sameSite === 'Lax' &&
    reconnectedCookie.value !== connected.value,
    'Reauthorization issues a distinct sealed HttpOnly Reserve session');
  await page.goto(`${RESERVE}/app`);
  check(new URL(page.url()).pathname === '/login',
    'Reauthenticated identity still cannot enter a Reserve business without membership');
  console.log('PASS: Reserve browser-session loss is fail-closed; fresh Website consent recovers identity only');

  phase = 'actual Website sign-out and Reserve live session revocation';
  await page.goto(`${WEBSITE}/account/`);
  await page.waitForFunction(() => document.documentElement.dataset.accountState === 'signed-in');
  await page.locator('.desktop-nav [data-account-menu-button]').click();
  await Promise.all([
    page.waitForURL(url => url.origin === WEBSITE && url.pathname === '/account/' &&
      !url.search && !url.hash, { timeout: 60000 }),
    page.locator('.desktop-nav [data-account-signout]').click(),
  ]);
  await page.waitForFunction(() => document.documentElement.dataset.accountState === 'signed-out');
  await page.goto(`${RESERVE}/development/veni-account`);
  check((await page.locator('body').innerText()).includes('No verified local Veni Account session'),
    'Real Reserve SSR denies stale cookie after Website global sign-out');
  check(pageErrors.length === 0 && blocked.size === 0,
    'No browser script exceptions or external third-party network requests');
  await context.close();
  console.log('PASS: real Website sign-out revokes the local Reserve SSR session; no hosted network');
  completed = true;
} catch (error) {
  // Only static phase names and our own bounded assertion labels may be shown.
  // In particular, do not print OAuth authorization URLs, JWTs, or provider bodies.
  const detail = error?.code === 'ERR_ASSERTION' ? ` (${error.message})` : '';
  console.error(`REAL WEBSITE↔RESERVE SSR BROWSER: FAIL at ${phase}${detail}; sensitive details withheld.`);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { process.exitCode = 1; }
  if (reserveProcess?.pid) {
    try { process.kill(-reserveProcess.pid, 'SIGTERM'); } catch { /* Already exited */ }
  }
  await Promise.all([serverClose(websiteServer), serverClose(proxyServer)]);
  if (createdDevVars) {
    try { unlinkSync(DEV_VARS); } catch { process.exitCode = 1; }
  }
  if (syntheticUserId && serviceKey) {
    try { await admin(`/auth/v1/admin/users/${syntheticUserId}`, 'DELETE'); } catch { process.exitCode = 1; }
  }
  if (clientId && serviceKey) {
    try { await admin(`/auth/v1/admin/oauth/clients/${clientId}`, 'DELETE'); } catch { process.exitCode = 1; }
  }
  if (temporaryCertificateDirectory) {
    rmSync(temporaryCertificateDirectory, { recursive: true, force: true });
  }
  if (completed && !process.exitCode) {
    console.log(`REAL WEBSITE↔RESERVE SSR BROWSER: PASS (${assertions} bounded local-only assertions).`);
    console.log('LIMIT: This is an opt-in local pilot, not hosted SSO, product membership or cutover approval.');
  }
}
