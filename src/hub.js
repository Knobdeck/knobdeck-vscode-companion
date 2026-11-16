'use strict';

// This window's link to KnobDeck's companion hub (KnobDeck with the `companion_hub` feature).
// Every VS Code window keeps its own link; the plugin drives the window that last had focus, which
// each window reports with a `window_focused` event. No port to share, no password: the hub's
// token comes from KnobDeck's discovery file, read again on every reconnect.
//
// Requests: an action id from ./actions (`vscode.runTask`, a VS Code command id, …) with its
// parameters as an object, or `query` with `{ name }` for the lists in QUERIES.

const { QUERIES, runAction } = require('./actions');

/** The KnobDeck plugin this companion belongs to: one package per OS (`vscode-linux`, …). */
const PLUGIN_ID = `vscode-${{ darwin: 'macos', win32: 'windows' }[process.platform] || process.platform}`;

/** An action still running after this long is answered `{pending: true}` (it keeps running). */
const ACTION_WAIT_MS = 4500;

/** Resolves with `promise`, or with `fallback` once `ms` pass. */
function settleWithin(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))]).finally(() =>
    clearTimeout(timer)
  );
}

/** URL-style parameters for runAction, from a request's params object. */
function toSearchParams(params) {
  const out = new URLSearchParams();
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out.set(k, String(v));
  }
  return out;
}

/** Answer one hub request. Throwing makes the client answer `{ok: false, error}`. */
async function handle(action, params) {
  if (action === 'query') {
    const name = String((params && params.name) || '');
    const query = Object.prototype.hasOwnProperty.call(QUERIES, name) ? QUERIES[name] : null;
    if (!query) throw new Error(`Unknown query "${name}".`);
    return { items: await query() };
  }
  const done = await settleWithin(runAction(action, toSearchParams(params)).then(() => true), ACTION_WAIT_MS, false);
  return done ? { done: true } : { pending: true };
}

/** A WebSocket for the client: the global one where Node has it, else the `ws` package. */
function socketFactory() {
  if (typeof globalThis.WebSocket === 'function') return undefined;
  const WS = require('ws');
  return (url) => new WS(url);
}

/**
 * @param {object} opts
 * @param {string} opts.instance   stable for this window's lifetime
 * @param {string} opts.name       what KnobDeck shows for this window
 * @param {string} opts.appVersion
 * @param {string} opts.version    this extension's version
 * @param {() => boolean} opts.isFocused
 * @param {(status: {state: string, link?: string, reason?: string}) => void} opts.onStatus
 * @param {object} [opts.discovery] tests: `{token, ports}` instead of the discovery file
 * @param {Function} [opts.socket]  tests: a WebSocket factory
 */
async function createHubLink(opts) {
  const { Companion } = await import('@knobdeck/companion');
  // KNOBDECK_COMPANION_DISCOVERY: another discovery file (the end-to-end tests' fake hub).
  const discovery =
    opts.discovery || (await import('@knobdeck/companion/node')).fromDiscovery(process.env.KNOBDECK_COMPANION_DISCOVERY || undefined);
  let companion = null;

  const link = {
    start() {
      if (companion) return;
      companion = new Companion({
        plugin: PLUGIN_ID,
        instance: opts.instance,
        app: 'vscode',
        appVersion: opts.appVersion,
        name: opts.name,
        version: opts.version,
        features: ['window_focused'],
        ...discovery,
        socket: opts.socket || socketFactory(),
        onStatus: (s) => {
          opts.onStatus(s);
          // A new link: tell the plugin if this is the window in front.
          if (s.state === 'connected' && opts.isFocused()) link.focused();
        },
      });
      // Every id goes through one handler: unknown ids are VS Code command ids (Custom Command).
      companion.fallback((action, params) => handle(action, params));
      companion.start();
    },
    stop() {
      if (companion) companion.stop();
      companion = null;
      opts.onStatus({ state: 'disconnected' });
    },
    /** This window gained focus: KnobDeck should drive it. */
    focused() {
      if (companion) companion.emit('window_focused', {});
    },
    get connected() {
      return Boolean(companion && companion.connected);
    },
  };
  return link;
}

module.exports = { PLUGIN_ID, createHubLink, handle, toSearchParams };
