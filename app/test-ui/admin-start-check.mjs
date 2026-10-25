// Boot the packaged admin in a fresh project-local profile, never the operator's database.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer-core';
import { discoverServers } from '../../security/src/network/discovery.ts';
import { requestServerProof } from '../../security/src/client/server-proof.ts';
const root = resolve('.');
if (await fetch('http://127.0.0.1:8090/api/config', { signal: AbortSignal.timeout(800) }).then(() => true).catch(() => false)) throw new Error('Port 8090 is already in use; do not disturb that server.');
mkdirSync('.test-runs', { recursive: true });
const dir = mkdtempSync(resolve('.test-runs/admin-start-'));
const dbg = await new Promise((done) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => done(p)); }); });
const env = { ...process.env, MEDABE_USER_DATA: dir, MEDABE_TEST: '1', MEDABE_ALLOW_CAPTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(resolve('release/KSK-win32-x64/KSK.exe'), [`--remote-debugging-port=${dbg}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
let browser, page;
try {
  let cfg;
  for (let i = 0; i < 120 && !cfg; i++) { cfg = await fetch('http://127.0.0.1:8090/api/config', { signal: AbortSignal.timeout(1000) }).then(async (r) => r.ok ? r.json() : null).catch(() => null); if (!cfg) await wait(500); }
  if (!cfg) throw new Error('Embedded storage did not start');
  await requestServerProof('http://127.0.0.1:8090', fetch, cfg.registryPk);
  console.log('OK Packaged admin starts the signed storage endpoint');
  const found = await discoverServers();
  if (!found.some((entry) => entry.registryPk === cfg.registryPk)) throw new Error('Admin discovery missing');
  console.log('OK Packaged admin advertises its current LAN endpoint');
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${dbg}`, defaultViewport: null });
  for (let i = 0; i < 90 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('file://')); if (!page) await wait(300); }
  await page.waitForFunction(() => !!globalThis.medabe?.admin, { polling: 100, timeout: 30000 });
  console.log('OK Packaged admin UI and activation bridge load');
  console.log('Evidence: ' + dir);
} finally {
  await page?.evaluate(() => medabe.quit()).catch(() => undefined);
  await browser?.disconnect();
  for (let i = 0; i < 30 && app.exitCode === null; i++) await wait(200);
  if (app.exitCode === null) app.kill();
}
