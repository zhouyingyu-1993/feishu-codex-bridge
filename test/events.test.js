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

test("reduces text and result", () => {
  let state = { ...initialRunState };
  state = reduceRunState(state, { type: "text_delta", text: "hello" });
  state = reduceRunState(state, { type: "result", text: "", success: true });
  assert.equal(state.text, "hello");
  assert.equal(state.terminal, "done");
});

test("keeps idle timeout duration in run state", () => {
  const state = reduceRunState({ ...initialRunState }, { type: "idle_timeout", timeoutMs: 90000 });
  assert.equal(state.terminal, "idle_timeout");
  assert.equal(state.timeoutMs, 90000);
});
