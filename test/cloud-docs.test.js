import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveDocumentTitle,
  extractParentTitle,
  isCloudDocumentRequest,
  markdownToBlocks
} from "../src/cloud-docs/create.js";

test("detects cloud document create requests", () => {
  assert.equal(isCloudDocumentRequest("在【洛洛AI说】这个文档下，新建子文档，并写一篇文章"), true);
  assert.equal(isCloudDocumentRequest("请把 README.zh.md 里一句话改通顺"), false);
});

test("extracts parent title from bracketed request", () => {
  assert.equal(extractParentTitle("在【洛洛AI说】这个文档下，新建子文档"), "洛洛AI说");
});

test("derives document title from markdown heading", () => {
  assert.equal(deriveDocumentTitle("写一篇文章", "# 我如何用 Codex 接入飞书\n\n正文"), "我如何用 Codex 接入飞书");
});

test("converts markdown to docx blocks", () => {
  const blocks = markdownToBlocks("# 标题\n\n## 小节\n\n- 要点\n\n正文");
  assert.deepEqual(blocks.map((block) => block.block_type), [3, 4, 12, 2]);
  assert.equal(blocks[0].heading1.elements[0].text_run.content, "标题");
  assert.equal(blocks[2].bullet.elements[0].text_run.content, "要点");
});
