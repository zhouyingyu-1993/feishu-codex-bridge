import test from "node:test";
import assert from "node:assert/strict";
import { initialRunState, normalizeCodexJson, reduceRunState } from "../src/agent/events.js";

test("normalizes session ids and text deltas", () => {
  const events = normalizeCodexJson({ type: "agent_message_delta", session_id: "abc", delta: "hello" });
  assert.equal(events[0].type, "system");
  assert.equal(events[0].sessionId, "abc");
  assert.equal(events[1].type, "text_delta");
  assert.equal(events[1].text, "hello");
});

test("normalizes codex thread ids", () => {
  const events = normalizeCodexJson({ type: "thread.started", thread_id: "019e58cd" });
  assert.deepEqual(events, [{ type: "system", sessionId: "019e58cd" }]);
});

test("keeps codex item completion running until final file result", () => {
  const events = normalizeCodexJson({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "我先看 README。" } });
  assert.deepEqual(events, [{ type: "text_delta", text: "我先看 README。" }]);
});

test("ignores codex turn completion event", () => {
  const events = normalizeCodexJson({ type: "turn.completed", usage: { input_tokens: 1 } });
  assert.deepEqual(events, []);
});

test("reduces text and result", () => {
  let state = { ...initialRunState };
  state = reduceRunState(state, { type: "text_delta", text: "hello" });
  state = reduceRunState(state, { type: "result", text: "", success: true });
  assert.equal(state.text, "hello");
  assert.equal(state.terminal, "done");
});

test("uses final result text over interim text", () => {
  let state = { ...initialRunState };
  state = reduceRunState(state, { type: "text_delta", text: "我先看 README。" });
  state = reduceRunState(state, { type: "result", text: "已把 README.zh.md 的项目介绍改得更通顺。", success: true });
  assert.equal(state.text, "已把 README.zh.md 的项目介绍改得更通顺。");
  assert.equal(state.terminal, "done");
});

test("drops process-only codex chatter", () => {
  let state = { ...initialRunState };
  state = reduceRunState(state, { type: "text_delta", text: "Codex 正在思考..." });
  state = reduceRunState(state, { type: "result", text: "", success: true });
  assert.match(state.text, /没有返回最终结果/);
  assert.equal(state.terminal, "done");
});

test("keeps idle timeout duration in run state", () => {
  const state = reduceRunState({ ...initialRunState }, { type: "idle_timeout", timeoutMs: 90000 });
  assert.equal(state.terminal, "idle_timeout");
  assert.equal(state.timeoutMs, 90000);
});
