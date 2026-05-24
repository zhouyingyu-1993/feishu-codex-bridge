import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyConfirmedEdit,
  buildApprovedPrompt,
  buildPrompt,
  buildProposalPrompt,
  buildUserText,
  isConfirmableProposal,
  isEditApproval,
  isEditCancellation,
  parseConfirmedEditProposal,
  requiresEditConfirmation
} from "../src/bot/channel.js";

test("adds bridge instructions for concise final replies", () => {
  const prompt = buildPrompt([
    {
      chatId: "chat",
      chatType: "p2p",
      senderId: "user",
      content: "请改 README.zh.md",
      resources: []
    }
  ], []);

  assert.match(prompt, /<bridge_instructions>/);
  assert.match(prompt, /最终回复要简短说明结果/);
  assert.match(prompt, /已完成/);
  assert.match(prompt, /不要用“我先”“接下来”“将会”/);
});

test("detects edit requests that need confirmation", () => {
  assert.equal(requiresEditConfirmation("请把 README.zh.md 这句话改自然一点"), true);
  assert.equal(requiresEditConfirmation("请只查看 README.zh.md，不要改代码"), false);
  assert.equal(requiresEditConfirmation("确认"), false);
});

test("recognizes approval and cancellation replies", () => {
  assert.equal(isEditApproval("确认"), true);
  assert.equal(isEditApproval("可以执行"), true);
  assert.equal(isEditCancellation("取消"), true);
  assert.equal(isEditCancellation("不执行"), true);
});

test("builds read-only proposal prompt with before/after confirmation rules", () => {
  const prompt = buildProposalPrompt([
    {
      chatId: "chat",
      chatType: "p2p",
      senderId: "user",
      content: "请改 README.zh.md",
      resources: []
    }
  ], []);

  assert.match(prompt, /必须只读检查/);
  assert.match(prompt, /不要修改、创建、删除、格式化或保存任何文件/);
  assert.match(prompt, /修改前/);
  assert.match(prompt, /修改后/);
  assert.match(prompt, /回复 `确认` 执行/);
});

test("builds approved prompt that applies only confirmed changes", () => {
  const prompt = buildApprovedPrompt({
    userPrompt: "请改 README.zh.md",
    proposal: "文件：README.zh.md\n修改前：旧句子\n修改后：新句子"
  });

  assert.match(prompt, /用户已经确认/);
  assert.match(prompt, /只执行已确认的修改/);
  assert.match(prompt, /旧句子/);
  assert.match(prompt, /新句子/);
});

test("includes audio transcript in user text and prompt", () => {
  const batch = [{
    chatId: "chat",
    chatType: "p2p",
    senderId: "user",
    content: "[语音]",
    resources: []
  }];
  const attachments = [{
    path: "/tmp/audio.ogg",
    kind: "audio",
    originalName: "",
    transcript: "请一句话介绍这个项目"
  }];

  assert.equal(buildUserText(batch, attachments), "音频转写：请一句话介绍这个项目");
  const prompt = buildPrompt(batch, attachments);
  assert.match(prompt, /音频转写：请一句话介绍这个项目/);
  assert.match(prompt, /audio\.ogg.*audio.*已转写/);
});

test("requires before and after text for confirmable proposals", () => {
  assert.equal(isConfirmableProposal("修改前：旧\n修改后：新"), true);
  assert.equal(isConfirmableProposal("需要用户补充信息"), false);
});

test("parses confirmed edit proposals", () => {
  const parsed = parseConfirmedEditProposal([
    "文件：README.zh.md",
    "",
    "修改前：",
    "`旧句子`",
    "",
    "修改后：",
    "`新句子`",
    "",
    "确认后我再执行修改；回复 `确认` 执行。"
  ].join("\n"), "/tmp/project");

  assert.equal(parsed.file, "/tmp/project/README.zh.md");
  assert.equal(parsed.relativeFile, "README.zh.md");
  assert.equal(parsed.before, "旧句子");
  assert.equal(parsed.after, "新句子");
});

test("prefers file paths from the original user prompt", () => {
  const parsed = parseConfirmedEditProposal([
    "文件：README.zh",
    "",
    "修改前：`旧句子`",
    "",
    "修改后：`新句子`"
  ].join("\n"), "/tmp/project", "请把 README.zh.md 里这句话改一下");

  assert.equal(parsed.file, "/tmp/project/README.zh.md");
  assert.equal(parsed.relativeFile, "README.zh.md");
});

test("parses proposal sections without colons", () => {
  const parsed = parseConfirmedEditProposal([
    "文件：README.zh.md",
    "",
    "修改前",
    "- 旧句子",
    "",
    "修改后",
    "- 新句子",
    "",
    "确认后我再执行修改；回复 `确认` 执行。"
  ].join("\n"), "/tmp/project");

  assert.equal(parsed.file, "/tmp/project/README.zh.md");
  assert.equal(parsed.before, "- 旧句子");
  assert.equal(parsed.after, "- 新句子");
});

test("applies confirmed edits by exact replacement", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "feishu-bridge-test-"));
  const file = join(cwd, "README.zh.md");
  await writeFile(file, "第一句\n旧句子\n第三句\n", "utf8");

  const result = await applyConfirmedEdit({
    cwd,
    proposal: "文件：README.zh.md\n\n修改前：`旧句子`\n\n修改后：`新句子`"
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /已完成/);
  assert.equal(await readFile(file, "utf8"), "第一句\n新句子\n第三句\n");
});

test("does not apply ambiguous confirmed edits", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "feishu-bridge-test-"));
  const file = join(cwd, "README.zh.md");
  await writeFile(file, "旧句子\n旧句子\n", "utf8");

  const result = await applyConfirmedEdit({
    cwd,
    proposal: "文件：README.zh.md\n\n修改前：`旧句子`\n\n修改后：`新句子`"
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /出现了 2 次/);
  assert.equal(await readFile(file, "utf8"), "旧句子\n旧句子\n");
});
