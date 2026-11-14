'use strict';

// The companion's local HTTP action server. Kept free of the `vscode` module so it can be
// unit-tested in plain Node. See ../../PROTOCOL.md for the wire format KnobDeck relies on.

const http = require('http');
const crypto = require('crypto');

/** A request handler's way to answer with a specific status and message. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Requests from a web page carry `Origin` or `Sec-Fetch-*` headers, and a DNS-rebinding page
 * reaches us under its own host name. KnobDeck sends neither, so refusing them keeps websites
 * from driving the editor even when no password is set.
 */
function isBrowserOrForeign(req) {
  const port = req.socket.localPort;
  const h = req.headers;
  if (h.origin || h['sec-fetch-site'] || h['sec-fetch-mode'] || h['sec-fetch-dest']) return true;
  const host = String(h.host || '').toLowerCase();
  const name = host.replace(/:\d+$/, '');
  const hostPort = host.slice(name.length + 1);
  return !LOOPBACK_HOSTS.has(name) || (hostPort !== '' && hostPort !== String(port));
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

/** Resolves with `promise`, or with `fallback` once `ms` pass (the action keeps running). */
function settleWithin(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} opts
 * @param {() => string} opts.password  read per request, so a settings change applies at once
 * @param {() => object} opts.health    body of `GET /health`
 * @param {Record<string, () => Promise<Array<{value: string, label: string}>>>} opts.queries
 * @param {(commandId: string, params: URLSearchParams) => Promise<void>} opts.action
 * @param {() => void} [opts.onHandoff] another editor window asked to take the port over
 * @param {number} [opts.actionWaitMs] how long an action may run before we answer anyway
 */
function createActionServer(opts) {
  const actionWaitMs = opts.actionWaitMs ?? 5000;

  return http.createServer(async (req, res) => {
    try {
      if (isBrowserOrForeign(req)) {
        throw new HttpError(403, 'Requests from web pages are not accepted.');
      }
      const password = opts.password();
      if (password && !safeEqual(req.headers.authorization || '', password)) {
        throw new HttpError(401, 'Wrong password. Use the same password in KnobDeck and in the companion settings.');
      }

      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const path = url.pathname;

      if (req.method === 'POST' && path === '/api/handoff') {
        if (req.headers['x-knobdeck-companion'] !== 'handoff') throw new HttpError(400, 'Bad handoff request.');
        if (!opts.onHandoff) throw new HttpError(404, 'Not found.');
        sendJson(res, 200, { ok: true });
        opts.onHandoff();
        return;
      }

      if (req.method !== 'GET') throw new HttpError(405, 'Only GET is supported.');

      if (path === '/health') {
        sendJson(res, 200, { ok: true, ...opts.health() });
        return;
      }

      if (path.startsWith('/api/query/')) {
        const name = decodeURIComponent(path.slice('/api/query/'.length));
        const query = Object.prototype.hasOwnProperty.call(opts.queries, name) ? opts.queries[name] : null;
        if (!query) throw new HttpError(404, `Unknown query "${name}".`);
        sendJson(res, 200, { items: await query() });
        return;
      }

      if (path.startsWith('/api/action/')) {
        const commandId = decodeURIComponent(path.slice('/api/action/'.length));
        if (!commandId) throw new HttpError(400, 'Command ID is required.');
        const done = await settleWithin(
          opts.action(commandId, url.searchParams).then(() => true),
          actionWaitMs,
          false
        );
        sendJson(res, 200, done ? { ok: true } : { ok: true, pending: true });
        return;
      }

      throw new HttpError(404, 'Not found.');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (!res.headersSent) sendJson(res, status, { ok: false, error: error.message || 'Unknown error' });
    }
  });
}

/** Listens on loopback only. Rejects with the socket error (e.g. EADDRINUSE). */
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

/** Asks the window currently holding the port to let go of it. */
function requestHandoff(port, password) {
  return new Promise((resolve) => {
    const headers = { 'X-KnobDeck-Companion': 'handoff', 'Content-Length': 0 };
    if (password) headers.Authorization = password;
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/api/handoff', headers, timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

module.exports = { HttpError, createActionServer, listen, close, requestHandoff, isBrowserOrForeign };
