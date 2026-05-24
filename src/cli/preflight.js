import { spawnSync } from "node:child_process";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export async function preFlightChecks(opts = {}) {
  if (opts.skipCheckLarkCli) return;
  checkLarkCli();
}

function checkLarkCli() {
  if (isLarkCliInstalled()) return;
  console.log([
    "",
    "提示：未检测到 lark-cli。",
    "",
    "装上 lark-cli 后，Codex 可以在需要时读取飞书云文档、日历、待办等飞书数据。",
    "这不会影响当前桥启动，但云文档深度读取能力会受限。",
    "",
    "手动安装：",
    `  ${BOLD}npm install -g @larksuite/cli${RESET}`,
    "安装后可按 lark-cli 文档完成账号或机器人身份配置。",
    "",
    "也可以用 --skip-check-lark-cli 跳过这个提示。",
    ""
  ].join("\n"));
}

function isLarkCliInstalled() {
  try {
    const result = spawnSync("lark-cli", ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
      shell: process.platform === "win32"
    });
    return result.status === 0;
  } catch {
    return false;
  }
}
