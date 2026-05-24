import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gcLogs } from "../core/logger.js";
import { gcMediaCache } from "../media/cache.js";
import { paths } from "../config/paths.js";
import { loadConfig, loadOrCreateConfig, saveConfig } from "../config/store.js";
import { createCodexAgent } from "../agent/codex.js";
import { preFlightChecks } from "./preflight.js";
import { SessionStore } from "../session/store.js";
import { WorkspaceStore } from "../workspace/store.js";
import { readRegistry, registerProcess, resolveProcess, unregisterProcess, unregisterProcessSync } from "../runtime/registry.js";
import { serviceStatus, startService, stopService, unregisterService } from "../daemon/service.js";

export async function main(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv.shift() : "help";
  const opts = parseOptions(argv);
  switch (command) {
    case "run":
      return runForeground(opts);
    case "init":
      return initConfig(opts);
    case "ps":
      return printProcesses();
    case "kill":
      return killProcess(argv[0]);
    case "start":
      return startDaemon(opts);
    case "stop":
      return stopDaemon();
    case "restart":
      await stopDaemon().catch(() => {});
      return startDaemon(opts);
    case "status":
      return printStatus();
    case "unregister":
      return unregisterDaemon();
    case "migrate":
      return migrateLegacy();
    case "help":
    case "--help":
    case "-h":
    default:
      return printHelp();
  }
}

async function runForeground(opts) {
  const configPath = opts.config || paths.configFile;
  let cfg = await loadOrCreateConfig(configPath);
  if (!cfg.accounts.app.id || !cfg.accounts.app.secret) {
    throw new Error(`请先填写飞书应用配置：${configPath}`);
  }
  await preFlightChecks(opts);
  await Promise.all([gcLogs(), gcMediaCache()]);
  const version = await packageVersion();
  const entry = await registerProcess({
    appId: cfg.accounts.app.id,
    tenant: cfg.accounts.app.tenant,
    configPath,
    version
  });

  const sessions = new SessionStore();
  const workspaces = new WorkspaceStore(undefined, cfg.preferences.defaultCwd);
  await Promise.all([sessions.load(), workspaces.load()]);

  let bridge;
  let closing = false;
  const controls = {
    configPath,
    cfg,
    processId: entry.id,
    async restart() {
      if (bridge) await bridge.disconnect().catch(() => {});
      cfg = await loadConfig(configPath);
      controls.cfg = cfg;
      bridge = await startBridge(cfg, controls, sessions, workspaces);
    },
    async exit() {
      if (closing) return;
      closing = true;
      if (bridge) await bridge.disconnect().catch(() => {});
      await unregisterProcess(entry.id).catch(() => {});
      process.exit(0);
    }
  };

  process.on("exit", () => unregisterProcessSync(entry.id));
  process.on("SIGINT", () => void controls.exit());
  process.on("SIGTERM", () => void controls.exit());

  bridge = await startBridge(cfg, controls, sessions, workspaces);
  console.log(`feishu-codex-bridge is running. process id: ${entry.id}`);
  await new Promise(() => {});
}

async function startBridge(cfg, controls, sessions, workspaces) {
  const { startChannel } = await import("../bot/channel.js");
  const agent = createCodexAgent(cfg.agent);
  return startChannel({ cfg, agent, sessions, workspaces, controls });
}

async function initConfig(opts) {
  const configPath = opts.config || paths.configFile;
  const cfg = await loadOrCreateConfig(configPath);
  await saveConfig(cfg, configPath);
  console.log(`配置已准备好：${configPath}`);
}

function printProcesses() {
  const entries = readRegistry();
  if (!entries.length) {
    console.log("No running bridge processes.");
    return;
  }
  for (const [index, entry] of entries.entries()) {
    console.log(`${index + 1}. ${entry.id} pid=${entry.pid} app=${entry.appId} tenant=${entry.tenant} started=${entry.startedAt}`);
  }
}

function killProcess(target) {
  if (!target) throw new Error("Usage: feishu-codex-bridge kill <id|#>");
  const entry = resolveProcess(target);
  if (!entry) throw new Error(`Process not found: ${target}`);
  process.kill(entry.pid, "SIGTERM");
  console.log(`Sent SIGTERM to ${entry.id} (${entry.pid})`);
}

async function startDaemon(opts) {
  const configPath = opts.config || paths.configFile;
  const spec = await startService(configPath);
  console.log(`Service installed: ${spec.path}`);
}

async function stopDaemon() {
  const spec = await stopService();
  console.log(`Service stopped: ${spec.path}`);
}

async function unregisterDaemon() {
  const spec = await unregisterService();
  console.log(`Service removed: ${spec.path}`);
}

async function printStatus() {
  const status = await serviceStatus();
  console.log(`Service file: ${status.path}`);
  console.log(`Installed: ${status.installed ? "yes" : "no"}`);
  printProcesses();
}

async function migrateLegacy() {
  console.log("No legacy migration is required for feishu-codex-bridge 0.1.x.");
}

function parseOptions(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-c" || arg === "--config") opts.config = resolve(argv[++i]);
    else if (arg === "--skip-check-lark-cli") opts.skipCheckLarkCli = true;
  }
  return opts;
}

async function packageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  const packagePath = resolve(here, "../../package.json");
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  return pkg.version;
}

function printHelp() {
  console.log(`feishu-codex-bridge

Usage:
  feishu-codex-bridge init [-c config.json]
  feishu-codex-bridge run [-c config.json] [--skip-check-lark-cli]
  feishu-codex-bridge ps
  feishu-codex-bridge kill <id|#>
  feishu-codex-bridge start [-c config.json]
  feishu-codex-bridge stop
  feishu-codex-bridge restart [-c config.json]
  feishu-codex-bridge status
  feishu-codex-bridge unregister
  feishu-codex-bridge migrate

Slash commands in Feishu:
  /new /reset /cd /ws /status /config /stop /timeout /ps /exit /doctor /reconnect /help
`);
}
