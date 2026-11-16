'use strict';

const vscode = require('vscode');
const server = require('./server');
const { QUERIES, SIMPLE_COMMANDS, PARAM_COMMANDS, runAction } = require('./actions');
const { createHubLink } = require('./hub');

// Two ways KnobDeck reaches this window:
// - The companion hub (current KnobDeck): every window keeps its own link to KnobDeck and reports
//   when it gains focus, so KnobDeck drives the window you last used. No port, no password.
// - The legacy HTTP action server (KnobDeck versions without the hub), on by `knobdeck.legacyServer`:
//   one server per machine on one port; a window that gains focus asks the holder to hand it over.

const RETRY_MS = 15000;

/** @type {'stopped' | 'serving' | 'standby' | 'error'} */
let state = 'stopped';
let lastError = '';
let instance = null;
let servingPort = 0;
let retryTimer = null;
let statusItem = null;
let busy = Promise.resolve();
let version = '';
/** @type {Awaited<ReturnType<typeof createHubLink>> | null} */
let hub = null;
/** @type {{state: string, link?: string, reason?: string}} */
let hubStatus = { state: 'disconnected' };

function config() {
  const c = vscode.workspace.getConfiguration('knobdeck');
  return {
    port: Number(c.get('port', 32145)),
    password: String(c.get('password', '')),
    autostart: Boolean(c.get('autostart', true)),
    legacyServer: Boolean(c.get('legacyServer', true)),
  };
}

/** Runs start/stop transitions one at a time. */
function serial(fn) {
  busy = busy.then(fn, fn);
  return busy;
}

function setState(next, error = '') {
  state = next;
  lastError = error;
  clearTimeout(retryTimer);
  retryTimer = null;
  // A standby window keeps checking whether the port has come free (its holder closed).
  if (next === 'standby') retryTimer = setTimeout(() => serial(() => tryListen(false)), RETRY_MS);
  renderStatus();
}

/** One line about the hub link, for the tooltip and the options menu. */
function hubLine() {
  return {
    connected: `Linked to KnobDeck (${hubStatus.link}).`,
    connecting: 'Waiting for KnobDeck to start.',
    refused: `KnobDeck refused the link: ${hubStatus.reason}`,
    disconnected: 'Not linked to KnobDeck.',
  }[hubStatus.state] || 'Not linked to KnobDeck.';
}

function renderStatus() {
  if (!statusItem) return;
  const port = config().port;
  const legacy = {
    serving: `Older KnobDeck versions: serving on 127.0.0.1:${port}.`,
    standby: 'Older KnobDeck versions: another window holds the port.',
    stopped: '',
    error: `Older KnobDeck versions: ${lastError}`,
  }[state];
  const linked = hubStatus.state === 'connected';
  // The hub link is what current KnobDeck uses; the legacy server only matters without it.
  const icon = linked || state === 'serving' ? '$(radio-tower)' : state === 'error' || hubStatus.state === 'refused' ? '$(warning)' : '$(debug-disconnect)';
  statusItem.text = `${icon} KnobDeck`;
  statusItem.tooltip = [hubLine(), legacy, 'Click for options.'].filter(Boolean).join('\n');
  statusItem.backgroundColor = !linked && (state === 'error' || hubStatus.state === 'refused') ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  statusItem.show();
}

function health() {
  return {
    app: 'KnobDeck VS Code Companion',
    version,
    editor: vscode.env.appName,
    workspaceFolders: (vscode.workspace.workspaceFolders || []).map((f) => ({ name: f.name, path: f.uri.fsPath })),
    terminals: vscode.window.terminals.length,
    activeDebugSession: Boolean(vscode.debug.activeDebugSession),
  };
}

async function closeInstance() {
  if (!instance) return;
  const current = instance;
  instance = null;
  servingPort = 0;
  await server.close(current);
}

/**
 * Binds the port. With `takeOver`, first asks the window holding it to let go.
 * Leaves the window serving, on standby (port held elsewhere) or in error.
 */
async function tryListen(takeOver) {
  const { port } = config();
  if (instance && servingPort === port) return;
  await closeInstance();

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setState('error', `"${port}" is not a valid port.`);
    return;
  }

  const created = server.createActionServer({
    password: () => config().password,
    health,
    queries: QUERIES,
    action: runAction,
    onHandoff: () => serial(async () => {
      if (instance !== created) return;
      await closeInstance();
      setState('standby');
    }),
  });

  const attempts = takeOver ? 6 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      await server.listen(created, port);
      instance = created;
      servingPort = port;
      setState('serving');
      return;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') {
        setState('error', error.message);
        return;
      }
      if (!takeOver) break;
      if (i === 0) await server.requestHandoff(port, config().password);
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  setState('standby');
}

function start(takeOver) {
  return serial(() => tryListen(takeOver));
}

function stop() {
  return serial(async () => {
    await closeInstance();
    setState('stopped');
  });
}

async function showStatus() {
  const { port, legacyServer } = config();
  const items = [];
  if (hub && hubStatus.state !== 'disconnected') items.push({ label: '$(debug-disconnect) Unlink this window from KnobDeck', run: () => stopAll() });
  else items.push({ label: '$(plug) Link this window to KnobDeck', run: () => startAll(true) });
  if (legacyServer) {
    if (state === 'serving') items.push({ label: '$(debug-stop) Stop the server for older KnobDeck versions', run: () => stop() });
    else items.push({ label: '$(play) Serve older KnobDeck versions from this window', run: () => start(true) });
  }
  items.push(
    { label: '$(list-flat) Browse command IDs', run: () => browseCommands() },
    { label: '$(gear) Open companion settings', run: () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:knobdeck.knobdeck-vscode-companion') }
  );
  const legacy = legacyServer
    ? { serving: ` · older versions: 127.0.0.1:${port}`, standby: ' · older versions: another window', stopped: '', error: ` · older versions: ${lastError}` }[state]
    : '';
  const placeHolder = `${hubLine()}${legacy}`;
  const pick = await vscode.window.showQuickPick(items, { placeHolder, title: 'KnobDeck VS Code Companion' });
  if (pick) await pick.run();
}

/** Lists ids to paste into KnobDeck's Custom Command action, and copies the chosen one. */
async function browseCommands() {
  const items = [{ label: 'KnobDeck', kind: vscode.QuickPickItemKind.Separator }];
  for (const [id, target] of Object.entries(SIMPLE_COMMANDS)) items.push({ label: id, description: target });
  for (const [id, param, what] of PARAM_COMMANDS) items.push({ label: id, description: `${what} (?${param}=…)` });
  items.push({ label: 'VS Code', kind: vscode.QuickPickItemKind.Separator });
  for (const id of (await vscode.commands.getCommands(true)).sort()) items.push({ label: id });
  const pick = await vscode.window.showQuickPick(items, {
    title: 'KnobDeck: Copy a command ID',
    placeHolder: 'Pick a command to copy its ID for KnobDeck\'s Custom Command action',
    matchOnDescription: true,
  });
  if (!pick) return;
  await vscode.env.clipboard.writeText(pick.label);
  vscode.window.showInformationMessage(`Copied "${pick.label}".`);
}

/** Link to the hub and, if enabled, serve older KnobDeck versions. */
function startAll(takeOver) {
  if (hub) hub.start();
  if (config().legacyServer) return start(takeOver);
  return Promise.resolve();
}

function stopAll() {
  if (hub) hub.stop();
  return stop();
}

function workspaceName() {
  return vscode.workspace.name || (vscode.workspace.workspaceFolders || [])[0]?.name || 'no folder';
}

async function activate(context) {
  version = context.extension.packageJSON.version;
  statusItem = vscode.window.createStatusBarItem('knobdeck.status', vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'KnobDeck';
  statusItem.command = 'knobdeck.showStatus';
  renderStatus();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('knobdeck.startServer', () => startAll(true)),
    vscode.commands.registerCommand('knobdeck.stopServer', () => stopAll()),
    vscode.commands.registerCommand('knobdeck.showStatus', () => showStatus()),
    vscode.commands.registerCommand('knobdeck.browseCommands', () => browseCommands()),
    vscode.window.onDidChangeWindowState((s) => {
      if (!s.focused) return;
      if (hub) hub.focused();
      if (state === 'standby' && config().legacyServer) start(true);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('knobdeck')) return;
      const { autostart } = config();
      if (e.affectsConfiguration('knobdeck.legacyServer')) {
        if (config().legacyServer && autostart) start(vscode.window.state.focused);
        else if (!config().legacyServer) stop();
      } else if (e.affectsConfiguration('knobdeck.port') && state !== 'stopped') start(vscode.window.state.focused);
      else if (e.affectsConfiguration('knobdeck.autostart') && autostart && state === 'stopped') startAll(vscode.window.state.focused);
      else renderStatus();
    }),
    { dispose: () => { clearTimeout(retryTimer); closeInstance(); if (hub) hub.stop(); } }
  );

  try {
    hub = await createHubLink({
      instance: vscode.env.sessionId,
      name: `${vscode.env.appName} — ${workspaceName()}`,
      appVersion: vscode.version,
      version,
      isFocused: () => vscode.window.state.focused,
      onStatus: (s) => {
        hubStatus = s;
        renderStatus();
      },
    });
  } catch (error) {
    hubStatus = { state: 'refused', reason: `the companion client failed to load (${error.message})` };
  }

  if (config().autostart) startAll(vscode.window.state.focused);
  else renderStatus();
  return { state: () => state, hubStatus: () => hubStatus };
}

function deactivate() {
  clearTimeout(retryTimer);
  if (hub) hub.stop();
  return closeInstance();
}

module.exports = { activate, deactivate };
