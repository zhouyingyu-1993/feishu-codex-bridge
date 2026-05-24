import assert from "node:assert/strict";
import test from "node:test";
import { renderRunCard } from "../src/card/render.js";

test("renders pending confirmation as a waiting state", () => {
  const card = renderRunCard({
    terminal: "pending_confirmation",
    footer: "done",
    text: "文件：README.zh.md\n\n修改前：旧\n\n修改后：新",
    tools: [],
    sessionId: "",
    timeoutMs: 0
  });

  assert.equal(card.header.title.content, "等待确认修改");
  assert.equal(card.header.template, "yellow");
});
