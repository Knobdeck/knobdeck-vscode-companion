// Copy of compat/driver.mjs in Knobdeck/knobdeck-companion; keep the two in step.
// Drives a built KnobDeck plugin (the Rust `vscode` / `intellij` plugins) over its real stdio
// protocol, the way the KnobDeck host does, so tests can check a plugin against a live companion.
//
//   const plugin = await PluginDriver.start(exe, { VSCODE_PORT: "32145" });
//   const { errors } = await plugin.invoke("run-task", { taskName: "build" });
//   const items = await plugin.request("query", { query_id: "vscode-get-tasks", inputs: {} });
//   await plugin.stop();
//
// Settings normally saved by the plugin's setup go in a fresh data folder as `.env`.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export class PluginDriver {
  static async start(exe, env = {}, { log = () => {} } = {}) {
    const dataDir = mkdtempSync(join(tmpdir(), "kd-compat-"));
    writeFileSync(join(dataDir, ".env"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
    const driver = new PluginDriver(exe, dataDir, log);
    await driver.#hello();
    return driver;
  }

  #child;
  #log;
  #waiters = new Map(); // id → resolve(frame)
  #errors = new Map(); // instance_id → [message]
  #ready;
  #seq = 0;
  frames = [];

  constructor(exe, dataDir, log) {
    this.dataDir = dataDir;
    this.#log = log;
    // The plugin reads `.env` before `hello`, from the folder the host names in KNOBDECK_PLUGIN_DATA.
    this.#child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, KNOBDECK_PLUGIN_DATA: dataDir } });
    this.#child.stderr.on("data", (d) => log(`[plugin stderr] ${String(d).trimEnd()}`));
    this.#ready = new Promise((resolve, reject) => {
      this.#child.once("exit", (code) => reject(new Error(`plugin exited (${code}) before ready`)));
      createInterface({ input: this.#child.stdout }).on("line", (line) => {
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          throw new Error(`plugin printed a non-protocol line: ${line}`);
        }
        log(`<- ${line}`);
        this.frames.push(frame);
        if (frame.type === "ready") resolve(frame);
        if (frame.type === "error" && frame.instance_id) {
          const list = this.#errors.get(frame.instance_id) ?? [];
          list.push(frame.message ?? frame.error ?? JSON.stringify(frame));
          this.#errors.set(frame.instance_id, list);
        }
        if ((frame.type === "done" || frame.type === "result") && this.#waiters.has(frame.id)) {
          this.#waiters.get(frame.id)(frame);
          this.#waiters.delete(frame.id);
        }
      });
    });
  }

  #send(msg) {
    this.#log(`-> ${JSON.stringify(msg)}`);
    this.#child.stdin.write(JSON.stringify(msg) + "\n");
  }

  #await(id, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(id);
        reject(new Error(`no reply to ${id} within ${ms} ms`));
      }, ms);
      this.#waiters.set(id, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }

  async #hello() {
    this.#send({ type: "hello", protocol: 2, plugin_id: "compat", data_dir: this.dataDir, host_version: "compat" });
    const ready = await Promise.race([this.#ready, new Promise((_, r) => setTimeout(() => r(new Error("no ready within 10 s")), 10000))]);
    if (!ready.done) throw new Error("plugin did not promise done frames");
  }

  /** Presses an action (or a wheel child). Resolves after the handler finishes. */
  async invoke(actionId, inputs = {}, { childId, ms = 15000 } = {}) {
    const id = `i${++this.#seq}`;
    const instance_id = `inst-${id}`;
    const msg = { type: "invoke", id, instance_id, action_id: actionId, trigger: "press", inputs };
    if (childId !== undefined) msg.child_id = childId;
    const done = this.#await(id, ms);
    this.#send(msg);
    await done;
    return { errors: this.#errors.get(instance_id) ?? [] };
  }

  /** `query` / `wheel` request. Resolves with the value, or throws the plugin's error. */
  async request(method, params, ms = 15000) {
    const id = `r${++this.#seq}`;
    const reply = this.#await(id, ms);
    this.#send({ type: "request", id, method, params });
    const frame = await reply;
    if (!frame.ok) throw new Error(frame.error);
    return frame.value;
  }

  async stop() {
    this.#send({ type: "shutdown" });
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        this.#child.kill();
        resolve();
      }, 3000);
      this.#child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

/** Runs a plugin's setup program as the host does. Resolves with { ok, env, output }. */
export function runSetup(exe, inputs) {
  const dataDir = mkdtempSync(join(tmpdir(), "kd-setup-"));
  return new Promise((resolve) => {
    const child = spawn(exe, [], {
      env: { ...process.env, KNOBDECK_SETUP_INPUTS: JSON.stringify(inputs), KNOBDECK_PLUGIN_DATA: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill(), 20000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      let env = "";
      try {
        env = readFileSync(join(dataDir, ".env"), "utf8");
      } catch {}
      resolve({ ok: code === 0, env, output });
    });
  });
}
