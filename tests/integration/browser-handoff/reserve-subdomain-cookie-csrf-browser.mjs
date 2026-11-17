/**
 * Disposable, real-Chromium policy contract for a future HTTPS Veni Account
 * (account.veni.test) + Reserve (reserve.veni.test) deployment.
 *
 * This models browser/domain boundaries and CSRF checks only. It does NOT
 * claim that production Reserve currently implements these cookie names,
 * an authenticated mutation route, or a hosted Veni session. The separate
 * real Reserve SSR OAuth test verifies the current local app implementation.
 * No hosted URL, account, database or network request is permitted here.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHTTPSServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 55443;
const ACCOUNT_HOST = 'account.veni.test';
const RESERVE_HOST = 'reserve.veni.test';
const ATTACKER_HOST = 'attacker.test';
const ACCOUNT = `https://${ACCOUNT_HOST}:${PORT}`;
const RESERVE = `https://${RESERVE_HOST}:${PORT}`;
const ATTACKER = `https://${ATTACKER_HOST}:${PORT}`;
const ALLOWED = new Set([ACCOUNT, RESERVE, ATTACKER]);
const SESSION = '__Host-vr_test_session';
const SHORT_LIVED = '__Host-vr_test_expiry';
const DANGEROUS_DOMAIN_COOKIE = 'vr_unprefixed_demo';
const secret = randomBytes(32).toString('base64url');
const csrf = randomBytes(32).toString('base64url');
const fake = randomBytes(32).toString('base64url');
const observed = [];

let phase = 'guard';
let assertions = 0;
let mutations = 0;
let browser;
let server;
let certificateDirectory;
let completed = false;

function check(value, label) { assert.ok(value, label); assertions++; }
function send(res, status, data, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'private, no-store, max-age=0',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(data);
}
function html(res, markup, extra = {}) {
  send(res, 200, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Disposable Veni cookie contract</title><body>${markup}</body></html>`,
    'text/html; charset=utf-8', extra);
}
function cookieSeen(req, name = SESSION, value = secret) {
  const pairs = (req.headers.cookie ?? '').split(';').map(x => x.trim());
  return pairs.some(pair => pair === `${name}=${value}`);
}
function formHTML(action, token = '') {
  return `<form method="POST" action="${action}"><input type="hidden" name="csrf" value="${token}"><button type="submit">Submit bounded test</button></form>`;
}
async function readPost(req) {
  let result = '';
  for await (const chunk of req) {
    result += chunk.toString('utf8');
    if (result.length > 1024) throw new Error('oversize form');
  }
  return new URLSearchParams(result);
}

async function handle(req, res) {
  try {
    const hostname = req.headers.host;
    if (![ACCOUNT_HOST, RESERVE_HOST, ATTACKER_HOST].some(host => hostname === `${host}:${PORT}`)) {
      send(res, 421, 'Unexpected virtual host'); return;
    }
    const url = new URL(req.url, `https://${hostname}`);
    const host = url.hostname;
    const isReserve = host === RESERVE_HOST;
    if (req.method === 'GET' && url.pathname === '/mint' && isReserve) {
      send(res, 200, 'synthetic session created', 'text/plain; charset=utf-8', {
        'set-cookie': `${SESSION}=${secret}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`,
      });
      return;
    }
    if (req.method === 'GET' && ['/whoami', '/callback'].includes(url.pathname)) {
      send(res, 200, JSON.stringify({ hasReserveSession: cookieSeen(req), hostname: host }),
        'application/json; charset=utf-8'); return;
    }
    if (req.method === 'GET' && url.pathname === '/poison' && !isReserve) {
      const flavor = url.searchParams.get('type');
      const policy = {
        domain: `Domain=veni.test; Path=/; Secure; HttpOnly; SameSite=Lax`,
        path: `Path=/auth; Secure; HttpOnly; SameSite=Lax`,
        insecure: `Path=/; HttpOnly; SameSite=Lax`,
      }[flavor];
      if (!policy) { send(res, 404, 'Unknown poison'); return; }
      send(res, 200, 'attempted invalid prefixed cookie', 'text/plain; charset=utf-8', {
        'set-cookie': `${SESSION}=${fake}; ${policy}`,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/domain-cookie' && host === ACCOUNT_HOST) {
      send(res, 200, 'illustration of why Domain cookies are not permitted for sessions',
        'text/plain; charset=utf-8', {
          'set-cookie': `${DANGEROUS_DOMAIN_COOKIE}=${fake}; Domain=veni.test; Path=/; Secure; SameSite=Lax`,
        });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/form' && isReserve) {
      html(res, formHTML(`${RESERVE}/mutate`, url.searchParams.get('omit') ? '' : csrf)); return;
    }
    if (req.method === 'GET' && url.pathname === '/trap' && !isReserve) {
      html(res, formHTML(`${RESERVE}/mutate`, 'attacker-provided-token')); return;
    }
    if (req.method === 'GET' && url.pathname === '/callback-link' && host === ATTACKER_HOST) {
      html(res, `<a href="${RESERVE}/callback">Navigate to Reserve callback</a>`); return;
    }
    if (url.pathname === '/mutate' && isReserve) {
      if (req.method !== 'POST') { send(res, 405, 'No mutation on GET'); return; }
      const record = {
        origin: req.headers.origin ?? '',
        fetchSite: req.headers['sec-fetch-site'] ?? '',
        credential: cookieSeen(req),
      };
      observed.push(record);
      if (!record.credential || record.origin !== RESERVE ||
          !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
        send(res, 403, 'CSRF/credential gate denied'); return;
      }
      const form = await readPost(req);
      if (form.getAll('csrf').length !== 1 || form.get('csrf') !== csrf) {
        send(res, 403, 'CSRF token denied'); return;
      }
      mutations++;
      send(res, 200, 'accepted local mock mutation'); return;
    }
    if (req.method === 'GET' && url.pathname === '/expire' && isReserve) {
      send(res, 200, 'short-lived synthetic cookie', 'text/plain; charset=utf-8', {
        'set-cookie': `${SHORT_LIVED}=${fake}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1`,
      });
      return;
    }
    send(res, 404, 'Not a local contract route');
  } catch { send(res, 400, 'Rejected contract request'); }
}

async function navigateJSON(page, url) {
  const response = await page.goto(url);
  assert.equal(response?.status(), 200);
  return JSON.parse(await page.locator('body').innerText());
}

async function submit(page, from) {
  await page.goto(from);
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).origin === RESERVE &&
      new URL(r.url()).pathname === '/mutate'),
    page.getByRole('button', { name: 'Submit bounded test' }).click(),
  ]);
  return response.status();
}

try {
  phase = 'disposable environment boundaries';
  check(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.VENI_SUBDOMAIN_BROWSER_DISPOSABLE === 'yes',
  'Subdomain contract executes only on explicit, disposable hosted CI');
  check(process.platform === 'linux' && process.versions.node.startsWith('24.'),
    'Pinned Linux and Node 24 runtime');

  certificateDirectory = mkdtempSync(join(tmpdir(), 'veni-subdomain-csrf-'));
  const cert = join(certificateDirectory, 'test.crt');
  const key = join(certificateDirectory, 'test.key');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
    '-subj', '/CN=reserve.veni.test',
    '-addext', 'subjectAltName=DNS:account.veni.test,DNS:reserve.veni.test,DNS:attacker.test',
    '-keyout', key, '-out', cert,
  ], { stdio: 'ignore', timeout: 15000 });
  server = createHTTPSServer({ key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => { void handle(req, res); });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolveListen);
  });
  browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--no-proxy-server',
    `--host-resolver-rules=MAP ${ACCOUNT_HOST} 127.0.0.1, MAP ${RESERVE_HOST} 127.0.0.1, MAP ${ATTACKER_HOST} 127.0.0.1`,
  ] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const blocked = new Set();
  const restrictNetwork = async route => {
    if (ALLOWED.has(new URL(route.request().url()).origin)) await route.continue();
    else { blocked.add(new URL(route.request().url()).origin); await route.abort(); }
  };
  await context.route('**/*', restrictNetwork);
  const page = await context.newPage();

  phase = 'real Chromium Secure HttpOnly __Host- cookie attributes';
  const minted = await page.goto(`${RESERVE}/mint`);
  check(minted.status() === 200, 'Local HTTPS Reserve origin issues session contract');
  const reserveCookie = (await context.cookies(RESERVE)).find(c => c.name === SESSION);
  check(reserveCookie?.value === secret && reserveCookie.secure && reserveCookie.httpOnly &&
    reserveCookie.sameSite === 'Lax' && reserveCookie.path === '/' &&
    reserveCookie.domain === RESERVE_HOST,
  'Chromium accepts Secure HttpOnly Lax host-only __Host- Reserve cookie');
  check(reserveCookie.expires > Date.now() / 1000 && reserveCookie.expires <= Date.now() / 1000 + 300,
    'Production-contract session cookie is bounded to five minutes');
  check(!(await page.evaluate(() => document.cookie)).includes(SESSION),
    'HttpOnly Reserve cookie cannot be read by page JavaScript');
  check((await navigateJSON(page, `${RESERVE}/whoami`)).hasReserveSession,
    'Reserve host receives its own protected cookie');
  check(!(await navigateJSON(page, `${ACCOUNT}/whoami`)).hasReserveSession &&
    !(await context.cookies(ACCOUNT)).some(c => c.name === SESSION),
  'Sibling Website host receives no Reserve host-only session cookie');
  console.log('PASS: real HTTPS sibling-host Secure, HttpOnly and host-only cookie isolation');

  phase = 'sibling cookie-tossing and unsafe Domain attribute';
  for (const type of ['domain', 'path', 'insecure']) {
    await page.goto(`${ACCOUNT}/poison?type=${type}`);
    const found = (await context.cookies(RESERVE)).find(c => c.name === SESSION);
    check(found?.value === secret && found.domain === RESERVE_HOST,
      `Website cannot replace Reserve __Host- cookie with ${type} policy`);
  }
  await page.goto(`${ACCOUNT}/domain-cookie`);
  const domainCookie = (await context.cookies(RESERVE)).find(c => c.name === DANGEROUS_DOMAIN_COOKIE);
  check(domainCookie?.domain === '.veni.test' || domainCookie?.domain === 'veni.test',
    'An ordinary Domain cookie can traverse siblings, motivating __Host- enforcement');
  console.log('PASS: sibling cookie-tossing attempts cannot replace prefixed Reserve cookie');

  phase = 'Lax remains vulnerable to same-site form submission without CSRF defenses';
  check(await submit(page, `${ACCOUNT}/trap`) === 403 && mutations === 0,
    'Same-site Website form submission cannot modify Reserve state');
  const siblingPost = observed.at(-1);
  // Diagnostics are classification-only: never log cookie values or raw request headers.
  console.log(`POLICY OBSERVATION: sibling POST cookie=${siblingPost?.credential ? 'present' : 'absent'}, ` +
    `origin=${siblingPost?.origin === ACCOUNT ? 'expected' : 'other'}, ` +
    `fetch-site=${siblingPost?.fetchSite === 'same-site' ? 'same-site' : 'other'}`);
  check(siblingPost?.credential === true && siblingPost?.origin === ACCOUNT,
    'Chromium DID send Lax Reserve cookie on sibling-site POST; explicit Origin/CSRF is essential');
  check(observed.at(-1)?.fetchSite === 'same-site',
    'Browser marks sibling-host POST as same-site, not cross-site');

  phase = 'true cross-site form POST and safe top-level navigation';
  check(await submit(page, `${ATTACKER}/trap`) === 403 && mutations === 0,
    'External-site form submission cannot modify Reserve state');
  check(observed.at(-1)?.credential === false && observed.at(-1)?.origin === ATTACKER,
    'Explicit SameSite=Lax prevents session cookie on cross-site POST');
  await page.goto(`${ATTACKER}/callback-link`);
  await Promise.all([
    page.waitForURL(url => url.origin === RESERVE && url.pathname === '/callback'),
    page.getByRole('link', { name: 'Navigate to Reserve callback' }).click(),
  ]);
  check(JSON.parse(await page.locator('body').innerText()).hasReserveSession,
    'Lax still permits cookie on top-level cross-site GET callback navigation');
  const nonMutating = await page.goto(`${RESERVE}/mutate`);
  check(nonMutating.status() === 405 && mutations === 0,
    'OAuth-style top-level GET cannot perform a state-changing operation');
  console.log('PASS: SameSite Lax navigation limits and explicit POST CSRF enforcement');

  phase = 'same-origin CSRF token and short-lived cookie expiration';
  check(await submit(page, `${RESERVE}/form?omit=1`) === 403 && mutations === 0,
    'Even correct Reserve Origin without a CSRF token cannot write');
  check(await submit(page, `${RESERVE}/form`) === 200 && mutations === 1,
    'Exact Reserve Origin plus secret CSRF token permits only local mock write');
  await page.goto(`${RESERVE}/expire`);
  check((await context.cookies(RESERVE)).some(c => c.name === SHORT_LIVED),
    'Chromium accepts short-lived synthetic Secure cookie');
  await new Promise(resolveWait => setTimeout(resolveWait, 1800));
  check(!(await context.cookies(RESERVE)).some(c => c.name === SHORT_LIVED),
    'Browser drops expired Secure cookie automatically');
  const isolated = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await isolated.route('**/*', restrictNetwork);
    const other = await isolated.newPage();
    check(!(await navigateJSON(other, `${RESERVE}/whoami`)).hasReserveSession,
      'Independent browser profile cannot inherit an authenticated Reserve cookie');
  } finally { await isolated.close(); }
  check(blocked.size === 0, 'No browser requests left exact synthetic HTTPS origins');
  await context.close();
  completed = true;
} catch (error) {
  // Never print cookies, cross-domain request headers, secrets, or raw responses.
  const detail = error?.code === 'ERR_ASSERTION' ? ` (${error.message})` : '';
  console.error(`VENI SUBDOMAIN COOKIE/CSRF: FAIL at ${phase}${detail}; sensitive values withheld.`);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { process.exitCode = 1; }
  if (server?.listening) {
    await new Promise(resolveClose => server.close(resolveClose));
  }
  if (certificateDirectory) {
    rmSync(certificateDirectory, { recursive: true, force: true });
  }
  if (completed && !process.exitCode) {
    console.log(`VENI SUBDOMAIN COOKIE/CSRF: PASS (${assertions} real-browser local-policy assertions).`);
    console.log('LIMIT: This is a proposed HTTPS cookie/CSRF policy contract, NOT deployed Reserve code or hosted SSO.');
  }
}
