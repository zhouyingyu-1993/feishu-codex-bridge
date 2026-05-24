import { logEvent } from "../core/logger.js";

const MAX_BLOCKS_PER_REQUEST = 50;
const DEFAULT_DOC_TITLE = "Codex 生成的飞书文档";

export function isCloudDocumentRequest(prompt) {
  const text = String(prompt || "");
  if (!/(飞书|Lark|云文档|文档|知识库|知识空间)/i.test(text)) return false;
  return /(新建|创建|生成|写一篇|写一份|写个|转发|发到.*群|本群|子文档)/.test(text);
}

export async function runCloudDocumentRequest({ channel, agent, sessions, workspaces, activeRuns, controls, scope, msg, cwd, userText }) {
  await channel.send(msg.chatId, {
    markdown: "收到，我会先生成正文，再创建飞书云文档；创建成功后把链接发到当前会话。"
  }, { replyTo: msg.messageId });

  const draft = await draftDocument({ agent, activeRuns, controls, scope, cwd, userText });
  if (!draft.ok) {
    await channel.send(msg.chatId, { markdown: draft.message }, { replyTo: msg.messageId });
    return;
  }

  const parentTitle = extractParentTitle(userText);
  const title = deriveDocumentTitle(userText, draft.text);
  const created = await createCloudDocument(channel, {
    title,
    content: draft.text,
    parentTitle
  }).catch((err) => ({
    ok: false,
    message: formatCloudDocError(err, parentTitle)
  }));

  if (!created.ok) {
    await channel.send(msg.chatId, { markdown: created.message }, { replyTo: msg.messageId });
    return;
  }

  await channel.send(msg.chatId, {
    markdown: [
      "已创建飞书云文档，并把链接发到当前会话：",
      "",
      `[${created.title}](${created.url})`,
      "",
      created.parentTitle ? `位置：${created.parentTitle} 下` : "位置：新建独立文档"
    ].join("\n")
  }, { replyTo: msg.messageId });
}

async function draftDocument({ agent, activeRuns, controls, scope, cwd, userText }) {
  const run = agent.run({
    prompt: buildDraftPrompt(userText),
    sessionId: "",
    cwd,
    images: [],
    sandbox: "read-only",
    stopGraceMs: controls.cfg.preferences.stopGraceMs
  });
  const handle = activeRuns.register(scope, run);
  const idleMs = Number(controls.cfg.preferences.idleTimeoutMinutes || 0) > 0
    ? Number(controls.cfg.preferences.idleTimeoutMinutes) * 60 * 1000
    : 0;

  try {
    return await collectAgentText(run, handle, idleMs);
  } finally {
    activeRuns.unregister(scope, run);
  }
}

function buildDraftPrompt(userText) {
  return [
    "你正在为飞书云文档生成正文。",
    "只输出可直接写入文档的 Markdown 正文，不要解释过程，不要修改本地文件，不要调用外部工具。",
    "正文要有清晰标题和小标题，适合直接发布到飞书群。",
    "",
    "用户需求：",
    userText
  ].join("\n");
}

async function collectAgentText(run, handle, idleMs) {
  let text = "";
  let error = "";
  let timedOut = false;
  let timer;
  const arm = () => {
    if (!idleMs) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      handle.interrupted = true;
      void run.stop();
    }, idleMs);
  };

  arm();
  for await (const event of run.events) {
    if (timer) clearTimeout(timer);
    if (handle.interrupted) break;
    if (event.type === "text_delta") text += event.text || "";
    if (event.type === "result" && event.text) text = event.text;
    if (event.type === "error") {
      error = event.message || "Codex 执行失败";
      break;
    }
    arm();
  }
  if (timer) clearTimeout(timer);
  await run.waitForExit().catch(() => ({ code: 1 }));

  if (timedOut) {
    return { ok: false, message: `已因超时自动停止：Codex 连续 ${formatDuration(idleMs)} 没有输出。没有创建飞书文档。` };
  }
  if (handle.interrupted) return { ok: false, message: "已停止这次云文档生成，没有创建飞书文档。" };
  if (error) return { ok: false, message: `Codex 报错：${error}。没有创建飞书文档。` };
  if (!text.trim()) return { ok: false, message: "Codex 没有返回正文，没有创建飞书文档。" };
  return { ok: true, text: text.trim() };
}

async function createCloudDocument(channel, { title, content, parentTitle }) {
  const target = parentTitle ? await findParentTarget(channel, parentTitle) : null;
  if (parentTitle && !target) {
    throw new Error(`没有找到名为“${parentTitle}”的飞书文档或知识库节点`);
  }

  let documentId = "";
  let url = "";
  if (target?.kind === "wiki") {
    const created = await channel.rawClient.wiki.v2.spaceNode.create({
      path: { space_id: target.spaceId },
      data: {
        obj_type: "docx",
        node_type: "origin",
        parent_node_token: target.nodeToken,
        title
      }
    });
    const node = created?.data?.node;
    documentId = node?.obj_token || "";
    url = node?.url || "";
  } else {
    const created = await channel.rawClient.docx.v1.document.create({
      data: {
        title,
        ...(target?.kind === "folder" ? { folder_token: target.folderToken } : {})
      }
    });
    documentId = created?.data?.document?.document_id || "";
  }

  if (!documentId) throw new Error("飞书没有返回新文档 ID");
  await appendMarkdownBlocks(channel, documentId, content);
  await makeTenantReadable(channel, documentId);

  return {
    ok: true,
    title,
    documentId,
    parentTitle: parentTitle || "",
    url: url || `https://feishu.cn/docx/${documentId}`
  };
}

async function findParentTarget(channel, parentTitle) {
  const result = await channel.rawClient.search.v2.docWiki.search({
    data: {
      query: parentTitle,
      doc_filter: {
        only_title: true,
        doc_types: ["WIKI", "DOCX", "DOC", "FOLDER", "CATALOG"]
      },
      wiki_filter: {
        only_title: true,
        doc_types: ["WIKI", "DOCX", "DOC", "CATALOG"]
      },
      page_size: 10
    }
  });
  const units = result?.data?.res_units || [];
  const exact = units.find((item) => cleanTitle(item.title_highlighted) === parentTitle);
  const hit = exact || units.find((item) => cleanTitle(item.title_highlighted).includes(parentTitle));
  const meta = hit?.result_meta;
  if (!meta?.token) return null;

  if (hit.entity_type === "WIKI" || meta.doc_types === "WIKI" || /\/wiki\//.test(meta.url || "")) {
    const nodeResponse = await channel.rawClient.wiki.v2.space.getNode({
      params: { token: meta.token }
    });
    const node = nodeResponse?.data?.node;
    if (!node?.space_id || !node?.node_token) return null;
    return { kind: "wiki", spaceId: node.space_id, nodeToken: node.node_token };
  }

  if (meta.doc_types === "FOLDER" || meta.file_type === "folder") {
    return { kind: "folder", folderToken: meta.token };
  }
  if (meta.doc_types === "DOCX" || meta.doc_types === "DOC") {
    throw new Error(`找到了“${parentTitle}”，但它是普通文档，不是知识库节点或文件夹；飞书 API 不能直接在普通文档下创建子文档`);
  }
  return null;
}

async function appendMarkdownBlocks(channel, documentId, markdown) {
  const blocks = markdownToBlocks(markdown);
  if (!blocks.length) return;
  for (let index = 0; index < blocks.length; index += MAX_BLOCKS_PER_REQUEST) {
    const children = blocks.slice(index, index + MAX_BLOCKS_PER_REQUEST);
    await channel.rawClient.docx.v1.documentBlockChildren.create({
      path: { document_id: documentId, block_id: documentId },
      data: { index: -1, children }
    });
    if (index + MAX_BLOCKS_PER_REQUEST < blocks.length) await delay(400);
  }
}

async function makeTenantReadable(channel, documentId) {
  await channel.rawClient.drive.v2.permissionPublic.patch({
    path: { token: documentId },
    params: { type: "docx" },
    data: {
      link_share_entity: "tenant_readable",
      share_entity: "same_tenant"
    }
  }).catch((err) => logEvent("cloud-doc.permission.warn", { message: err?.message || String(err) }));
}

export function markdownToBlocks(markdown) {
  const blocks = [];
  const paragraph = [];
  const flush = () => {
    const text = paragraph.join("\n").trim();
    paragraph.length = 0;
    if (text) blocks.push(textBlock(text));
  };

  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const h1 = line.match(/^#\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);
    const bullet = line.match(/^[-*]\s+(.+)/);
    const ordered = line.match(/^\d+[.、]\s+(.+)/);
    if (h1 || h2 || h3 || bullet || ordered) flush();
    if (h1) blocks.push(richTextBlock(3, "heading1", h1[1]));
    else if (h2) blocks.push(richTextBlock(4, "heading2", h2[1]));
    else if (h3) blocks.push(richTextBlock(5, "heading3", h3[1]));
    else if (bullet) blocks.push(richTextBlock(12, "bullet", bullet[1]));
    else if (ordered) blocks.push(richTextBlock(13, "ordered", ordered[1]));
    else paragraph.push(rawLine);
  }
  flush();
  return blocks;
}

function textBlock(content) {
  return richTextBlock(2, "text", content);
}

function richTextBlock(blockType, key, content) {
  return {
    block_type: blockType,
    [key]: {
      elements: [{ text_run: { content: String(content || "").trim() } }]
    }
  };
}

export function extractParentTitle(prompt) {
  const text = String(prompt || "");
  return text.match(/在[【「《](.+?)[】」》]/)?.[1]?.trim()
    || text.match(/在\s*([^，,。.\n]{1,40}?)(?:这个|这篇)?(?:文档|云文档|知识库|知识空间)(?:下|里)/)?.[1]?.trim()
    || "";
}

export function deriveDocumentTitle(prompt, markdown) {
  const heading = String(markdown || "").match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return cleanTitle(heading).slice(0, 80) || DEFAULT_DOC_TITLE;
  const requested = String(prompt || "").match(/写(?:一篇|一份|个)?([^。\n，,]{4,60})/)?.[1]?.trim();
  return requested ? cleanTitle(requested).slice(0, 80) : DEFAULT_DOC_TITLE;
}

function cleanTitle(title) {
  return String(title || "")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_#]/g, "")
    .trim();
}

function formatCloudDocError(err, parentTitle) {
  const detail = err?.message || String(err);
  const parentHint = parentTitle
    ? `我没有成功在“${parentTitle}”下创建子文档。请确认机器人有这个文档/知识库的访问和编辑权限，或者直接发文档链接/节点 token 给我。`
    : "我没有成功创建飞书云文档。请确认应用已开通云文档创建、编辑和搜索权限。";
  return `${parentHint}\n\n错误：${detail}\n\n我没有发送完成消息；如果飞书里已经出现未写完的空文档，请把链接发给我，我再继续处理。`;
}

function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes && seconds) return `${minutes} 分 ${seconds} 秒`;
  if (minutes) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
