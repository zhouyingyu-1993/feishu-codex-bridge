export function renderRunCard(state, options = {}) {
  const title = titleFor(state.terminal);
  const lines = [];
  if (state.terminal === "idle_timeout") {
    lines.push(`**已因超时自动停止**：Codex 连续 ${formatDuration(state.timeoutMs)}没有输出。`);
  }
  if (state.text?.trim()) lines.push(...chunkText(state.text.trim()));
  if (options.showToolCalls !== false && state.tools?.length) {
    lines.push("**工具调用**");
    for (const tool of state.tools.slice(-8)) {
      const mark = tool.name === "codex stderr" || tool.status === "error" ? "ERR" : tool.status === "done" ? "OK" : "...";
      const detail = toolDetail(tool);
      lines.push(`- ${mark} ${tool.name}${detail ? `：${detail}` : ""}`);
    }
  }
  if (!lines.length && state.terminal === "idle_timeout") {
    lines.push(`已因超时自动停止：Codex 连续 ${formatDuration(state.timeoutMs)}没有输出。`);
  } else if (!lines.length) {
    lines.push("Codex 正在思考...");
  }

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: title },
      template: templateFor(state.terminal)
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: lines.join("\n\n")
        },
        {
          tag: "markdown",
          content: "_需要停止时，请直接发送 `/stop`；查看状态发送 `/status`。_"
        }
      ]
    }
  };
}

export function renderHelpCard() {
  return simpleCard("feishu-codex-bridge 帮助", [
    "`/new` 或 `/reset` 清空当前会话",
    "`/cd <path>` 切换当前工作目录",
    "`/ws list|save|use|remove` 管理命名工作空间",
    "`/status` 查看当前会话、工作目录和 Codex 状态",
    "`/config` 查看或修改偏好",
    "`/stop` 停止当前 Codex run",
    "`/timeout 10|off|default` 设置当前会话空闲超时",
    "`/ps` 和 `/exit <id|#>` 管理本机 bridge 进程",
    "`/doctor <描述>` 读取近期日志并让 Codex 帮你诊断"
  ]);
}

export function renderStatusCard({ cwd, sessionId, scope, processId, replyMode, requireMentionInGroup }) {
  return simpleCard("当前状态", [
    `scope: \`${scope}\``,
    `cwd: \`${cwd}\``,
    `session: \`${sessionId || "new"}\``,
    `process: \`${processId}\``,
    `replyMode: \`${replyMode}\``,
    `requireMentionInGroup: \`${requireMentionInGroup ? "yes" : "no"}\``
  ]);
}

export function renderWorkspacesCard(named) {
  const entries = Object.entries(named);
  return simpleCard("工作空间", entries.length ? entries.map(([name, cwd]) => `- \`${name}\` -> \`${cwd}\``) : ["还没有保存工作空间。"]);
}

export function simpleCard(title, lines) {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: title },
      template: "blue"
    },
    body: {
      elements: [
        { tag: "markdown", content: lines.join("\n") }
      ]
    }
  };
}

export function renderText(state, showToolCalls = true) {
  const parts = [];
  if (state.terminal === "idle_timeout") {
    parts.push(`已因超时自动停止：Codex 连续 ${formatDuration(state.timeoutMs)}没有输出。`);
  }
  if (state.text?.trim()) parts.push(state.text.trim());
  if (showToolCalls && state.tools?.length) {
    parts.push(state.tools.map((tool) => {
      const detail = toolDetail(tool);
      return `- ${tool.status}: ${tool.name}${detail ? `: ${detail}` : ""}`;
    }).join("\n"));
  }
  if (!parts.length) parts.push("Codex 没有返回可展示内容。");
  return parts.join("\n\n");
}

function titleFor(terminal) {
  if (terminal === "done") return "Codex 已完成";
  if (terminal === "error") return "Codex 出错";
  if (terminal === "interrupted") return "Codex 已停止";
  if (terminal === "idle_timeout") return "Codex 超时停止";
  return "Codex 正在处理";
}

function templateFor(terminal) {
  if (terminal === "done") return "green";
  if (terminal === "error" || terminal === "idle_timeout") return "red";
  if (terminal === "interrupted") return "yellow";
  return "blue";
}

function chunkText(text, limit = 5800) {
  const chunks = [];
  for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit));
  return chunks;
}

function formatDuration(ms = 0) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (!seconds) return "设定时间";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

function toolDetail(tool) {
  if (tool.name !== "codex stderr" || !tool.input) return "";
  return truncateInline(tool.input, 180);
}

function truncateInline(text, limit) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}
