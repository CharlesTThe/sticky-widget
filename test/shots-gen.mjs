// Regenerates the review screenshot set into test/shots/ (NOT test/tmp, which
// the unit suite wipes in its setup hook — that is what deleted the first set
// out from under a reviewer mid-review).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const D = 'test/shots';
const W = mkdtempSync(join(tmpdir(), 'fbw-shots-'));
const inj = (f, o) => { execFileSync(process.execPath, ['bin/add-feedback.mjs', f, '--out', join(W, o)], { stdio: 'pipe' }); return 'file://' + join(W, o); };
const sr = 'document.getElementById("fbw-host").shadowRoot';
const b = await chromium.launch();
const open = async (url, vw = 1440, vh = 810, o = {}) => { const c = await b.newContext({ viewport: { width: vw, height: vh }, ...o }); const p = await c.newPage(); await p.goto(url); await p.waitForFunction('!!window.__fbw'); await p.waitForTimeout(700); return { p, c }; };
let { p, c } = await open(inj('examples/deck.html', 'deck.html'));
await p.screenshot({ path: `${D}/01-deck-idle.png` });
await p.evaluate(`${sr}.querySelector('.rail').classList.add('open')`); await p.waitForTimeout(300);
await p.screenshot({ path: `${D}/02-deck-rail-open.png` });
await p.evaluate(() => { const t = [...document.querySelectorAll('.stage *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 180 && r.height > 50; }); window.__fbw._add(t[1], 'Does this include the restated Q3 baseline?', { name: 'Sam Okafor' }); window.__fbw._add(t[1], 'Agreed, flag it.', { name: 'Ada Whitfield' }); });
await p.waitForTimeout(600); await p.screenshot({ path: `${D}/03-deck-pins.png` });
await p.evaluate(`${sr}.querySelector('.pin').click()`); await p.waitForTimeout(400);
await p.screenshot({ path: `${D}/04-deck-thread.png` }); await c.close();
({ p, c } = await open(inj('test/fixtures/light.html', 'light.html')));
await p.evaluate(() => window.__fbw._add(document.querySelector('p'), 'Is this still accurate?', { name: 'Ada Whitfield' }));
await p.evaluate(`${sr}.querySelector('.rail').classList.add('open')`); await p.waitForTimeout(600);
await p.screenshot({ path: `${D}/05-light-pin.png` });
console.log('pin vs text box on light.html:', JSON.stringify(await p.evaluate(() => { const el = document.querySelector('p'); const r = el.getBoundingClientRect(); const pin = document.getElementById('fbw-host').shadowRoot.querySelector('.pin'); return { boxLeft: Math.round(r.left), boxRight: Math.round(r.right), boxTop: Math.round(r.top), pinTransform: pin.style.transform }; })));
await c.close();
({ p, c } = await open(inj('test/fixtures/app-shell.html', 'app.html')));
await p.evaluate(() => { const s = [...document.querySelectorAll('*')].find(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 200); window.__fbw._add([...s.children][2], 'Row looks stale.', { name: 'Sam Okafor' }); });
await p.evaluate(`${sr}.querySelector('.rail').classList.add('open')`); await p.waitForTimeout(600);
await p.screenshot({ path: `${D}/06-appshell.png` }); await c.close();
await b.close(); console.log('regenerated into test/shots/');
