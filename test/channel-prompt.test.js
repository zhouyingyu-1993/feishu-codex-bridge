import assert from "node:assert/strict";
import test from "node:test";
import { buildPrompt } from "../src/bot/channel.js";

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
