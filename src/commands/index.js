import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isAdmin, setPreference } from "../config/schema.js";
import { saveConfig } from "../config/store.js";
import { simpleCard, renderHelpCard, renderStatusCard, renderWorkspacesCard } from "../card/render.js";
import { readRecentLogs } from "../core/logger.js";
import { readRegistry, resolveProcess } from "../runtime/registry.js";

const SENSITIVE = new Set([
  "/account",
  "/config",
  "/cd",
  "/ws",
  "/stop",
  "/timeout",
  "/ps",
  "/exit",
  "/doctor",
  "/reconnect"
]);

export async function tryHandleCommand(ctx) {
  const content = String(ctx.msg.content || "").trim();
  if (!content.startsWith("/")) return false;
  const [command, ...rest] = content.split(/\s+/);
  const args = rest.join(" ");
  const canonical = command.toLowerCase();
  if (SENSITIVE.has(canonical) && !isAdmin(ctx.controls.cfg, ctx.msg.senderId)) {
    await sendMarkdown(ctx.channel, ctx.msg.chatId, "此命令仅管理员可用。", ctx.msg.messageId);
    return true;
  }

  switch (canonical) {
    case "/new":
    case "/reset":
      return handleNew(ctx);
    case "/cd":
      return handleCd(args, ctx);
    case "/ws":
      return handleWs(args, ctx);
    case "/status":
      return handleStatus(ctx);
    case "/help":
      return handleHelp(ctx);
    case "/account":
      return handleAccount(ctx);
    case "/config":
      return handleConfig(args, ctx);
    case "/stop":
      return handleStop(ctx);
    case "/timeout":
      return handleTimeout(args, ctx);
    case "/ps":
      return handlePs(ctx);
    case "/exit":
      return handleExit(args, ctx);
    case "/doctor":
      return handleDoctor(args, ctx);
    case "/reconnect":
      return handleReconnect(ctx);
    default:
      return false;
  }
}

async function handleNew(ctx) {
  ctx.sessions.clear(ctx.scope);
  await ctx.activeRuns.stop(ctx.scope);
  await sendCard(ctx, simpleCard("已重置", ["当前聊天的 Codex 会话已清空。"]));
  return true;
}

async function handleCd(args, ctx) {
  const cwd = resolve(args || ".");
  const st = await stat(cwd).catch(() => null);
  if (!st?.isDirectory()) {
    await sendMarkdown(ctx.channel, ctx.msg.chatId, `目录不存在：\`${cwd}\``, ctx.msg.messageId);
    return true;
  }
  ctx.workspaces.setCwd(ctx.scope, cwd);
  ctx.sessions.clear(ctx.scope);
  await sendCard(ctx, simpleCard("已切换工作目录", [`cwd: \`${cwd}\``, "当前会话已重置。"]));
  return true;
}

async function handleWs(args, ctx) {
  const [sub, name] = args.split(/\s+/);
  if (!sub || sub === "list") {
    await sendCard(ctx, renderWorkspacesCard(ctx.workspaces.listNamed()));
    return true;
  }
  if (sub === "save") {
    if (!name) return usage(ctx, "/ws save <name>");
    const cwd = ctx.workspaces.cwdFor(ctx.scope);
    ctx.workspaces.saveNamed(name, cwd);
    await sendCard(ctx, simpleCard("工作空间已保存", [`\`${name}\` -> \`${cwd}\``]));
    return true;
  }
  if (sub === "use") {
    if (!name) return usage(ctx, "/ws use <name>");
    const cwd = ctx.workspaces.useNamed(ctx.scope, name);
    if (!cwd) await sendMarkdown(ctx.channel, ctx.msg.chatId, `没有找到工作空间：\`${name}\``, ctx.msg.messageId);
    else {
      ctx.sessions.clear(ctx.scope);
      await sendCard(ctx, simpleCard("已切换工作空间", [`\`${name}\` -> \`${cwd}\``, "当前会话已重置。"]));
    }
    return true;
  }
  if (sub === "remove") {
    if (!name) return usage(ctx, "/ws remove <name>");
    const ok = ctx.workspaces.removeNamed(name);
    await sendMarkdown(ctx.channel, ctx.msg.chatId, ok ? `已删除工作空间：\`${name}\`` : `没有找到工作空间：\`${name}\``, ctx.msg.messageId);
    return true;
  }
  return usage(ctx, "/ws list | /ws save <name> | /ws use <name> | /ws remove <name>");
}

async function handleStatus(ctx) {
  const cwd = ctx.workspaces.cwdFor(ctx.scope);
  const sessionId = ctx.sessions.resumeFor(ctx.scope, cwd);
  await sendCard(ctx, renderStatusCard({
    cwd,
    sessionId,
    scope: ctx.scope,
    processId: ctx.controls.processId,
    replyMode: ctx.controls.cfg.preferences.replyMode,
    requireMentionInGroup: ctx.controls.cfg.preferences.requireMentionInGroup
  }));
  return true;
}

async function handleHelp(ctx) {
  await sendCard(ctx, renderHelpCard());
  return true;
}

async function handleAccount(ctx) {
  const app = ctx.controls.cfg.accounts.app;
  await sendCard(ctx, simpleCard("当前飞书应用", [
    `tenant: \`${app.tenant}\``,
    `appId: \`${app.id || "-"}\``,
    "secret: `[redacted]`"
  ]));
  return true;
}

async function handleConfig(args, ctx) {
  if (!args) {
    const prefs = ctx.controls.cfg.preferences;
    await sendCard(ctx, simpleCard("当前配置", [
      `replyMode: \`${prefs.replyMode}\``,
      `requireMentionInGroup: \`${prefs.requireMentionInGroup}\``,
      `showToolCalls: \`${prefs.showToolCalls}\``,
      `maxConcurrentRuns: \`${prefs.maxConcurrentRuns}\``,
      `idleTimeoutMinutes: \`${prefs.idleTimeoutMinutes}\``,
      "",
      "修改示例：",
      "`/config set replyMode markdown`",
      "`/config set requireMentionInGroup off`",
      "`/config set admins ou_xxx,ou_yyy`"
    ]));
    return true;
  }
  const [verb, key, ...valueParts] = args.split(/\s+/);
  if (verb !== "set" || !key) return usage(ctx, "/config set <key> <value>");
  setPreference(ctx.controls.cfg, key, valueParts.join(" "));
  await saveConfig(ctx.controls.cfg, ctx.controls.configPath);
  await sendMarkdown(ctx.channel, ctx.msg.chatId, `已保存配置：\`${key}\``, ctx.msg.messageId);
  return true;
}

async function handleStop(ctx) {
  const stopped = await ctx.activeRuns.stop(ctx.scope);
  await sendMarkdown(ctx.channel, ctx.msg.chatId, stopped ? "已停止当前 run。" : "当前没有正在运行的 Codex run。", ctx.msg.messageId);
  return true;
}

async function handleTimeout(args, ctx) {
  const value = String(args || "").trim();
  if (!value) {
    const current = ctx.sessions.getIdleTimeout(ctx.scope);
    await sendMarkdown(ctx.channel, ctx.msg.chatId, `当前会话 timeout：\`${current ?? "default"}\``, ctx.msg.messageId);
    return true;
  }
  if (value === "default") ctx.sessions.setIdleTimeout(ctx.scope, undefined);
  else if (value === "off") ctx.sessions.setIdleTimeout(ctx.scope, 0);
  else ctx.sessions.setIdleTimeout(ctx.scope, Math.max(0, Number(value)));
  await sendMarkdown(ctx.channel, ctx.msg.chatId, "已更新当前会话 timeout。", ctx.msg.messageId);
  return true;
}

async function handlePs(ctx) {
  const entries = readRegistry();
  const lines = entries.length ? entries.map((entry, index) => `${index + 1}. ${entry.id} pid=${entry.pid} app=${entry.appId} started=${entry.startedAt}${entry.id === ctx.controls.processId ? " <- this" : ""}`) : ["没有发现正在运行的 bridge 进程。"];
  await sendCard(ctx, simpleCard("本机进程", lines));
  return true;
}

async function handleExit(args, ctx) {
  const target = args.trim();
  if (!target) return usage(ctx, "/exit <id|#>");
  const entry = resolveProcess(target);
  if (!entry) {
    await sendMarkdown(ctx.channel, ctx.msg.chatId, `没有找到进程：\`${target}\``, ctx.msg.messageId);
    return true;
  }
  if (entry.id === ctx.controls.processId) {
    await sendMarkdown(ctx.channel, ctx.msg.chatId, "正在退出当前进程。", ctx.msg.messageId);
    void ctx.controls.exit();
  } else {
    process.kill(entry.pid, "SIGTERM");
    await sendMarkdown(ctx.channel, ctx.msg.chatId, `已请求停止进程：\`${entry.id}\``, ctx.msg.messageId);
  }
  return true;
}

async function handleDoctor(args, ctx) {
  const logs = await readRecentLogs(160);
  const prompt = [
    "请根据下面 feishu-codex-bridge 的近期日志诊断问题，并给出简短修复建议。",
    args ? `用户描述：${args}` : "",
    "日志：",
    logs || "(没有读取到日志)"
  ].filter(Boolean).join("\n\n");
  const cwd = ctx.workspaces.cwdFor(ctx.scope);
  const run = ctx.agent.run({ prompt, cwd, sessionId: "", images: [], stopGraceMs: ctx.controls.cfg.preferences.stopGraceMs });
  let text = "";
  for await (const event of run.events) {
    if (event.type === "text_delta" || event.type === "result") text += event.text || "";
    if (event.type === "error") text += `\n${event.message}`;
  }
  await run.waitForExit();
  await sendMarkdown(ctx.channel, ctx.msg.chatId, text.trim() || "Codex 没有给出诊断结果。", ctx.msg.messageId);
  return true;
}

async function handleReconnect(ctx) {
  await sendMarkdown(ctx.channel, ctx.msg.chatId, "正在重连。", ctx.msg.messageId);
  void ctx.controls.restart();
  return true;
}

async function usage(ctx, text) {
  await sendMarkdown(ctx.channel, ctx.msg.chatId, `用法：\`${text}\``, ctx.msg.messageId);
  return true;
}

async function sendCard(ctx, card) {
  await ctx.channel.send(ctx.msg.chatId, { card }, { replyTo: ctx.msg.messageId });
}

async function sendMarkdown(channel, chatId, markdown, replyTo) {
  await channel.send(chatId, { markdown }, replyTo ? { replyTo } : undefined);
}
