'use strict';

const vscode = require('vscode');
const server = require('./server');
const { QUERIES, SIMPLE_COMMANDS, PARAM_COMMANDS, runAction } = require('./actions');

// One action server per machine, on one port: every VS Code window runs this extension, so the
// window that holds the port is the one KnobDeck controls. When another window gains focus it asks
// the holder to hand the port over, so KnobDeck always drives the window you last used.

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

function config() {
  const c = vscode.workspace.getConfiguration('knobdeck');
  return {
    port: Number(c.get('port', 32145)),
    password: String(c.get('password', '')),
    autostart: Boolean(c.get('autostart', true)),
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

function renderStatus() {
  if (!statusItem) return;
  const port = config().port;
  const look = {
    serving: ['$(radio-tower) KnobDeck', `KnobDeck is controlling this window (127.0.0.1:${port}).`],
    standby: ['$(debug-disconnect) KnobDeck', 'Another VS Code window is connected to KnobDeck. Focus this window to switch.'],
    stopped: ['$(circle-slash) KnobDeck', 'The KnobDeck action server is off.'],
    error: ['$(warning) KnobDeck', `KnobDeck action server: ${lastError}`],
  }[state];
  statusItem.text = look[0];
  statusItem.tooltip = `${look[1]}\nClick for options.`;
  statusItem.backgroundColor = state === 'error' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
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
  const { port } = config();
  const items = [];
  if (state === 'serving') items.push({ label: '$(debug-stop) Stop the action server', run: () => stop() });
  else items.push({ label: '$(play) Connect this window to KnobDeck', run: () => start(true) });
  items.push(
    { label: '$(list-flat) Browse command IDs', run: () => browseCommands() },
    { label: '$(gear) Open companion settings', run: () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:knobdeck.knobdeck-vscode-companion') }
  );
  const placeHolder = {
    serving: `Connected: KnobDeck controls this window on 127.0.0.1:${port}`,
    standby: `Standby: another VS Code window holds port ${port}`,
    stopped: 'Stopped',
    error: `Error: ${lastError}`,
  }[state];
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

function activate(context) {
  version = context.extension.packageJSON.version;
  statusItem = vscode.window.createStatusBarItem('knobdeck.status', vscode.StatusBarAlignment.Right, 100);
  statusItem.name = 'KnobDeck';
  statusItem.command = 'knobdeck.showStatus';
  renderStatus();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('knobdeck.startServer', () => start(true)),
    vscode.commands.registerCommand('knobdeck.stopServer', () => stop()),
    vscode.commands.registerCommand('knobdeck.showStatus', () => showStatus()),
    vscode.commands.registerCommand('knobdeck.browseCommands', () => browseCommands()),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused && state === 'standby') start(true);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('knobdeck')) return;
      const { autostart } = config();
      if (e.affectsConfiguration('knobdeck.port') && state !== 'stopped') start(vscode.window.state.focused);
      else if (e.affectsConfiguration('knobdeck.autostart') && autostart && state === 'stopped') start(vscode.window.state.focused);
      else renderStatus();
    }),
    { dispose: () => { clearTimeout(retryTimer); closeInstance(); } }
  );

  if (config().autostart) start(vscode.window.state.focused);
  return { state: () => state };
}

function deactivate() {
  clearTimeout(retryTimer);
  return closeInstance();
}

module.exports = { activate, deactivate };
