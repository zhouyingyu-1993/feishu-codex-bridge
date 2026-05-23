import { homedir } from "node:os";
import { join } from "node:path";

export const appHome = process.env.FEISHU_CODEX_BRIDGE_HOME || join(homedir(), ".feishu-codex-bridge");

export const paths = {
  home: appHome,
  configFile: join(appHome, "config.json"),
  sessionsFile: join(appHome, "sessions.json"),
  workspacesFile: join(appHome, "workspaces.json"),
  processesFile: join(appHome, "processes.json"),
  mediaDir: join(appHome, "media"),
  logsDir: join(appHome, "logs")
};

export function todayLogPath(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return join(paths.logsDir, `${day}.log`);
}
