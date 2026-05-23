import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import { Domain, LoggerLevel, createLarkChannel } from "@larksuiteoapi/node-sdk";
import { isChatAllowed, isUserAllowed } from "../config/schema.js";
import { reduceRunState, initialRunState } from "../agent/events.js";
import { renderRunCard, renderText } from "../card/render.js";
import { logEvent } from "../core/logger.js";
import { MediaCache } from "../media/cache.js";
import { tryHandleCommand } from "../commands/index.js";
import { ActiveRuns } from "./active-runs.js";
import { PendingQueue } from "./pending-queue.js";
import { ProcessPool } from "./process-pool.js";

const DEBOUNCE_MS = 600;

export async function startChannel(deps) {
  const { cfg, agent, sessions, workspaces, controls } = deps;
  const activeRuns = new ActiveRuns();
  const media = new MediaCache(null);
  const pool = new ProcessPool(() => controls.cfg.preferences.maxConcurrentRuns);
  const pending = new PendingQueue(DEBOUNCE_MS, async (scope, batch) => {
    pending.block(scope);
    const release = await pool.acquire();
    try {
      await runAgentBatch({ channel, agent, sessions, workspaces, activeRuns, media, batch, controls, scope });
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
      await intakeMessage({ channel, agent, sessions, workspaces, activeRuns, pending, msg, controls }).catch((err) => {
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
      await activeRuns.stopAll();
      await Promise.allSettled([sessions.flush(), workspaces.flush()]);
      await channel.disconnect();
    }
  };
}

async function intakeMessage(ctx) {
  const { msg, controls, activeRuns, pending } = ctx;
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

  const running = activeRuns.get(scope);
  if (running) {
    running.interrupted = true;
    void running.run.stop();
  }
  pending.push(scope, msg);
}

async function runAgentBatch({ channel, agent, sessions, workspaces, activeRuns, media, batch, controls, scope }) {
  const first = batch[0];
  const last = batch[batch.length - 1];
  if (!first || !last) return;
  const resources = batch.flatMap((message) => (message.resources || []).map((resource) => ({ messageId: message.messageId, resource })));
  const attachments = await media.resolve(first.chatId, resources);
  const cwd = workspaces.cwdFor(scope) || controls.cfg.preferences.defaultCwd || homedir();
  await ensureDirectory(cwd);
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

async function replyWithRun({ channel, run, handle, sessions, scope, cwd, msg, cfg, idleMs }) {
  const replyMode = cfg.preferences.replyMode;
  const showToolCalls = cfg.preferences.showToolCalls;
  let state = { ...initialRunState };
  let timer;

  const armIdle = () => {
    if (!idleMs) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      handle.interrupted = true;
      void run.stop();
    }, idleMs);
  };

  const drive = async (flush) => {
    armIdle();
    for await (const event of run.events) {
      if (timer) clearTimeout(timer);
      if (handle.interrupted) {
        state = reduceRunState(state, { type: "interrupted" });
        await flush(state);
        break;
      }
      state = reduceRunState(state, event);
      if (state.sessionId) sessions.set(scope, state.sessionId, cwd);
      await flush(state);
      if (state.terminal !== "running") break;
      armIdle();
    }
    if (timer) clearTimeout(timer);
    if (state.terminal === "running") {
      state = reduceRunState(state, handle.interrupted ? { type: "interrupted" } : { type: "result", text: "", success: true });
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
          await drive((next) => ctrl.update(renderRunCard(next, { showToolCalls })));
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
}

function buildPrompt(batch, attachments) {
  const lines = [];
  const first = batch[0];
  lines.push("<feishu_context>");
  lines.push(`chat_id: ${first.chatId}`);
  lines.push(`chat_type: ${first.chatType}`);
  lines.push(`sender_id: ${first.senderId}`);
  if (first.threadId) lines.push(`thread_id: ${first.threadId}`);
  lines.push("</feishu_context>");
  lines.push("");
  lines.push(batch.map((message) => message.content || "").filter(Boolean).join("\n\n"));
  if (attachments.length) {
    lines.push("");
    lines.push("附件（本地路径）：");
    for (const file of attachments) lines.push(`- ${file.path}${file.originalName ? ` (${file.originalName})` : ""} — ${file.kind}`);
  }
  return lines.join("\n");
}

function scopeFor(msg) {
  return msg.threadId ? `${msg.chatId}:${msg.threadId}` : msg.chatId;
}

async function ensureDirectory(path) {
  const st = await stat(path).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`Working directory does not exist: ${path}`);
}
