import assert from "node:assert/strict";
import test from "node:test";
import {
  buildApprovedPrompt,
  buildPrompt,
  buildProposalPrompt,
  isConfirmableProposal,
  isEditApproval,
  isEditCancellation,
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

test("requires before and after text for confirmable proposals", () => {
  assert.equal(isConfirmableProposal("修改前：旧\n修改后：新"), true);
  assert.equal(isConfirmableProposal("需要用户补充信息"), false);
});
