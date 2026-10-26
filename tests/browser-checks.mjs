/**
 * Interface checks, run in a real browser.
 *
 * The unit tests in tests/*.test.mjs cover the logic but cannot prove that the page works:
 * a single wrong element id would break the interface while every unit test still passed.
 * This script therefore drives an installed Chrome (no dependency to install, no browser
 * download) over the DevTools Protocol and asserts on the resulting DOM.
 *
 * Requirements: the application must already be served over HTTP.
 *
 *   python -m http.server 8000          (from the project folder)
 *   node tests/browser-checks.mjs http://127.0.0.1:8000/frontend/index.html
 *
 * Set CHROME_PATH if Chrome is not in a usual location.
 * These checks are not part of `npm test`: they need a browser and a running server.
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.argv[2] ?? 'http://127.0.0.1:8000/frontend/index.html';
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9333);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

let failures = 0;
let checks = 0;

function assert(condition, message, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`PASS  ${message}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${message}${detail ? ` :: ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------------------

async function waitForEndpoint(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`the browser did not expose ${url} within ${timeoutMs} ms`);
}

async function startChrome() {
  const executable = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executable) {
    console.error(
      'Chrome was not found. Set CHROME_PATH to the executable, or run the checks by hand ' +
        '(see docs/test.md).'
    );
    process.exit(1);
  }

  const profile = join(tmpdir(), 'chatmt-browser-checks');
  rmSync(profile, { recursive: true, force: true });

  const child = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  await waitForEndpoint(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  return child;
}

// ---------------------------------------------------------------------------------------
// DevTools Protocol client
// ---------------------------------------------------------------------------------------

function createClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const consoleMessages = [];
  const exceptions = [];
  let nextId = 0;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ');
      consoleMessages.push(`${message.params.type}: ${text}`);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? 'unknown exception');
    }
  });

  const ready = new Promise((resolve) => socket.addEventListener('open', resolve));

  function send(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  return { socket, ready, send, consoleMessages, exceptions };
}

// ---------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------

async function main() {
  try {
    const probe = await fetch(APP);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (error) {
    console.error(
      `The application is not reachable at ${APP} (${error.message}).\n` +
        'Start it first: python -m http.server 8000  (from the project folder),\n' +
        'then run: node tests/browser-checks.mjs http://127.0.0.1:8000/frontend/index.html'
    );
    process.exit(1);
  }

  const chrome = await startChrome();

  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('the browser did not open a page target');

    const client = createClient(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    async function evaluate(expression) {
      const result = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (result.exceptionDetails) {
        throw new Error(`evaluate failed: ${result.exceptionDetails.exception?.description ?? 'unknown'}`);
      }
      return result.result.value;
    }

    async function waitFor(expression, expected, timeoutMs = 15000) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        last = await evaluate(expression);
        if (last === expected) return;
        await sleep(100);
      }
      throw new Error(`timeout waiting for ${expression} === ${expected} (last: ${JSON.stringify(last)})`);
    }

    const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
    const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    const hidden = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.hidden ?? null`);
    const click = (selector) =>
      evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    const clickButtonWithText = (scope, label) =>
      evaluate(
        `(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')]` +
          `.find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)})); ` +
          `if (!el) return false; el.click(); return true; })()`
      );
    const clickPalette = async (name, hex) => {
      const ok = await click(`button[aria-label="${name} ${hex}"]`);
      if (!ok) throw new Error(`palette button not found: ${name} ${hex}`);
      await sleep(60);
    };

    // ---- 1. the palette -----------------------------------------------------------------
    await client.send('Page.navigate', { url: APP });
    await waitFor('document.readyState', 'complete');
    await waitFor("document.querySelectorAll('#palette-covered button').length", 9);

    assert((await count('#palette-covered button')) === 9, 'palette lists the 9 colours with a standard code');
    assert((await count('#palette-uncovered button')) === 6, 'palette lists the 6 colours without a standard code');
    assert((await hidden('#app-status')) === true, 'no error banner at start');

    // ---- 2. matching a standard ---------------------------------------------------------
    await clickPalette('green', '#008000');
    let answer = await text('#answer');
    assert(answer.includes('colour-green'), 'answer names the matching standard code', answer.slice(0, 120));
    assert(answer.includes('accepts this colour'), 'the accepted outcome is stated');
    assert((await text('#selection')).includes('CIELAB'), 'selection shows the structured representation');
    assert(answer.includes('tick the consent box'), 'nothing can be stored before consent');
    assert((await text('#matches')).includes('colour-green'), 'matches panel lists the applied rule');
    assert((await text('#why')).includes('standards: usage-of-colours v1.0.0'), 'why panel lists the data used');

    // ---- 3. consent and storage ---------------------------------------------------------
    await click('#consent');
    assert((await text('#consent-note')).includes('Consent given'), 'consent is acknowledged');
    assert((await text('#answer')).includes('Save as my preferred colour'), 'store button appears after consent');
    assert((await clickButtonWithText('#answer', 'Save as my preferred colour')) === true, 'store button is clickable');
    await sleep(80);
    let memory = await text('#memory-list');
    assert(memory.includes('Preference: green (#008000)'), 'preference is stored in the memory panel', memory.slice(0, 200));
    assert(memory.includes('confirmation: confirmed'), 'the stored preference is confirmed');
    assert((await text('#memory-status')).includes('records: 1'), 'memory status counts one record');
    assert((await text('#answer')).includes('exactly the same colour'), 'after storing, the distance is reported as zero');

    // ---- 4. persistence and consent after a reload --------------------------------------
    await client.send('Page.navigate', { url: APP });
    await waitFor("document.querySelectorAll('#palette-covered button').length", 9);
    memory = await text('#memory-list');
    assert(memory.includes('Preference: green (#008000)'), 'the preference survives a page reload');
    assert((await evaluate("document.querySelector('#consent').checked")) === false, 'consent is asked again after a reload');
    await clickPalette('blue', '#0000FF');
    assert((await text('#answer')).includes('tick the consent box'), 'without consent no storage button is offered');
    await click('#consent');

    // ---- 5. comparing with the stored preference ----------------------------------------
    answer = await text('#answer');
    assert(answer.includes('colour-blue'), 'a second selection is compared with the standard');
    assert(answer.includes('stored preference is green (#008000)'), 'the answer compares against the stored preference');
    assert(answer.includes('Replace my stored preference'), 'the answer asks before replacing, instead of overwriting');

    // ---- 6. a colour the standard requires to be questioned -----------------------------
    await clickPalette('red', '#FF0000');
    answer = await text('#answer');
    assert(answer.includes('Why did you choose Red?'), 'the question of the source file is asked');
    assert((await hidden('#clarification')) === false, 'the clarification panel is shown');
    assert(answer.includes('Answer the question first'), 'storing is blocked until the question is answered');
    await evaluate("document.querySelector('#clarification-text').value = 'because it was the colour of my first bicycle'");
    await click('#clarification-send');
    await sleep(60);
    assert((await hidden('#clarification')) === true, 'the clarification panel closes after the answer');
    assert((await text('#answer')).includes('first bicycle'), 'the answer is echoed back');
    assert((await clickButtonWithText('#answer', 'Replace my stored preference')) === true, 'an explicit replace button is offered');
    await sleep(80);
    memory = await text('#memory-list');
    assert(memory.includes('Preference: red (#FF0000)'), 'the stored preference was replaced');
    assert(memory.includes('first bicycle'), 'the answer to the question is stored with the preference');
    assert((await text('#memory-status')).includes('records: 1'), 'replacing keeps a single preference record');

    // ---- 7. a colour with no standard ---------------------------------------------------
    await clickPalette('lime', '#00FF00');
    answer = await text('#answer');
    assert(answer.includes('No standard code covers'), 'an uncovered colour is declared as such', answer.slice(0, 120));
    assert((await text('#matches')).includes('high'), 'uncertainty is declared as high');
    assert((await text('#matches')).includes('Uncertainty'), 'uncertainty reasons are listed');
    assert(answer.includes('unconfirmed observation'), 'the button says the value will be an unconfirmed observation');
    assert((await clickButtonWithText('#answer', 'Replace my stored preference')) === true, 'an uncovered colour can still be stored');
    await sleep(80);
    memory = await text('#memory-list');
    assert(memory.includes('Preference: lime (#00FF00)'), 'the uncovered colour is stored', memory.slice(0, 200));
    assert(memory.includes('confirmation: unconfirmed'), 'an uncovered colour is stored as unconfirmed, not as accepted');

    // ---- 8. recording a correction ------------------------------------------------------
    await evaluate("document.querySelector('#correction-outcome').value = 'accepted'");
    await evaluate("document.querySelector('#correction-note').value = 'I want lime to be accepted'");
    await click('#correction-record');
    await sleep(80);
    const matches = await text('#matches');
    assert(matches.includes('correction-against-standard'), 'the correction is reported as a contradiction');
    assert(matches.includes('has not been changed automatically'), 'the standard is not changed automatically');
    memory = await text('#memory-list');
    assert(memory.includes('Correction: #00FF00 should be "accepted"'), 'the correction is stored as its own record');
    assert((await text('#memory-status')).includes('records: 2'), 'the memory now holds two records');

    // ---- 9. deletion --------------------------------------------------------------------
    await clickButtonWithText('#memory-list', 'Delete');
    await sleep(80);
    assert((await text('#memory-status')).includes('records: 1'), 'deleting one record removes exactly one');
    await click('#clear-memory');
    await sleep(80);
    assert((await text('#memory-list')).includes('Empty'), 'clearing removes every record');
    assert((await evaluate("window.localStorage.getItem('chatmt.memory.local-user')")) === null, 'the storage entry is removed');

    // ---- 10. no silent errors -----------------------------------------------------------
    assert(client.exceptions.length === 0, 'no uncaught exception in the browser', client.exceptions.join(' | '));
    const errors = client.consoleMessages.filter((entry) => entry.startsWith('error'));
    assert(errors.length === 0, 'no console error', errors.join(' | '));

    client.socket.close();
  } finally {
    chrome.kill();
  }
}

await main();

console.log(`\n${checks - failures}/${checks} browser checks passed`);
process.exit(failures === 0 ? 0 : 1);
