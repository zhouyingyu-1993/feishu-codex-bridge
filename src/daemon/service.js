import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { paths } from "../config/paths.js";

const execFileAsync = promisify(execFile);

export async function startService(configPath) {
  const spec = serviceSpec(configPath);
  await mkdir(dirname(spec.path), { recursive: true });
  await writeFile(spec.path, spec.body, "utf8");
  if (spec.mode) await chmod(spec.path, spec.mode);
  if (spec.start) await spec.start();
  return spec;
}

export async function stopService() {
  const spec = serviceSpec(paths.configFile);
  if (spec.stop) await spec.stop().catch(() => {});
  return spec;
}

export async function unregisterService() {
  const spec = await stopService();
  await rm(spec.path, { force: true });
  return spec;
}

export async function serviceStatus() {
  const spec = serviceSpec(paths.configFile);
  const body = await readFile(spec.path, "utf8").catch(() => "");
  return { path: spec.path, installed: Boolean(body), body };
}

function serviceSpec(configPath) {
  const bin = process.argv[1];
  if (process.platform === "darwin") {
    const label = "ai.feishu-codex-bridge.bot";
    const path = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${bin}</string>
    <string>run</string>
    <string>-c</string>
    <string>${configPath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(paths.logsDir, "daemon-stdout.log")}</string>
  <key>StandardErrorPath</key><string>${join(paths.logsDir, "daemon-stderr.log")}</string>
</dict>
</plist>
`;
    return {
      path,
      body,
      start: () => execFileAsync("launchctl", ["bootstrap", `gui/${process.getuid()}`, path]).catch(() => execFileAsync("launchctl", ["load", path])),
      stop: () => execFileAsync("launchctl", ["bootout", `gui/${process.getuid()}`, path]).catch(() => execFileAsync("launchctl", ["unload", path]))
    };
  }
  if (process.platform === "win32") {
    const path = join(paths.home, "daemon-launcher.cmd");
    const body = `"${process.execPath}" "${bin}" run -c "${configPath}"\r\n`;
    return {
      path,
      body,
      start: () => execFileAsync("schtasks", ["/Create", "/TN", "FeishuCodexBridge.Bot", "/TR", path, "/SC", "ONLOGON", "/F"]),
      stop: () => execFileAsync("schtasks", ["/Delete", "/TN", "FeishuCodexBridge.Bot", "/F"])
    };
  }
  const path = join(homedir(), ".config", "systemd", "user", "feishu-codex-bridge.bot.service");
  const body = `[Unit]
Description=Feishu Codex Bridge

[Service]
ExecStart=${process.execPath} ${bin} run -c ${configPath}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
  return {
    path,
    body,
    start: async () => {
      await execFileAsync("systemctl", ["--user", "daemon-reload"]);
      await execFileAsync("systemctl", ["--user", "enable", "--now", "feishu-codex-bridge.bot.service"]);
    },
    stop: () => execFileAsync("systemctl", ["--user", "disable", "--now", "feishu-codex-bridge.bot.service"])
  };
}
