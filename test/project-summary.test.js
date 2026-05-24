import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { maybeAnswerQuickLocalQuestion, maybeAnswerQuickProjectQuestion } from "../src/quick/project-summary.js";

test("answers project summary questions from package metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quick-summary-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({
    name: "demo-bridge",
    description: "Bridge Feishu messages to Codex"
  }));

  const answer = await maybeAnswerQuickProjectQuestion({
    prompt: "一句话介绍这个项目",
    cwd: dir
  });

  assert.equal(answer, "demo-bridge 是一个Bridge Feishu messages to Codex。");
  await rm(dir, { recursive: true, force: true });
});

test("prefers Chinese README descriptions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quick-summary-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({
    name: "feishu-codex-bridge",
    description: "Bridge Feishu messages to Codex"
  }));
  await writeFile(join(dir, "README.zh.md"), [
    "# feishu-codex-bridge",
    "",
    "把飞书 / Lark 消息接到你本机的 Codex CLI。"
  ].join("\n"));

  const answer = await maybeAnswerQuickProjectQuestion({
    prompt: "一句话介绍这个项目",
    cwd: dir
  });

  assert.equal(answer, "feishu-codex-bridge 是一个把飞书 / Lark 消息接到你本机的 Codex CLI 的开源桥接工具。");
  await rm(dir, { recursive: true, force: true });
});

test("answers project summary wording from voice transcripts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quick-summary-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "feishu-codex-bridge" }));
  await writeFile(join(dir, "README.zh.md"), [
    "# feishu-codex-bridge",
    "",
    "把飞书 / Lark 消息接到你本机的 Codex CLI。"
  ].join("\n"));

  const answer = await maybeAnswerQuickLocalQuestion({
    prompt: "你一句话帮我总结一下这项目",
    cwd: dir
  });

  assert.match(answer, /feishu-codex-bridge/);
  assert.match(answer, /飞书/);
  await rm(dir, { recursive: true, force: true });
});

test("ignores non-summary prompts", async () => {
  const answer = await maybeAnswerQuickProjectQuestion({
    prompt: "帮我改代码",
    cwd: process.cwd()
  });
  assert.equal(answer, "");
});

test("quickly answers main files questions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quick-summary-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  await writeFile(join(dir, "README.zh.md"), "# demo\n");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  await writeFile(join(dir, "README.md"), "# demo\n");
  await writeFile(join(dir, "src-placeholder"), "x");

  const answer = await maybeAnswerQuickLocalQuestion({
    prompt: "请列出这个项目的3个主要文件，不要改代码",
    cwd: dir
  });

  assert.match(answer, /README\.zh\.md/);
  assert.match(answer, /package\.json/);
  await rm(dir, { recursive: true, force: true });
});

test("quickly answers capability questions", async () => {
  const answer = await maybeAnswerQuickLocalQuestion({
    prompt: "你好，你现在能做什么？",
    cwd: process.cwd()
  });

  assert.match(answer, /查看说明/);
  assert.match(answer, /修改前/);
  assert.match(answer, /确认/);
  assert.match(answer, /取消/);
});
