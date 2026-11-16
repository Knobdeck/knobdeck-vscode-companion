'use strict';

// The hub link against an in-process fake hub (a `ws` server speaking the companion protocol) and
// the fake `vscode` module: hello, focus reports, actions, queries, Custom Command, errors.

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { createFake, install } = require('./fake-vscode');

const fake = createFake();
install(fake.vscode);
const { createHubLink, PLUGIN_ID, toSearchParams } = require('../../src/hub');

/** A fake hub: accepts one companion, records frames, lets the test send requests. */
function fakeHub() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const frames = [];
  const waiters = [];
  let socket = null;
  const check = () => {
    for (const w of [...waiters]) {
      const f = frames.find(w.pred);
      if (f) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(f);
      }
    }
  };
  wss.on('connection', (ws) => {
    socket = ws;
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      frames.push(msg);
      if (msg.type === 'hello') ws.send(JSON.stringify({ type: 'ready', protocol: 1, link: 'vscode-7', host_version: 'test' }));
      check();
    });
  });
  return {
    port: () => wss.address().port,
    frames,
    next: (pred) => new Promise((resolve, reject) => {
      waiters.push({ pred, resolve });
      check();
      setTimeout(() => reject(new Error('timed out waiting for a frame')), 3000).unref();
    }),
    request: (id, action, params) => socket.send(JSON.stringify({ type: 'request', id, action, params })),
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); }),
  };
}

async function linked() {
  const hub = fakeHub();
  await new Promise((r) => setTimeout(r, 20));
  const statuses = [];
  const link = await createHubLink({
    instance: 'session-1',
    name: 'Fake Code — proj',
    appVersion: '1.138.0',
    version: '1.1.0',
    isFocused: () => true,
    onStatus: (s) => statuses.push(s),
    discovery: { token: () => 'tok', ports: () => [hub.port()] },
    socket: (url) => new (require('ws'))(url),
  });
  link.start();
  return { hub, link, statuses };
}

test('the plugin id follows the OS, as the KnobDeck plugin names itself', () => {
  assert.equal(PLUGIN_ID, `vscode-${{ darwin: 'macos', win32: 'windows' }[process.platform] || process.platform}`);
});

test('hello says who it is; a focused window reports focus once linked', async () => {
  const { hub, link, statuses } = await linked();
  const hello = await hub.next((f) => f.type === 'hello');
  assert.deepEqual(hello, {
    type: 'hello', protocol: 1, plugin: PLUGIN_ID, instance: 'session-1', app: 'vscode',
    app_version: '1.138.0', name: 'Fake Code — proj', version: '1.1.0', features: ['window_focused'], token: 'tok',
  });
  await hub.next((f) => f.type === 'event' && f.event === 'window_focused');
  assert.ok(statuses.some((s) => s.state === 'connected' && s.link === 'vscode-7'));
  link.focused();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(hub.frames.filter((f) => f.event === 'window_focused').length, 2, 'focus is reported again on demand');
  link.stop();
  await hub.close();
});

test('actions, queries and Custom Command run through the same handler', async () => {
  const { hub, link } = await linked();
  await hub.next((f) => f.type === 'event');
  fake.calls.length = 0;

  hub.request('1', 'vscode.saveAll', {});
  assert.deepEqual(await hub.next((f) => f.id === '1'), { type: 'response', id: '1', ok: true, result: { done: true } });
  assert.deepEqual(fake.calls.at(-1), ['executeCommand', 'workbench.action.files.saveAll']);

  hub.request('2', 'query', { name: 'tasks' });
  const tasks = await hub.next((f) => f.id === '2');
  assert.deepEqual(tasks.result.items.map((i) => i.value), ['build', 'test']);

  hub.request('3', 'my.custom', {});
  assert.equal((await hub.next((f) => f.id === '3')).ok, true, 'a VS Code command id the user typed');
  assert.deepEqual(fake.calls.at(-1), ['executeCommand', 'my.custom']);

  hub.request('4', 'no.such.command', {});
  assert.deepEqual(await hub.next((f) => f.id === '4'), { type: 'response', id: '4', ok: false, error: 'VS Code has no command "no.such.command".' });

  hub.request('5', 'vscode.runTask', { name: 'nope' });
  assert.equal((await hub.next((f) => f.id === '5')).error, 'Task "nope" was not found.');

  hub.request('6', 'vscode.focusTerminal', { name: 'server' });
  assert.equal((await hub.next((f) => f.id === '6')).ok, true);
  assert.deepEqual(fake.calls.at(-1), ['terminal.show', 'server', false]);

  hub.request('7', 'query', { name: 'secrets' });
  assert.equal((await hub.next((f) => f.id === '7')).error, 'Unknown query "secrets".');
  link.stop();
  await hub.close();
});

test('request params become the URL-style parameters the actions read', () => {
  assert.equal(toSearchParams({ name: 'build', n: 2, skip: null }).toString(), 'name=build&n=2');
  assert.equal(toSearchParams(undefined).toString(), '');
});
