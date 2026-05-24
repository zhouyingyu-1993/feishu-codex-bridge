import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function maybeAnswerQuickLocalQuestion({ prompt, cwd }) {
  const summary = await maybeAnswerQuickProjectQuestion({ prompt, cwd });
  if (summary) return summary;

  const text = String(prompt || "").trim();
  if (isCapabilityQuestion(text)) return answerCapabilities();
  if (isMainFilesQuestion(text)) return answerMainFiles(cwd);
  if (isScriptsQuestion(text)) return answerScripts(cwd);
  if (isProjectTreeQuestion(text)) return answerProjectTree(cwd);
  return "";
}

export async function maybeAnswerQuickProjectQuestion({ prompt, cwd }) {
  const text = String(prompt || "").trim();
  if (!isProjectSummaryQuestion(text)) return "";

  const [pkg, readme] = await Promise.all([readPackage(cwd), readReadme(cwd)]);
  const name = pkg.name || firstHeading(readme) || "这个项目";
  const description = chineseDescription(readme) || firstMeaningfulLine(readme) || pkg.description;

  if (description) return `${name} 是一个${cleanDescription(description)}。`;
  return `${name} 是当前工作目录里的开源项目。`;
}

async function answerMainFiles(cwd) {
  const pkg = await readPackage(cwd);
  const candidates = [
    ["README.zh.md", "中文说明和使用入口"],
    ["package.json", "npm 包信息、命令和依赖配置"],
    ["src/bot/channel.js", "飞书消息接收、快速回复和 Codex 调用调度"],
    ["src/agent/codex.js", "本地 Codex CLI 适配器"],
    ["src/commands/index.js", "飞书斜杠命令处理"],
    ["src/quick/project-summary.js", "快速本地问答通道"]
  ];
  const existing = [];
  for (const [file, desc] of candidates) {
    if (await exists(join(cwd, file))) existing.push(`- \`${file}\`：${desc}`);
    if (existing.length >= 3) break;
  }
  if (!existing.length) return "";
  const name = pkg.name || "这个项目";
  return `${name} 的 3 个主要文件是：\n${existing.join("\n")}`;
}

async function answerScripts(cwd) {
  const pkg = await readPackage(cwd);
  const scripts = pkg.scripts || {};
  const entries = Object.entries(scripts);
  if (!entries.length) return "";
  return [
    "这个项目的常用 npm 命令是：",
    ...entries.slice(0, 6).map(([name, command]) => `- \`npm run ${name}\`：\`${command}\``)
  ].join("\n");
}

async function answerProjectTree(cwd) {
  const names = await readdir(cwd).catch(() => []);
  const visible = names
    .filter((name) => !name.startsWith(".") && !["node_modules", "dist", "coverage"].includes(name))
    .sort()
    .slice(0, 16);
  if (!visible.length) return "";
  return `当前项目顶层结构：\n${visible.map((name) => `- \`${name}\``).join("\n")}`;
}

function answerCapabilities() {
  return [
    "我可以帮你在当前项目里查看说明、梳理文件、分析报错、运行检查和整理修改建议，也可以处理飞书云文档评论里的 @ 回复。",
    "如果你让我创建飞书云文档，我会尝试通过飞书 API 新建文档并把链接发回当前会话；失败时会明确说明原因。",
    "如果你要改文件，我会先列出“修改前”和“修改后”，等你回复 `确认` 后才真正执行；回复 `取消` 就放弃。"
  ].join("\n");
}

function isCapabilityQuestion(text) {
  return [
    /^(你好|您好|hi|hello)[，,\s]*(你)?(现在)?(能|可以).*(做什么|干什么|帮.*什么)/i,
    /^(你)?(现在)?(能|可以).*(做什么|干什么|帮.*什么)/,
    /(介绍|说说).*(能力|功能)/,
    /help me|what can you do/i
  ].some((pattern) => pattern.test(text));
}

function isProjectSummaryQuestion(text) {
  return [
    /一句话.*(介绍|说明).*项目/,
    /这个项目.*(做什么|是什么|介绍)/,
    /项目.*(做什么|是什么)/,
    /what.*(project|repo).*do/i,
    /summari[sz]e.*(project|repo)/i
  ].some((pattern) => pattern.test(text));
}

function isMainFilesQuestion(text) {
  return [
    /(列出|看看|查看|说说).*(\d+|三|3).*主要文件/,
    /(主要|核心|关键).*(文件|模块)/,
    /main files/i,
    /important files/i
  ].some((pattern) => pattern.test(text));
}

function isScriptsQuestion(text) {
  return [
    /(怎么|如何).*(运行|启动|测试|检查)/,
    /(有哪些|列出).*(命令|脚本|scripts)/,
    /npm scripts/i
  ].some((pattern) => pattern.test(text));
}

function isProjectTreeQuestion(text) {
  return [
    /(项目|目录).*(结构|文件树)/,
    /(列出|看看|查看).*目录/,
    /project tree/i
  ].some((pattern) => pattern.test(text));
}

async function readPackage(cwd) {
  try {
    return JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

async function readReadme(cwd) {
  for (const name of ["README.zh.md", "README.md", "readme.md"]) {
    try {
      return await readFile(join(cwd, name), "utf8");
    } catch {
      // Try the next common README name.
    }
  }
  return "";
}

function firstHeading(readme) {
  const match = readme.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function firstMeaningfulLine(readme) {
  return readme
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("[!") && !line.startsWith("```"));
}

function chineseDescription(readme) {
  const lines = readme.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line = lines.find((item) => item.includes("飞书") && item.includes("Codex") && !item.startsWith("#"));
  return line || "";
}

function cleanDescription(description) {
  return String(description)
    .replace(/^一个/, "")
    .replace(/^把/, "把")
    .replace(/^a\s+/i, "")
    .replace(/[。.]$/, "")
    .replace(/CLI$/i, "CLI 的开源桥接工具")
    .replace(/[。.]$/, "");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
