'use strict';

// Protocol tests for the companion's action server, with a fake `vscode` module. When
// KNOBDECK_VSCODE_PLUGIN points at a built KnobDeck `vscode` plugin, the same server is also driven
// through that real plugin binary (and KNOBDECK_VSCODE_SETUP through its setup program).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createFake, install } = require('./fake-vscode');

const fake = createFake();
install(fake.vscode);
const server = require('../../src/server');
const { QUERIES, runAction } = require('../../src/actions');

let password = '';
const srv = server.createActionServer({
  password: () => password,
  health: () => ({ app: 'KnobDeck VS Code Companion' }),
  queries: QUERIES,
  action: runAction,
});
let port;

function get(path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

test.before(async () => {
  await server.listen(srv, 0);
  port = srv.address().port;
});
test.after(() => server.close(srv));
test.beforeEach(() => {
  fake.calls.length = 0;
  password = '';
});

test('health', async () => {
  const r = await get('/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('simple action maps to the VS Code command', async () => {
  const r = await get('/api/action/vscode.openCommandPalette');
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  assert.deepEqual(fake.calls, [['executeCommand', 'workbench.action.showCommands']]);
});

test('custom command runs a known command and 404s an unknown one', async () => {
  assert.equal((await get('/api/action/my.custom')).status, 200);
  const r = await get('/api/action/not.a.command');
  assert.equal(r.status, 404);
  assert.match(r.body.error, /no command "not.a.command"/);
});

test('queries return {items:[{value,label}]}', async () => {
  assert.deepEqual((await get('/api/query/tasks')).body.items, [
    { value: 'build', label: 'build' },
    { value: 'test', label: 'test (npm)' },
  ]);
  assert.deepEqual((await get('/api/query/launch-configs')).body.items.map((i) => i.value), ['Launch Server', 'All']);
  assert.deepEqual((await get('/api/query/terminals')).body.items, [
    { value: 'zsh', label: 'zsh (2 open)' },
    { value: 'server', label: 'server' },
  ]);
  assert.deepEqual((await get('/api/query/open-editors')).body.items, [
    { value: 'file:///work/proj/src/index.ts', label: 'src/index.ts' },
    { value: 'file:///work/proj/README.md', label: 'README.md' },
  ]);
  assert.equal((await get('/api/query/nope')).status, 404);
});

test('parameterised actions', async () => {
  assert.equal((await get('/api/action/vscode.runTask?name=build')).status, 200);
  assert.equal((await get('/api/action/vscode.runTask?name=missing')).status, 404);
  assert.equal((await get('/api/action/vscode.runTask')).status, 400);
  assert.equal((await get('/api/action/vscode.startDebugging?name=Launch%20Server')).status, 200);
  assert.equal((await get('/api/action/vscode.focusTerminal?name=server')).status, 200);
  assert.equal((await get(`/api/action/vscode.openEditor?uri=${encodeURIComponent('file:///work/proj/README.md')}`)).status, 200);
  assert.deepEqual(fake.calls, [
    ['executeTask', 'build'],
    ['startDebugging', 'proj', 'Launch Server'],
    ['terminal.show', 'server', false],
    ['showTextDocument', 'file:///work/proj/README.md', 2],
  ]);
});

test('password is required when set', async () => {
  password = 's3cret';
  assert.equal((await get('/health')).status, 401);
  assert.equal((await get('/health', { Authorization: 'wrong' })).status, 401);
  assert.equal((await get('/health', { Authorization: 's3cret' })).status, 200);
});

test('requests from web pages are refused', async () => {
  assert.equal((await get('/api/action/vscode.saveAll', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await get('/api/action/vscode.saveAll', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await get('/api/action/vscode.saveAll', { Host: `evil.example:${port}` })).status, 403);
  assert.equal((await get('/api/action/vscode.saveAll', { Host: 'localhost:1' })).status, 403);
  assert.equal((await get('/api/action/vscode.saveAll', { Host: `localhost:${port}` })).status, 200);
  assert.deepEqual(fake.calls, [['executeCommand', 'workbench.action.files.saveAll']]);
});

test('a slow action is answered as pending instead of timing KnobDeck out', async () => {
  const slow = server.createActionServer({
    password: () => '',
    health: () => ({}),
    queries: {},
    action: () => new Promise((r) => setTimeout(r, 500)),
    actionWaitMs: 50,
  });
  await server.listen(slow, 0);
  const p = slow.address().port;
  const r = await new Promise((resolve) =>
    http.get({ host: '127.0.0.1', port: p, path: '/api/action/x', headers: {} }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve(JSON.parse(b)));
    })
  );
  assert.deepEqual(r, { ok: true, pending: true });
  await server.close(slow);
});

test('handoff releases the port to another window', async () => {
  let handedOff = false;
  const a = server.createActionServer({ password: () => 'pw', health: () => ({}), queries: {}, action: async () => {}, onHandoff: () => (handedOff = true) });
  await server.listen(a, 0);
  const p = a.address().port;
  assert.equal(await server.requestHandoff(p, 'nope'), false, 'wrong password is refused');
  assert.equal(handedOff, false);
  assert.equal(await server.requestHandoff(p, 'pw'), true);
  assert.equal(handedOff, true);
  await server.close(a);
});

// ---- the real KnobDeck plugin against this server ----------------------------------------------

const PLUGIN = process.env.KNOBDECK_VSCODE_PLUGIN;
const SETUP = process.env.KNOBDECK_VSCODE_SETUP;

test('KnobDeck vscode plugin drives the companion', { skip: !PLUGIN && 'set KNOBDECK_VSCODE_PLUGIN' }, async () => {
  password = 'pw 1';
  const { PluginDriver } = await import(require('url').pathToFileURL(require('path').resolve(__dirname, '../compat/driver.mjs')).href);
  const plugin = await PluginDriver.start(PLUGIN, { VSCODE_HOST: '127.0.0.1', VSCODE_PORT: String(port), VSCODE_PASSWORD: password });
  try {
    for (const id of ['command-palette', 'save-all', 'format-document', 'stop-debugging']) {
      assert.deepEqual((await plugin.invoke(id)).errors, [], id);
    }
    assert.deepEqual((await plugin.invoke('run-task', { taskName: 'build' })).errors, []);
    assert.deepEqual((await plugin.invoke('start-debugging', { configName: 'Launch Server' })).errors, []);
    assert.deepEqual((await plugin.invoke('focus-terminal', { terminalName: 'server' })).errors, []);
    assert.deepEqual((await plugin.invoke('open-editor', { editorUri: 'file:///work/proj/README.md' })).errors, []);
    assert.deepEqual((await plugin.invoke('custom-command', { commandId: 'my.custom' })).errors, []);

    const missing = await plugin.invoke('run-task', { taskName: 'missing' });
    assert.match(missing.errors.join(), /HTTP 404.*Task "missing" was not found/);

    const tasks = await plugin.request('query', { query_id: 'vscode-get-tasks', inputs: {} });
    assert.deepEqual(tasks.map((t) => t.value), ['build', 'test']);
    const wheel = await plugin.request('wheel', { action_id: 'task-wheel', inputs: {} });
    assert.deepEqual(wheel.slices.map((s) => s.id), ['build', 'test']);
    assert.deepEqual((await plugin.invoke('task-wheel', {}, { childId: 'test' })).errors, []);
    const editors = await plugin.request('wheel', { action_id: 'open-editor-wheel', inputs: {} });
    assert.equal(editors.slices.length, 2);

    assert.deepEqual(fake.calls.filter((c) => c[0] === 'executeTask'), [['executeTask', 'build'], ['executeTask', 'test']]);

    password = 'changed';
    const denied = await plugin.invoke('save-all');
    assert.match(denied.errors.join(), /rejected the configured password/);
  } finally {
    await plugin.stop();
  }
});

test('KnobDeck vscode setup verifies the companion', { skip: !SETUP && 'set KNOBDECK_VSCODE_SETUP' }, async () => {
  password = 'pw';
  const { runSetup } = await import(require('url').pathToFileURL(require('path').resolve(__dirname, '../compat/driver.mjs')).href);
  const ok = await runSetup(SETUP, { host: '127.0.0.1', port: String(port), password: 'pw' });
  assert.ok(ok.ok, ok.output);
  assert.match(ok.env, new RegExp(`VSCODE_PORT=${port}`));
  const bad = await runSetup(SETUP, { host: '127.0.0.1', port: String(port), password: 'nope' });
  assert.equal(bad.ok, false);
  assert.match(bad.output, /rejected the configured password/);
});
