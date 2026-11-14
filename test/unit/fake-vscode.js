'use strict';

// A small stand-in for the `vscode` module, enough to run src/actions.js and src/extension.js in
// plain Node. It records what the companion asked VS Code to do in `calls`.

const Module = require('module');

class Uri {
  constructor(scheme, path) {
    this.scheme = scheme;
    this.path = path;
    this.fsPath = path;
  }
  static parse(text) {
    const m = /^([a-z][a-z0-9+.-]*):(?:\/\/)?(.*)$/i.exec(text);
    if (!m) throw new Error('bad uri');
    return new Uri(m[1], m[2].startsWith('/') ? m[2] : `/${m[2]}`);
  }
  static file(path) {
    return new Uri('file', path);
  }
  toString() {
    return this.scheme === 'file' ? `file://${this.path}` : `${this.scheme}:${this.path}`;
  }
}
class TabInputText {
  constructor(uri) {
    this.uri = uri;
  }
}
class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

function createFake() {
  const calls = [];
  const folder = { name: 'proj', index: 0, uri: Uri.file('/work/proj') };
  const terminal = (name) => ({ name, show: (preserve) => calls.push(['terminal.show', name, preserve]) });
  const settings = { port: 0, password: '', autostart: false };

  const state = {
    tasks: [
      { name: 'build', source: 'Workspace' },
      { name: 'test', source: 'npm' },
    ],
    launch: { configurations: [{ name: 'Launch Server' }], compounds: [{ name: 'All' }] },
    terminals: [terminal('zsh'), terminal('zsh'), terminal('server')],
    tabs: [Uri.file('/work/proj/src/index.ts'), Uri.file('/work/proj/README.md')],
    commands: ['workbench.action.showCommands', 'editor.action.formatDocument', 'my.custom'],
  };

  const vscode = {
    Uri,
    TabInputText,
    ThemeColor,
    StatusBarAlignment: { Left: 1, Right: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    env: { appName: 'Fake Code', clipboard: { writeText: async () => {} } },
    workspace: {
      workspaceFolders: [folder],
      getConfiguration: (section, scope) => ({
        get: (key, dflt) => {
          if (section === 'launch') return state.launch[key] ?? dflt;
          if (section === 'knobdeck') return settings[key] ?? dflt;
          return dflt;
        },
        _scope: scope,
      }),
      asRelativePath: (uri) => uri.path.replace('/work/proj/', ''),
      openTextDocument: async (uri) => ({ uri }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    window: {
      state: { focused: true },
      get terminals() {
        return state.terminals;
      },
      activeTerminal: undefined,
      get tabGroups() {
        return { all: [{ viewColumn: 2, tabs: state.tabs.map((u) => ({ input: new TabInputText(u) })) }] };
      },
      showTextDocument: async (doc, opts) => calls.push(['showTextDocument', doc.uri.toString(), opts.viewColumn]),
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
      onDidChangeWindowState: () => ({ dispose() {} }),
      showInformationMessage: () => {},
      showErrorMessage: () => {},
      showQuickPick: async () => undefined,
    },
    tasks: {
      fetchTasks: async () => state.tasks,
      executeTask: async (task) => calls.push(['executeTask', task.name]),
    },
    debug: {
      activeDebugSession: undefined,
      startDebugging: async (f, name) => {
        calls.push(['startDebugging', f && f.name, name]);
        return true;
      },
    },
    commands: {
      executeCommand: async (id) => calls.push(['executeCommand', id]),
      getCommands: async () => state.commands,
      registerCommand: () => ({ dispose() {} }),
    },
  };
  return { vscode, calls, state, settings };
}

/** Makes `require('vscode')` return `fake` for everything loaded afterwards. */
function install(fake) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'vscode') return fake;
    return original.call(this, request, ...rest);
  };
}

module.exports = { createFake, install };
