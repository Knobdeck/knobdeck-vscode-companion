'use strict';

// What KnobDeck can ask VS Code to do, and the lists it can ask for. The ids below are the
// contract with the KnobDeck `vscode` plugin: never rename one, only add.

const vscode = require('vscode');
const { HttpError } = require('./server');

/** KnobDeck id → VS Code command, for actions that need no arguments. */
const SIMPLE_COMMANDS = {
  'vscode.openCommandPalette': 'workbench.action.showCommands',
  'vscode.quickOpen': 'workbench.action.quickOpen',
  'vscode.explorer': 'workbench.view.explorer',
  'vscode.search': 'workbench.view.search',
  'vscode.sourceControl': 'workbench.view.scm',
  'vscode.extensions': 'workbench.view.extensions',
  'vscode.toggleTerminal': 'workbench.action.terminal.toggleTerminal',
  'vscode.problems': 'workbench.actions.view.problems',
  'vscode.saveAll': 'workbench.action.files.saveAll',
  'vscode.formatDocument': 'editor.action.formatDocument',
  'vscode.toggleSidebar': 'workbench.action.toggleSidebarVisibility',
  'vscode.togglePanel': 'workbench.action.togglePanel',
  'vscode.zenMode': 'workbench.action.toggleZenMode',
  'vscode.splitEditor': 'workbench.action.splitEditor',
  'vscode.newTerminal': 'workbench.action.terminal.new',
  'vscode.stopDebugging': 'workbench.action.debug.stop',
};

/** Actions that take a query parameter, for the command browser. */
const PARAM_COMMANDS = [
  ['vscode.runTask', 'name', 'Run a task by name'],
  ['vscode.startDebugging', 'name', 'Start a launch configuration by name'],
  ['vscode.focusTerminal', 'name', 'Show a terminal by name'],
  ['vscode.openEditor', 'uri', 'Open or focus an editor by URI'],
];

function required(params, key, what) {
  const value = String(params.get(key) || '').trim();
  if (!value) throw new HttpError(400, `${what} is required.`);
  return value;
}

// ---- queries --------------------------------------------------------------------------------

async function queryTasks() {
  const tasks = await vscode.tasks.fetchTasks();
  const seen = new Set();
  const items = [];
  for (const task of tasks) {
    if (seen.has(task.name)) continue;
    seen.add(task.name);
    items.push({ value: task.name, label: task.source && task.source !== 'Workspace' ? `${task.name} (${task.source})` : task.name });
  }
  return items;
}

/** Launch configurations and compounds by name, with the folder each one belongs to. */
function launchConfigsByName() {
  const byName = new Map();
  const add = (folder, entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
      if (name && !byName.has(name)) byName.set(name, folder);
    }
  };
  const folders = vscode.workspace.workspaceFolders || [];
  // A folder's view of `launch` already includes configurations from the .code-workspace file.
  for (const folder of folders.length ? folders : [undefined]) {
    const launch = vscode.workspace.getConfiguration('launch', folder ? folder.uri : undefined);
    add(folder, launch.get('configurations'));
    add(folder, launch.get('compounds'));
  }
  return byName;
}

function queryLaunchConfigs() {
  return [...launchConfigsByName().keys()].map((name) => ({ value: name, label: name }));
}

function queryTerminals() {
  const counts = new Map();
  for (const t of vscode.window.terminals) counts.set(t.name, (counts.get(t.name) || 0) + 1);
  const seen = new Set();
  const items = [];
  for (const t of vscode.window.terminals) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    const n = counts.get(t.name);
    items.push({ value: t.name, label: n > 1 ? `${t.name} (${n} open)` : t.name });
  }
  return items;
}

/** Every text editor tab, in tab order. */
function openTextTabs() {
  const tabs = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) tabs.push({ tab, group, uri: tab.input.uri });
    }
  }
  return tabs;
}

function queryOpenEditors() {
  const seen = new Set();
  const items = [];
  for (const { uri } of openTextTabs()) {
    const value = uri.toString();
    if (seen.has(value)) continue;
    seen.add(value);
    const label = uri.scheme === 'untitled' ? uri.path : vscode.workspace.asRelativePath(uri, false);
    items.push({ value, label });
  }
  return items;
}

const QUERIES = {
  tasks: queryTasks,
  'launch-configs': async () => queryLaunchConfigs(),
  terminals: async () => queryTerminals(),
  'open-editors': async () => queryOpenEditors(),
};

// ---- actions --------------------------------------------------------------------------------

async function runTask(params) {
  const name = required(params, 'name', 'Task name');
  const task = (await vscode.tasks.fetchTasks()).find((t) => t.name === name);
  if (!task) throw new HttpError(404, `Task "${name}" was not found.`);
  await vscode.tasks.executeTask(task);
}

async function startDebugging(params) {
  const name = required(params, 'name', 'Launch configuration name');
  const byName = launchConfigsByName();
  if (!byName.has(name)) throw new HttpError(404, `Launch configuration "${name}" was not found.`);
  const started = await vscode.debug.startDebugging(byName.get(name), name);
  if (!started) throw new HttpError(409, `Launch configuration "${name}" could not be started.`);
}

function focusTerminal(params) {
  const name = required(params, 'name', 'Terminal name');
  const matches = vscode.window.terminals.filter((t) => t.name === name);
  if (!matches.length) throw new HttpError(404, `Terminal "${name}" was not found.`);
  // Several terminals can share a name: pick the active one if it matches, else the newest.
  const active = vscode.window.activeTerminal;
  (matches.includes(active) ? active : matches[matches.length - 1]).show(false);
}

async function openEditor(params) {
  const uriText = required(params, 'uri', 'Editor URI');
  let uri;
  try {
    uri = vscode.Uri.parse(uriText, true);
  } catch {
    throw new HttpError(400, `"${uriText}" is not a valid URI.`);
  }
  const open = openTextTabs().find((t) => t.uri.toString() === uri.toString());
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    viewColumn: open ? open.group.viewColumn : undefined,
  });
}

async function runAction(commandId, params) {
  if (Object.prototype.hasOwnProperty.call(SIMPLE_COMMANDS, commandId)) {
    await vscode.commands.executeCommand(SIMPLE_COMMANDS[commandId]);
    return;
  }
  switch (commandId) {
    case 'vscode.runTask':
      return runTask(params);
    case 'vscode.startDebugging':
      return startDebugging(params);
    case 'vscode.focusTerminal':
      return focusTerminal(params);
    case 'vscode.openEditor':
      return openEditor(params);
    default: {
      // KnobDeck's "Custom Command": any VS Code command id, run without arguments.
      const known = await vscode.commands.getCommands(false);
      if (!known.includes(commandId)) throw new HttpError(404, `VS Code has no command "${commandId}".`);
      await vscode.commands.executeCommand(commandId);
    }
  }
}

module.exports = { QUERIES, SIMPLE_COMMANDS, PARAM_COMMANDS, runAction };
