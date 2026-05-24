import { homedir } from "node:os";
import { isUserAllowed } from "../config/schema.js";
import { logEvent } from "../core/logger.js";

const SUPPORTED_FILE_TYPES = new Set(["doc", "docx", "sheet", "file"]);
const REPLY_MAX_CHARS = 2000;

export async function handleCommentMention({ channel, evt, agent, sessions, workspaces, controls }) {
  await logEvent("comment.enter", {
    doc: evt?.fileToken,
    fileType: evt?.fileType,
    commentId: evt?.commentId,
    replyId: evt?.replyId,
    mentionedBot: evt?.mentionedBot,
    sender: evt?.operator?.openId
  });

  if (!evt?.mentionedBot) {
    await logEvent("comment.skip", { reason: "not-mentioned" });
    return;
  }
  if (controls?.cfg && !isUserAllowed(controls.cfg, evt.operator?.openId || "")) {
    await logEvent("comment.skip", { reason: "user-not-allowed", sender: evt.operator?.openId || "" });
    return;
  }
  if (!SUPPORTED_FILE_TYPES.has(evt.fileType)) {
    await logEvent("comment.skip", { reason: "unsupported-fileType", fileType: evt.fileType });
    return;
  }

  const target = await resolveTarget(channel, evt);
  if (!target) {
    await logEvent("comment.skip", { reason: "unsupported-target" });
    return;
  }

  const context = await fetchCommentContext(channel, target, evt).catch(async (err) => {
    await logEvent("comment.context.error", { message: err?.message || String(err), code: feishuCode(err) });
    return null;
  });
  if (!context?.question) {
    await logEvent("comment.skip", { reason: "empty-question" });
    return;
  }

  const scope = `doc:${evt.fileToken}`;
  const cwd = workspaces.cwdFor(scope) || controls?.cfg?.preferences?.defaultCwd || homedir();
  const sessionId = sessions.resumeFor(scope, cwd);
  const prompt = buildCommentPrompt(target, context);
  const run = agent.run({
    prompt,
    sessionId,
    cwd,
    images: [],
    stopGraceMs: controls?.cfg?.preferences?.stopGraceMs
  });

  let answer = "";
  let errorMsg = "";
  for await (const event of run.events) {
    if (event.type === "text_delta") answer += event.text || "";
    if (event.type === "result" && event.text) answer = event.text;
    if (event.type === "system" && event.sessionId) sessions.set(scope, event.sessionId, cwd);
    if (event.type === "error") {
      errorMsg = event.message || "Codex 执行失败";
      break;
    }
  }
  await run.waitForExit().catch(() => ({ code: 1 }));

  let reply = stripMarkdown(answer.trim());
  if (errorMsg) reply = `Codex 报错：${errorMsg}`;
  if (!reply) reply = "（无回复内容）";
  if (reply.length > REPLY_MAX_CHARS) reply = `${reply.slice(0, REPLY_MAX_CHARS - 1)}…`;

  await postCommentReply(channel, target, evt, reply);
}

async function resolveTarget(channel, evt) {
  const passthrough = {
    fileToken: evt.fileToken,
    fileType: evt.fileType
  };
  if (!SUPPORTED_FILE_TYPES.has(evt.fileType)) return null;

  try {
    const response = await channel.rawClient.wiki.v2.space.getNode({
      params: { token: evt.fileToken }
    });
    const node = response?.data?.node;
    if (node?.obj_token && SUPPORTED_FILE_TYPES.has(node.obj_type)) {
      await logEvent("comment.wiki.resolved", { objToken: node.obj_token, objType: node.obj_type });
      return {
        fileToken: node.obj_token,
        fileType: node.obj_type
      };
    }
  } catch {
    // Most document comment tokens are not wiki node tokens. Pass through.
  }
  return passthrough;
}

async function fetchCommentContext(channel, target, evt) {
  let replies = [];
  let quote = "";
  let isWhole = false;
  try {
    const response = await channel.rawClient.drive.v1.fileComment.get({
      params: { file_type: target.fileType },
      path: { file_token: target.fileToken, comment_id: evt.commentId }
    });
    replies = response?.data?.reply_list?.replies || [];
    quote = response?.data?.quote || "";
    isWhole = Boolean(response?.data?.is_whole);
  } catch (err) {
    await logEvent("comment.get.fallback", { code: feishuCode(err) });
    const found = await findCommentViaList(channel, target, evt.commentId);
    replies = found?.reply_list?.replies || [];
    quote = found?.quote || "";
    isWhole = Boolean(found?.is_whole);
  }

  const targetReply = (evt.replyId ? replies.find((reply) => reply.reply_id === evt.replyId) : null) || replies.at(-1);
  const question = (targetReply?.content?.elements || [])
    .map((element) => {
      if (element.type === "text_run") return element.text_run?.text || "";
      if (element.type === "docs_link") return element.docs_link?.url || "";
      return "";
    })
    .join("")
    .trim();

  return { question, quote, isWhole };
}

async function findCommentViaList(channel, target, commentId) {
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const response = await channel.rawClient.drive.v1.fileComment.list({
      params: {
        file_type: target.fileType,
        page_size: 100,
        ...(pageToken ? { page_token: pageToken } : {})
      },
      path: { file_token: target.fileToken }
    });
    const items = response?.data?.items || [];
    const hit = items.find((item) => item.comment_id === commentId);
    if (hit) return hit;
    if (!response?.data?.has_more || !response.data.page_token) break;
    pageToken = response.data.page_token;
  }
  return null;
}

export function buildCommentPrompt(target, context) {
  const docUrl = `https://feishu.cn/${target.fileType}/${target.fileToken}`;
  const parts = [
    "我在飞书云文档里被 @ 了。文档信息：",
    `- 链接：${docUrl}`,
    `- file_token：${target.fileToken}`,
    `- 类型：${target.fileType}`,
    `- 评论范围：${context.isWhole ? "全文评论" : "行内评论"}`
  ];
  if (context.quote) {
    parts.push("", `用户选中的原文：\n> ${context.quote.replace(/\n/g, "\n> ")}`);
  }
  parts.push(
    "",
    `用户的问题：${context.question}`,
    "",
    "需要读文档内容时，可以用 lark-cli：",
    `  \`lark-cli docs +fetch --doc ${target.fileToken}\``,
    "",
    "回复要求：直接用纯文本，不要 markdown，不要代码块。"
  );
  return parts.join("\n");
}

export function stripMarkdown(value) {
  return String(value || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, "$1")
    .replace(/(?<![_\w])_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/```/g, "");
}

async function postCommentReply(channel, target, evt, text) {
  const url = `/open-apis/drive/v1/files/${encodeURIComponent(target.fileToken)}/comments/${encodeURIComponent(evt.commentId)}/replies?file_type=${encodeURIComponent(target.fileType)}`;
  try {
    await channel.rawClient.request({
      method: "POST",
      url,
      data: { content: { elements: [{ type: "text_run", text_run: { text } }] } }
    });
    await logEvent("comment.replied", { mode: "in-thread" });
    return;
  } catch (err) {
    if (feishuCode(err) !== 1069302) throw err;
    await logEvent("comment.reply.fallback", { code: 1069302 });
  }

  await channel.rawClient.drive.v1.fileComment.create({
    params: { file_type: target.fileType },
    path: { file_token: target.fileToken },
    data: {
      reply_list: {
        replies: [{ content: { elements: [{ type: "text_run", text_run: { text } }] } }]
      }
    }
  });
  await logEvent("comment.replied", { mode: "new-top-level" });
}

function feishuCode(err) {
  return err?.response?.data?.code || err?.code;
}
