import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import { Domain, LoggerLevel, createLarkChannel } from "@larksuiteoapi/node-sdk";
import { isChatAllowed, isUserAllowed } from "../config/schema.js";
import { reduceRunState, initialRunState } from "../agent/events.js";
import { renderRunCard, renderText } from "../card/render.js";
import { logEvent } from "../core/logger.js";
import { MediaCache } from "../media/cache.js";
import { tryHandleCommand } from "../commands/index.js";
import { maybeAnswerQuickLocalQuestion } from "../quick/project-summary.js";
import { ActiveRuns } from "./active-runs.js";
import { PendingQueue } from "./pending-queue.js";
import { ProcessPool } from "./process-pool.js";

const DEBOUNCE_MS = 600;
const BRIDGE_INSTRUCTIONS = [
  "你正在通过飞书机器人回复用户。",
  "执行任务前不要先发计划或过程说明；需要查看或修改文件时，直接完成操作。",
  "最终回复要简短说明结果。若修改了文件，明确说“已完成”，并说明改了哪个文件和哪处内容；不要用“我先”“接下来”“将会”等还没完成的表述。"
];
const EDIT_INTENT_RE = /(改|修改|改成|替换|删除|删掉|新增|添加|写入|保存|更新|调整|优化|润色|修复|实现|重构|编辑|变更)/;
const READ_ONLY_RE = /(不要|别|无需|不需要).{0,10}(改|修改|写|动|保存|执行|代码|文件)|只(查看|看|读|说明|告诉|列出|检查|分析)|不改(代码|文件)|不要改(代码|文件)/;
const APPROVAL_RE = /^(确认|确认执行|可以|可以执行|同意|执行|改吧|没问题|ok|okay|yes|y|行)$/i;
const CANCEL_RE = /^(取消|放弃|不要|不用|算了|先不改|不执行|no|n)$/i;

export async function startChannel(deps) {
  const { cfg, agent, sessions, workspaces, controls } = deps;
  const activeRuns = new ActiveRuns();
  const media = new MediaCache(null);
  const pool = new ProcessPool(() => controls.cfg.preferences.maxConcurrentRuns);
  const pendingEdits = new Map();
  const pending = new PendingQueue(DEBOUNCE_MS, async (scope, batch) => {
    pending.block(scope);
    const release = await pool.acquire();
    try {
      await runAgentBatch({ channel, agent, sessions, workspaces, activeRuns, media, pendingEdits, batch, controls, scope });
    } catch (err) {
      await logEvent("batch.error", { message: err?.message || String(err), scope });
    } finally {
      release();
      pending.unblock(scope);
    }
  });

  const channel = createLarkChannel({
    appId: cfg.accounts.app.id,
    appSecret: cfg.accounts.app.secret,
    domain: cfg.accounts.app.tenant === "lark" ? Domain.Lark : Domain.Feishu,
    source: "feishu-codex-bridge",
    loggerLevel: LoggerLevel.info,
    policy: {
      dmMode: "open",
      requireMention: false,
      respondToMentionAll: Boolean(cfg.preferences.respondToMentionAll)
    },
    safety: { chatQueue: { enabled: false } },
    outbound: { streamThrottleMs: 400 },
    includeRawEvent: true
  });
  media.channel = channel;

  channel.on({
    message: async (msg) => {
      await intakeMessage({ channel, agent, sessions, workspaces, activeRuns, pending, pendingEdits, pool, msg, controls }).catch((err) => {
        void logEvent("message.error", { message: err?.message || String(err), chatId: msg.chatId });
      });
    },
    cardAction: async (evt) => {
      const command = evt?.action?.value?.command || evt?.value?.command || evt?.raw?.action?.value?.command;
      if (!command) return;
      const msg = {
        chatId: evt.chatId,
        messageId: evt.messageId,
        senderId: evt.operator?.openId || evt.operatorId || evt.senderId || "",
        chatType: evt.chatType || "group",
        content: command,
        resources: [],
        mentionedBot: true
      };
      const scope = scopeFor(msg);
      await tryHandleCommand({ channel, msg, scope, sessions, workspaces, agent, activeRuns, controls, fromCardAction: true });
    },
    reconnecting: () => logEvent("ws.reconnecting"),
    reconnected: () => logEvent("ws.reconnected"),
    error: (err) => logEvent("ws.error", { message: err?.message || String(err) })
  });

  await channel.connect();
  await logEvent("ws.connected", { appId: cfg.accounts.app.id, processId: controls.processId });

  return {
    channel,
    activeRuns,
    async disconnect() {
      pending.cancelAll();
      pendingEdits.clear();
      await activeRuns.stopAll();
      await Promise.allSettled([sessions.flush(), workspaces.flush()]);
      await channel.disconnect();
    }
  };
}

async function intakeMessage(ctx) {
  const { msg, controls, activeRuns, pending, pendingEdits, pool } = ctx;
  const scope = scopeFor(msg);
  await logEvent("message.enter", {
    scope,
    chatId: msg.chatId,
    chatType: msg.chatType,
    senderId: msg.senderId,
    resources: msg.resources?.length || 0,
    preview: String(msg.content || "").slice(0, 120)
  });

  if (!isUserAllowed(controls.cfg, msg.senderId)) return;
  if (msg.chatType !== "p2p" && !isChatAllowed(controls.cfg, msg.chatId)) return;
  if (msg.chatType !== "p2p" && controls.cfg.preferences.requireMentionInGroup && !msg.mentionedBot) return;

  const handled = await tryHandleCommand({ ...ctx, scope });
  if (handled) {
    pending.cancel(scope);
    return;
  }

  const pendingEdit = pendingEdits.get(scope);
  if (pendingEdit) {
    if (isEditApproval(msg.content)) {
      pending.cancel(scope);
      pendingEdits.delete(scope);
      const release = await pool.acquire();
      try {
        await runApprovedEdit({ ...ctx, scope, pendingEdit, msg });
      } finally {
        release();
      }
      return;
    }
    if (isEditCancellation(msg.content)) {
      pending.cancel(scope);
      pendingEdits.delete(scope);
      await ctx.channel.send(msg.chatId, { markdown: "已取消这次待确认修改，没有改动文件。" }, { replyTo: msg.messageId });
      return;
    }
    await ctx.channel.send(msg.chatId, {
      markdown: "当前有一条待确认修改。请回复 `确认` 执行，或回复 `取消` 放弃。"
    }, { replyTo: msg.messageId });
    return;
  }

  if (isEditApproval(msg.content) || isEditCancellation(msg.content)) {
    await ctx.channel.send(msg.chatId, { markdown: "当前没有待确认修改。" }, { replyTo: msg.messageId });
    return;
  }

  const cwd = ctx.workspaces.cwdFor(scope) || ctx.controls.cfg.preferences.defaultCwd;
  const quickAnswer = await maybeAnswerQuickLocalQuestion({ prompt: msg.content, cwd });
  if (quickAnswer) {
    await ctx.channel.send(msg.chatId, { markdown: quickAnswer }, { replyTo: msg.messageId });
    await logEvent("quick.answer", { scope, cwd, preview: quickAnswer.slice(0, 120) });
    return;
  }

  const running = activeRuns.get(scope);
  if (running) {
    running.interrupted = true;
    void running.run.stop();
  }
  pending.push(scope, msg);
}

async function runAgentBatch({ channel, agent, sessions, workspaces, activeRuns, media, pendingEdits, batch, controls, scope }) {
  const first = batch[0];
  const last = batch[batch.length - 1];
  if (!first || !last) return;
  const resources = batch.flatMap((message) => (message.resources || []).map((resource) => ({ messageId: message.messageId, resource })));
  const attachments = await media.resolve(first.chatId, resources);
  const cwd = workspaces.cwdFor(scope) || controls.cfg.preferences.defaultCwd || homedir();
  await ensureDirectory(cwd);
  if (requiresEditConfirmation(batch.map((message) => message.content || "").join("\n\n"))) {
    await runEditProposal({ channel, agent, sessions, activeRuns, pendingEdits, batch, attachments, controls, scope, cwd, msg: last });
    return;
  }
  const sessionId = sessions.resumeFor(scope, cwd);
  const prompt = buildPrompt(batch, attachments);
  const images = attachments.filter((file) => file.kind === "image").map((file) => file.path);
  const run = agent.run({
    prompt,
    sessionId,
    cwd,
    images,
    stopGraceMs: controls.cfg.preferences.stopGraceMs
  });
  const handle = activeRuns.register(scope, run);
  const idleMinutes = sessions.getIdleTimeout(scope) ?? controls.cfg.preferences.idleTimeoutMinutes;
  const idleMs = idleMinutes > 0 ? idleMinutes * 60 * 1000 : 0;
  await replyWithRun({ channel, run, handle, sessions, scope, cwd, msg: last, cfg: controls.cfg, idleMs }).finally(() => {
    activeRuns.unregister(scope, run);
  });
}

async function runEditProposal({ channel, agent, sessions, activeRuns, pendingEdits, batch, attachments, controls, scope, cwd, msg }) {
  const prompt = buildProposalPrompt(batch, attachments);
  const images = attachments.filter((file) => file.kind === "image").map((file) => file.path);
  const run = agent.run({
    prompt,
    sessionId: "",
    cwd,
    images,
    sandbox: "read-only",
    stopGraceMs: controls.cfg.preferences.stopGraceMs
  });
  const handle = activeRuns.register(scope, run);
  const idleMs = idleMsFor(sessions, controls, scope);
  const state = await replyWithRun({
    channel,
    run,
    handle,
    sessions,
    scope,
    cwd,
    msg,
    cfg: controls.cfg,
    idleMs,
    saveSession: false,
    renderState: renderProposalState
  }).finally(() => {
    activeRuns.unregister(scope, run);
  });
  if (state.terminal === "done" && isConfirmableProposal(state.text)) {
    pendingEdits.set(scope, {
      cwd,
      images,
      proposal: state.text.trim(),
      userPrompt: batch.map((message) => message.content || "").filter(Boolean).join("\n\n")
    });
    await logEvent("edit.pending", { scope, cwd, preview: state.text.trim().slice(0, 160) });
  }
}

async function runApprovedEdit({ channel, agent, sessions, activeRuns, pendingEdit, controls, scope, msg }) {
  const cwd = pendingEdit.cwd;
  await ensureDirectory(cwd);
  const run = agent.run({
    prompt: buildApprovedPrompt(pendingEdit),
    sessionId: "",
    cwd,
    images: pendingEdit.images || [],
    stopGraceMs: controls.cfg.preferences.stopGraceMs
  });
  const handle = activeRuns.register(scope, run);
  const idleMs = idleMsFor(sessions, controls, scope);
  await replyWithRun({ channel, run, handle, sessions, scope, cwd, msg, cfg: controls.cfg, idleMs }).finally(() => {
    activeRuns.unregister(scope, run);
  });
}

async function replyWithRun({ channel, run, handle, sessions, scope, cwd, msg, cfg, idleMs, saveSession = true, renderState = (state) => state }) {
  const replyMode = cfg.preferences.replyMode;
  const showToolCalls = cfg.preferences.showToolCalls;
  let state = { ...initialRunState };
  let timer;
  let timedOut = false;

  const armIdle = () => {
    if (!idleMs) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      handle.interrupted = true;
      void run.stop();
    }, idleMs);
  };

  const drive = async (flush) => {
    armIdle();
    for await (const event of run.events) {
      if (timer) clearTimeout(timer);
      if (handle.interrupted) {
        state = reduceRunState(state, { type: timedOut ? "idle_timeout" : "interrupted", timeoutMs: idleMs });
        await flush(state);
        break;
      }
      state = reduceRunState(state, event);
      if (saveSession && state.sessionId) sessions.set(scope, state.sessionId, cwd);
      await flush(state);
      if (state.terminal !== "running") break;
      armIdle();
    }
    if (timer) clearTimeout(timer);
    if (state.terminal === "running") {
      state = reduceRunState(state, handle.interrupted ? { type: timedOut ? "idle_timeout" : "interrupted", timeoutMs: idleMs } : { type: "result", text: "", success: true });
      await flush(state);
    }
    await run.waitForExit();
  };

  const sendOpts = { replyTo: msg.messageId };
  if (replyMode === "card" && typeof channel.stream === "function") {
    await channel.stream(msg.chatId, {
      card: {
        initial: renderRunCard(state, { showToolCalls }),
        producer: async (ctrl) => {
          await drive((next) => ctrl.update(renderRunCard(renderState(next), { showToolCalls })));
        }
      }
    }, sendOpts);
  } else if (replyMode === "markdown" && typeof channel.stream === "function") {
    await channel.stream(msg.chatId, {
      markdown: async (ctrl) => {
        await drive((next) => ctrl.setContent(renderText(next, showToolCalls)));
      }
    }, sendOpts);
  } else {
    await drive(async () => {});
    await channel.send(msg.chatId, { markdown: renderText(state, showToolCalls) }, sendOpts);
  }
  return state;
}

function renderProposalState(state) {
  return state.terminal === "done" ? { ...state, terminal: "pending_confirmation" } : state;
}

export function buildPrompt(batch, attachments) {
  const lines = [];
  const first = batch[0];
  lines.push("<feishu_context>");
  lines.push(`chat_id: ${first.chatId}`);
  lines.push(`chat_type: ${first.chatType}`);
  lines.push(`sender_id: ${first.senderId}`);
  if (first.threadId) lines.push(`thread_id: ${first.threadId}`);
  lines.push("</feishu_context>");
  lines.push("");
  lines.push("<bridge_instructions>");
  lines.push(...BRIDGE_INSTRUCTIONS);
  lines.push("</bridge_instructions>");
  lines.push("");
  lines.push(batch.map((message) => message.content || "").filter(Boolean).join("\n\n"));
  if (attachments.length) {
    lines.push("");
    lines.push("附件（本地路径）：");
    for (const file of attachments) lines.push(`- ${file.path}${file.originalName ? ` (${file.originalName})` : ""} — ${file.kind}`);
  }
  return lines.join("\n");
}

export function buildProposalPrompt(batch, attachments) {
  const lines = [];
  const first = batch[0];
  lines.push("<feishu_context>");
  lines.push(`chat_id: ${first.chatId}`);
  lines.push(`chat_type: ${first.chatType}`);
  lines.push(`sender_id: ${first.senderId}`);
  if (first.threadId) lines.push(`thread_id: ${first.threadId}`);
  lines.push("</feishu_context>");
  lines.push("");
  lines.push("<bridge_instructions>");
  lines.push("你正在通过飞书机器人回复用户。");
  lines.push("这是修改前的确认阶段，必须只读检查，不要修改、创建、删除、格式化或保存任何文件。");
  lines.push("请先定位用户想改的内容，然后给出待确认修改建议。");
  lines.push("回复必须包含：文件、修改前、修改后，以及“确认后我再执行修改；回复 `确认` 执行，回复 `取消` 放弃。”");
  lines.push("如果无法确定原文或新文，请说明需要用户补充，不要猜测，也不要改文件。");
  lines.push("</bridge_instructions>");
  lines.push("");
  lines.push(batch.map((message) => message.content || "").filter(Boolean).join("\n\n"));
  if (attachments.length) {
    lines.push("");
    lines.push("附件（本地路径）：");
    for (const file of attachments) lines.push(`- ${file.path}${file.originalName ? ` (${file.originalName})` : ""} — ${file.kind}`);
  }
  return lines.join("\n");
}

export function buildApprovedPrompt(pendingEdit) {
  return [
    "<bridge_instructions>",
    "用户已经确认下面的修改建议。",
    "现在请只执行已确认的修改，不要额外改动其他内容。",
    "执行完成后，最终回复必须包含“已完成”，并再次列出文件、修改前、修改后。",
    "</bridge_instructions>",
    "",
    "用户原始请求：",
    pendingEdit.userPrompt,
    "",
    "已确认的修改建议：",
    pendingEdit.proposal
  ].join("\n");
}

export function requiresEditConfirmation(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (isEditApproval(value) || isEditCancellation(value)) return false;
  if (READ_ONLY_RE.test(value)) return false;
  return EDIT_INTENT_RE.test(value);
}

export function isEditApproval(text) {
  return APPROVAL_RE.test(String(text || "").trim());
}

export function isEditCancellation(text) {
  return CANCEL_RE.test(String(text || "").trim());
}

export function isConfirmableProposal(text) {
  const value = String(text || "");
  return value.includes("修改前") && value.includes("修改后");
}

function idleMsFor(sessions, controls, scope) {
  const idleMinutes = sessions.getIdleTimeout(scope) ?? controls.cfg.preferences.idleTimeoutMinutes;
  return idleMinutes > 0 ? idleMinutes * 60 * 1000 : 0;
}

function scopeFor(msg) {
  return msg.threadId ? `${msg.chatId}:${msg.threadId}` : msg.chatId;
}

async function ensureDirectory(path) {
  const st = await stat(path).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`Working directory does not exist: ${path}`);
}
