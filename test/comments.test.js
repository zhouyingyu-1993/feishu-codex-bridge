import test from "node:test";
import assert from "node:assert/strict";
import { buildCommentPrompt, stripMarkdown } from "../src/bot/comments.js";

test("comment prompt includes cloud doc context and lark-cli hint", () => {
  const prompt = buildCommentPrompt(
    { fileToken: "doc-token", fileType: "docx" },
    { question: "帮我润色这段", quote: "原文", isWhole: false }
  );
  assert.match(prompt, /飞书云文档/);
  assert.match(prompt, /doc-token/);
  assert.match(prompt, /lark-cli docs \+fetch --doc doc-token/);
  assert.match(prompt, /帮我润色这段/);
});

test("stripMarkdown removes common markers for comment replies", () => {
  const text = stripMarkdown("# 标题\n- **重点** 和 `代码`\n> 引用");
  assert.equal(text.trim(), "标题\n重点 和 代码\n引用");
});
