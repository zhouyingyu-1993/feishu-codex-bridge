import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLines } from "../core/line-reader.js";
import { logEvent } from "../core/logger.js";
import { normalizeCodexJson } from "./events.js";

export function createCodexAgent(agentConfig = {}) {
  return {
    id: "codex",
    displayName: "Codex",
    run(options) {
      return runCodex(agentConfig, options);
    }
  };
}

export function runCodex(config, options) {
  const controller = new AbortController();
  const out = createAsyncQueue();
  const command = config.command || "codex";
  let child;
  let exitPromise;
  let finalFile;

  async function start() {
    const tempDir = await mkdtemp(join(tmpdir(), "feishu-codex-"));
    finalFile = join(tempDir, "last-message.txt");
    const args = buildArgs(config, options, finalFile);
    child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      signal: controller.signal,
      env: { ...process.env, NO_COLOR: "1" }
    });

    await logEvent("codex.spawn", { command, args: redactArgs(args), cwd: options.cwd });
    child.stdin.end(options.prompt);

    exitPromise = new Promise((resolve) => {
      child.once("close", async (code, signal) => {
        const finalText = await readFile(finalFile, "utf8").catch(() => "");
        if (finalText.trim()) out.push({ type: "result", text: finalText.trim(), success: code === 0 });
        if (code && code !== 0) out.push({ type: "error", message: `Codex exited with code ${code}` });
        out.end();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        resolve({ code, signal });
      });
    });

    void consumeStdout(child.stdout, out);
    void consumeStderr(child.stderr, out);
  }

  const started = start().catch((err) => {
    out.push({ type: "error", message: err?.message || String(err) });
    out.end();
  });

  return {
    get events() {
      return out.iterable(started);
    },
    async stop() {
      controller.abort();
      if (child && !child.killed) {
        child.kill("SIGTERM");
        await delay(Number(options.stopGraceMs || 2000));
        if (!child.killed) child.kill("SIGKILL");
      }
      out.push({ type: "interrupted" });
    },
    async waitForExit() {
      await started;
      return exitPromise || { code: 1 };
    }
  };
}

function buildArgs(config, options, finalFile) {
  const args = ["exec"];
  if (options.sessionId) {
    args.push("resume", "--json", "--skip-git-repo-check", "-o", finalFile);
    if (config.model) args.push("-m", config.model);
    args.push(options.sessionId, "-");
  } else {
    args.push("--json", "--skip-git-repo-check", "-C", options.cwd, "-o", finalFile);
    if (config.model) args.push("-m", config.model);
    if (config.profile) args.push("-p", config.profile);
    if (config.sandbox) args.push("-s", config.sandbox);
    if (config.askForApproval) args.push("-a", config.askForApproval);
    for (const image of options.images || []) args.push("-i", image);
    args.push(...(config.extraArgs || []), "-");
  }
  return args;
}

async function consumeStdout(stream, out) {
  for await (const line of readLines(stream)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      for (const event of normalizeCodexJson(parsed)) out.push(event);
    } catch {
      out.push({ type: "text_delta", text: `${line}\n` });
    }
  }
}

async function consumeStderr(stream, out) {
  for await (const line of readLines(stream)) {
    if (!line.trim() || line.includes("could not update PATH")) continue;
    out.push({ type: "tool_use", id: `stderr-${Date.now()}`, name: "codex stderr", input: line });
  }
}

function createAsyncQueue() {
  const values = [];
  const waiters = [];
  let closed = false;
  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value, done: false });
      else values.push(value);
    },
    end() {
      closed = true;
      while (waiters.length) waiters.shift()({ value: undefined, done: true });
    },
    async *iterable(started) {
      await started;
      while (values.length || !closed) {
        if (values.length) yield values.shift();
        else {
          const next = await new Promise((resolve) => waiters.push(resolve));
          if (next.done) return;
          yield next.value;
        }
      }
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactArgs(args) {
  return args.map((arg) => /secret|token|key/i.test(arg) ? "[redacted]" : arg);
}
