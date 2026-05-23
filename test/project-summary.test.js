import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { maybeAnswerQuickProjectQuestion } from "../src/quick/project-summary.js";

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

test("ignores non-summary prompts", async () => {
  const answer = await maybeAnswerQuickProjectQuestion({
    prompt: "帮我改代码",
    cwd: process.cwd()
  });
  assert.equal(answer, "");
});
