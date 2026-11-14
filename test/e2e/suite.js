'use strict';

// Runs inside a real VS Code (see run.js). Checks the companion over HTTP and, when
// KNOBDECK_VSCODE_PLUGIN is set, through the real KnobDeck `vscode` plugin, then checks VS Code's
// state afterwards: tasks and debug sessions really ran, terminals and editors really changed.

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const vscode = require('vscode');

const PORT = 32145;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, check, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function get(p) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      })
      .on('error', reject);
  });
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const folder = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const marker = (name) => path.join(folder(), 'out', name);

test('the companion is serving', async () => {
  const ext = vscode.extensions.getExtension('knobdeck.knobdeck-vscode-companion');
  assert.ok(ext, 'extension not found');
  await ext.activate();
  await until('server', async () => ext.exports.state() === 'serving');
  const h = await get('/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.app, 'KnobDeck VS Code Companion');
});

test('queries over HTTP', async () => {
  const tasks = (await get('/api/query/tasks')).body.items.map((i) => i.value);
  assert.ok(tasks.includes('kd-touch'), `tasks: ${tasks}`);
  assert.deepEqual((await get('/api/query/launch-configs')).body.items, [{ value: 'kd-debug', label: 'kd-debug' }]);
});

const PLUGIN = process.env.KNOBDECK_VSCODE_PLUGIN;

test('KnobDeck plugin: simple actions', async () => {
  if (!PLUGIN) return 'skipped (no KNOBDECK_VSCODE_PLUGIN)';
  const { PluginDriver } = await import(pathToFileURL(path.resolve(__dirname, '../../../compat/driver.mjs')).href);
  const plugin = await PluginDriver.start(PLUGIN, { VSCODE_PORT: String(PORT) });
  try {
    for (const id of ['explorer', 'search', 'source-control', 'problems', 'toggle-panel', 'toggle-panel', 'save-all', 'split-editor', 'new-terminal']) {
      assert.deepEqual((await plugin.invoke(id)).errors, [], id);
    }

    // Run Task really runs the task.
    assert.deepEqual((await plugin.invoke('run-task', { taskName: 'kd-touch' })).errors, []);
    await until('task marker', () => fs.existsSync(marker('task.marker')));

    // Task Wheel lists it, and pressing the child runs it again (once the first run has ended:
    // VS Code won't start a task that is still running).
    await until('first task run to end', () => !vscode.tasks.taskExecutions.some((e) => e.task.name === 'kd-touch'));
    fs.rmSync(marker('task.marker'));
    const wheel = await plugin.request('wheel', { action_id: 'task-wheel', inputs: {} });
    assert.ok(wheel.slices.some((s) => s.id === 'kd-touch'));
    assert.deepEqual((await plugin.invoke('task-wheel', {}, { childId: 'kd-touch' })).errors, []);
    await until('task marker (wheel)', () => fs.existsSync(marker('task.marker')));

    // Start Debugging launches the configuration.
    assert.deepEqual((await plugin.invoke('start-debugging', { configName: 'kd-debug' })).errors, []);
    await until('debug marker', () => fs.existsSync(marker('debug.marker')), 60000);

    // Focus Terminal shows the named terminal.
    const t = vscode.window.createTerminal({ name: 'kd-term' });
    const other = vscode.window.createTerminal({ name: 'kd-other' });
    other.show();
    await until('kd-other active', () => vscode.window.activeTerminal === other);
    const terms = await plugin.request('query', { query_id: 'vscode-get-terminals', inputs: {} });
    assert.ok(terms.some((i) => i.value === 'kd-term'));
    assert.deepEqual((await plugin.invoke('focus-terminal', { terminalName: 'kd-term' })).errors, []);
    await until('kd-term active', () => vscode.window.activeTerminal === t);

    // Open Editor switches to an open file.
    const notes = vscode.Uri.file(path.join(folder(), 'notes.md'));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(notes), { preview: false });
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(folder(), 'debug-target.js'))), { preview: false });
    const editors = await plugin.request('query', { query_id: 'vscode-get-open-editors', inputs: {} });
    const entry = editors.find((e) => e.label === 'notes.md');
    assert.ok(entry, JSON.stringify(editors));
    assert.deepEqual((await plugin.invoke('open-editor', { editorUri: entry.value })).errors, []);
    await until('notes.md active', () => vscode.window.activeTextEditor?.document.uri.toString() === notes.toString());

    // Custom Command runs any command id; an unknown one reports a clear error.
    assert.deepEqual((await plugin.invoke('custom-command', { commandId: 'workbench.action.closeAllEditors' })).errors, []);
    await until('editors closed', () => !vscode.window.activeTextEditor);
    const bad = await plugin.invoke('custom-command', { commandId: 'knobdeck.no.such.command' });
    assert.match(bad.errors.join(), /no command "knobdeck.no.such.command"/);

    assert.deepEqual((await plugin.invoke('stop-debugging')).errors, []);
  } finally {
    await plugin.stop();
  }
});

async function run() {
  const failures = [];
  for (const [name, fn] of tests) {
    try {
      const note = await fn();
      console.log(`  ✔ ${name}${note ? ` — ${note}` : ''}`);
    } catch (error) {
      console.log(`  ✖ ${name}\n    ${error.stack}`);
      failures.push(name);
    }
  }
  if (failures.length) throw new Error(`${failures.length} e2e test(s) failed: ${failures.join(', ')}`);
}

module.exports = { run };
