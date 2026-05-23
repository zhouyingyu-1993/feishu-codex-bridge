import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function maybeAnswerQuickProjectQuestion({ prompt, cwd }) {
  const text = String(prompt || "").trim();
  if (!isProjectSummaryQuestion(text)) return "";

  const [pkg, readme] = await Promise.all([readPackage(cwd), readReadme(cwd)]);
  const name = pkg.name || firstHeading(readme) || "这个项目";
  const description = chineseDescription(readme) || firstMeaningfulLine(readme) || pkg.description;

  if (description) return `${name} 是一个${cleanDescription(description)}。`;
  return `${name} 是当前工作目录里的开源项目。`;
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
