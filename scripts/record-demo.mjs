/**
 * Record the 105-second, silent archgraph demo. Start `npm run serve` first.
 * Requires Playwright (separate development tool) and ffmpeg/ffprobe on PATH.
 * Optional: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
 *           CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium
 * Run from any directory: node scripts/record-demo.mjs
 * Only localhost is allowed; generated media and captured output stay in video-out/.
 */
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'video-out');
await mkdir(path.join(output, 'raw'), { recursive: true });
await mkdir(path.join(output, 'frames'), { recursive: true });
const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href)
  : await import('playwright').catch(() => { throw new Error('Playwright is required. Install it separately and set PLAYWRIGHT_MODULE; package files are intentionally unchanged.'); });
const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const dependents = run(process.execPath, ['dist/cli/main.js', 'dependents', 'db/connection.ts', '--transitive']);
assert.equal(dependents.status, 0, dependents.stderr);
assert.equal(JSON.parse(dependents.stdout).length, 4);
const violations = run('/bin/sh', ['-c', 'node dist/cli/main.js violations; echo "exit $?"']);
assert.equal(violations.status, 0, violations.stderr);
assert.match(violations.stdout, /exit 1\s*$/);
assert.equal(JSON.parse(violations.stdout.replace(/exit 1\s*$/, '')).length, 1);
const require = createRequire(import.meta.url);
const { VIOLATION_QUERY } = require('../dist/graph/RelateGraphRepository.js');
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const mcp = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]).find(text => text.includes('mcpServers'));
assert.ok(mcp, 'README MCP example not found');
for (const tool of ['ffmpeg', 'ffprobe']) assert.equal(run(tool, ['-version']).status, 0, `${tool} is required`);
const captured = { dependents: dependents.stdout, violations: violations.stdout, mcp: JSON.parse(mcp), violationQuery: VIOLATION_QUERY };
await writeFile(path.join(output, 'captured-output.json'), JSON.stringify(captured, null, 2));

const browser = await playwright.chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark', deviceScaleFactor: 2, recordVideo: { dir: path.join(output, 'raw'), size: { width: 1280, height: 720 } } });
const errors = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'localhost' || url.port !== '4317') { errors.push(`Blocked non-local request: ${url.origin}`); return route.abort(); }
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const video = page.video();
let started;
const timeline = [];
const mark = scene => { const seconds = (performance.now() - started) / 1000; timeline.push({ scene, seconds }); console.log(`${seconds.toFixed(2)}s ${scene}`); };
const until = async seconds => {
  while (performance.now() - started < seconds * 1000) await sleep(Math.min(1000, seconds * 1000 - (performance.now() - started)));
};
async function overlays() {
  await page.evaluate(() => {
    document.getElementById('recording-captions')?.remove(); document.getElementById('recording-cursor')?.remove();
    const caption = document.createElement('div'); caption.id = 'recording-captions';
    caption.style.cssText = 'position:fixed;z-index:2147483646;bottom:0;left:0;right:0;min-height:64px;padding:18px 24px;background:rgba(8,9,14,.94);color:#fff;font:400 22px/28px system-ui,sans-serif;text-align:center;pointer-events:none;border-top:1px solid rgba(255,255,255,.1);box-sizing:border-box;';
    document.body.append(caption);
    const cursor = document.createElement('div'); cursor.id = 'recording-cursor';
    cursor.innerHTML = '<svg width="24" height="30" viewBox="0 0 24 30"><path d="M3 2 L3 24 L9 18 L14 28 L18 26 L13 16 L22 16 Z" fill="white" stroke="#11131a" stroke-width="1.7"/></svg>';
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:30px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px #0008);transform:translate(40px,80px);';
    document.body.append(cursor);
    document.addEventListener('pointermove', event => { const el = document.getElementById('recording-cursor'); if (el) el.style.transform = `translate(${event.clientX}px,${event.clientY}px)`; });
  });
}
const caption = text => page.evaluate(text => { document.getElementById('recording-captions').textContent = text; }, text);
let mouse = { x: 40, y: 280 };
async function move(x, y) {
  const from = { ...mouse };
  for (let i = 1; i <= 28; i++) { await page.mouse.move(from.x + (x - from.x) * i / 28, from.y + (y - from.y) * i / 28, { steps: 2 }); await sleep(25); }
  mouse = { x, y };
}
async function click(locator) {
  const box = await locator.boundingBox(); assert.ok(box, 'Click target must be visible');
  const captionTop = await page.locator('#recording-captions').evaluate(el => el.getBoundingClientRect().top);
  assert.ok(box.y + box.height < captionTop, 'Caption must not cover a clicked element');
  await move(box.x + box.width / 2, box.y + box.height / 2); await sleep(250); await page.mouse.click(mouse.x, mouse.y);
}
const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function localPage(content) {
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>archgraph · Demo</title><style>
    *{box-sizing:border-box}body{margin:0;background:#111113;color:#e7e7ed;font-family:system-ui,sans-serif;padding:42px 48px 84px}header{display:flex;align-items:center;gap:12px;margin-bottom:24px}h1{font-size:23px;margin:0;font-weight:600;letter-spacing:-.6px}.badge{font-size:12px;color:#aaa7ba;margin-left:auto}.dot{height:9px;width:9px;border-radius:50%;background:#b29ae9}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.terminal{border:1px solid #30303a;border-radius:12px;background:#19191d;min-height:494px;overflow:hidden}.title{padding:13px 20px;border-bottom:1px solid #30303a;color:#9997a8;font-size:12px}.terminal pre{margin:0;padding:18px 20px;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/21px ui-monospace,SFMono-Regular,monospace}.command{color:#b29ae9;min-height:42px}.output{color:#d2d1db}.terminal .output{padding-top:0}.closing{max-width:1120px;margin:auto}.closing .terminal{min-height:0}.closing pre{font-size:15px;line-height:22px;padding:20px 24px}.store{font:500 23px ui-monospace,monospace;color:#b29ae9;margin-top:24px;text-align:center}.source{color:#898697;font-size:12px;text-align:center;margin-top:12px}
  </style></head><body>${content}</body></html>`);
  await overlays();
}
async function type(command, commandId, outputId, text) {
  const prompt = '$ ' + command;
  for (let i = 1; i <= prompt.length; i++) {
    await page.evaluate(({ id, text }) => { document.getElementById(id).textContent = text; }, { id: commandId, text: prompt.slice(0, i) });
    await sleep(18);
  }
  await sleep(200);
  const lines = text.trimEnd().split('\n');
  for (let i = 1; i <= lines.length; i++) {
    await page.evaluate(({ id, text }) => { document.getElementById(id).textContent = text; }, { id: outputId, text: lines.slice(0, i).join('\n') });
    await sleep(45);
  }
}

try {
  await page.goto('http://localhost:4317'); await page.locator('.node').last().waitFor();
  assert.equal(await page.locator('.node.selected').count(), 0);
  assert.equal(await page.evaluate(() => devicePixelRatio), 2);
  await overlays(); await page.mouse.move(mouse.x, mouse.y);
  started = performance.now(); mark('1. Overview');
  await caption('Coding agents edit files without knowing the architecture.');
  await until(7);
  await caption('archgraph indexes a TypeScript repo into a local Relate graph.');
  await until(15);

  mark('2. Violation');
  await caption('One rule is broken: the UI imports the database directly.');
  await click(page.getByRole('button', { name: /Focus violation/ }));
  await page.locator('.edge.bad.focused').waitFor();
  await until(25);
  await caption('Not hard-coded: one Cypher query joins constraints, layers and imports in Relate.');
  await click(page.getByText('Cypher', { exact: true }));
  await page.locator('.cypher-box[open]').waitFor();
  // The app disclosure shows impact Cypher. Keep that truthful and show the
  // separate actual violation query as a clearly labeled recording annotation.
  await until(30);
  await page.evaluate(query => {
    const panel = document.createElement('div'); panel.id = 'violation-source-proof';
    panel.style.cssText = 'position:fixed;left:48px;top:306px;width:864px;padding:18px 22px;background:rgba(22,21,29,.98);border:1px solid #4d2c35;border-radius:12px;z-index:100;box-shadow:0 8px 24px #0005;color:#ddd8e7;';
    const heading = document.createElement('div'); heading.textContent = 'VIOLATION CYPHER · FROM REPOSITORY SOURCE'; heading.style.cssText = 'color:#ed7e89;font:500 12px system-ui;letter-spacing:1px;margin-bottom:12px';
    const code = document.createElement('pre'); code.textContent = query; code.style.cssText = 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/23px ui-monospace,monospace;';
    panel.append(heading, code); document.body.append(panel);
  }, VIOLATION_QUERY);
  await move(36, 280); await until(40);

  mark('3. Impact');
  await page.evaluate(() => document.getElementById('violation-source-proof').remove());
  await page.keyboard.press('Escape');
  await caption('Before changing the DB connection, an agent asks: who breaks?');
  await click(page.getByRole('button', { name: 'db/connection.ts', exact: true }));
  await page.locator('#details h3').filter({ hasText: 'db/connection.ts' }).waitFor();
  assert.equal(await page.locator('.impact-panel .count').textContent(), '4');
  assert.equal(await page.locator('.edge.impact').count(), 5);
  await move(944, 340); await until(52);
  await caption('Relate walks IMPORTS to any depth: 4 dependents, exact paths.');
  await until(65);

  mark('4. CLI');
  await localPage('<header><span class="dot"></span><h1>One graph. The same answers.</h1><span class="badge">CLI · Captured local output</span></header><div class="columns"><section class="terminal"><div class="title">Impact analysis</div><pre class="command" id="cmd-deps"></pre><pre class="output" id="out-deps"></pre></section><section class="terminal"><div class="title">Architecture gate</div><pre class="command" id="cmd-violations"></pre><pre class="output" id="out-violations"></pre></section></div>');
  await caption('Same answers from the CLI as JSON.');
  await type('node dist/cli/main.js dependents db/connection.ts --transitive', 'cmd-deps', 'out-deps', captured.dependents);
  await until(75);
  await caption('violations exits 1, so it works as a CI gate.');
  await type('node dist/cli/main.js violations; echo "exit $?"', 'cmd-violations', 'out-violations', captured.violations);
  await until(85);

  mark('5. MCP');
  await localPage(`<div class="closing"><header><span class="dot"></span><h1>Architecture memory, in the agent's context.</h1><span class="badge">Read-only MCP · README example</span></header><section class="terminal"><div class="title">MCP configuration</div><pre>${escape(JSON.stringify(JSON.parse(mcp), null, 2))}</pre></section><div class="store">store/archgraph.rl</div><div class="source">Committed single-file graph · Embedded database · No cloud service</div></div>`);
  await caption("Agents query the committed .rl store read-only via Relate's MCP server.");
  await until(94);
  await caption('No server, no cloud. One file of architecture memory.');
  await until(102);
  await caption('archgraph - github.com/walkingtyphoon/archgraph');
  await until(105); mark('Finished');
  assert.deepEqual(errors, [], 'Browser must have no errors or external requests');
} finally {
  await context.close(); await browser.close();
}
const webm = await video.path();
const mp4 = path.join(output, 'archgraph-demo.mp4');
const conversion = run('ffmpeg', ['-y', '-i', webm, '-an', '-vf', 'scale=1280:720:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
assert.equal(conversion.status, 0, conversion.stderr);
const probe = run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4]);
assert.equal(probe.status, 0, probe.stderr);
const info = JSON.parse(probe.stdout);
const duration = Number(info.format.duration);
assert.ok(duration >= 90 && duration <= 119, `Unexpected duration: ${duration}`);
assert.equal(info.streams.length, 1); assert.equal(info.streams[0].codec_name, 'h264');
assert.equal(info.streams[0].width, 1280); assert.equal(info.streams[0].height, 720); assert.equal(info.streams[0].r_frame_rate, '30/1');
for (const [scene, seconds] of [[1, 10], [2, 34], [3, 57], [4, 80], [5, 98]]) {
  const frame = run('ffmpeg', ['-y', '-ss', String(seconds), '-i', mp4, '-frames:v', '1', path.join(output, 'frames', `scene-${scene}.png`)]);
  assert.equal(frame.status, 0, frame.stderr);
}
const result = { mp4, webm, duration, bytes: (await stat(mp4)).size, deviceScaleFactor: 2, viewport: '1280x720', timeline, errors, capturedCliOutput: 'captured-output.json', streams: info.streams };
await writeFile(path.join(output, 'recording.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ mp4, duration, bytes: result.bytes, errors }, null, 2));
