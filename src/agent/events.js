export const initialRunState = {
  terminal: "running",
  footer: "thinking",
  text: "",
  tools: [],
  sessionId: ""
};

export function reduceRunState(state, event) {
  if (event.type === "system" && event.sessionId) {
    return { ...state, sessionId: event.sessionId };
  }
  if (event.type === "text_delta") {
    return { ...state, text: state.text + event.text };
  }
  if (event.type === "tool_use") {
    return {
      ...state,
      footer: "working",
      tools: [...state.tools, { id: event.id, name: event.name, status: "running", input: event.input || "" }]
    };
  }
  if (event.type === "tool_result") {
    return {
      ...state,
      tools: state.tools.map((tool) => tool.id === event.id ? { ...tool, status: event.isError ? "error" : "done", output: event.output || "" } : tool)
    };
  }
  if (event.type === "result") {
    return {
      ...state,
      terminal: event.success === false ? "error" : "done",
      footer: event.success === false ? "failed" : "done",
      text: event.text && !state.text.includes(event.text) ? `${state.text}${state.text ? "\n\n" : ""}${event.text}` : state.text
    };
  }
  if (event.type === "error") {
    return { ...state, terminal: "error", footer: "failed", text: `${state.text}\n\n${event.message}`.trim() };
  }
  if (event.type === "interrupted") {
    return { ...state, terminal: "interrupted", footer: "interrupted" };
  }
  if (event.type === "idle_timeout") {
    return { ...state, terminal: "idle_timeout", footer: "idle_timeout" };
  }
  return state;
}

export function normalizeCodexJson(value) {
  const events = [];
  const sessionId = findStringByKey(value, ["session_id", "sessionId", "conversation_id", "conversationId"]);
  if (sessionId) events.push({ type: "system", sessionId });

  const type = String(value.type || value.event || value.kind || "");
  const lower = type.toLowerCase();

  if (lower.includes("tool") || lower.includes("exec") || lower.includes("command")) {
    const id = findStringByKey(value, ["call_id", "tool_call_id", "id"]) || `${Date.now()}`;
    const name = findStringByKey(value, ["name", "command", "cmd"]) || type || "tool";
    if (lower.includes("result") || lower.includes("end") || lower.includes("complete")) {
      events.push({ type: "tool_result", id, output: extractText(value), isError: Boolean(value.error) });
    } else {
      events.push({ type: "tool_use", id, name, input: extractText(value) });
    }
    return events;
  }

  if (lower.includes("error") || value.error) {
    events.push({ type: "error", message: extractText(value) || String(value.error || "Codex error") });
    return events;
  }

  if (lower.includes("done") || lower.includes("complete") || lower.includes("result")) {
    events.push({ type: "result", text: extractText(value), success: value.success !== false });
    return events;
  }

  const text = extractDelta(value) || extractText(value);
  if (text) events.push({ type: "text_delta", text });
  return events;
}

function extractDelta(value) {
  return findStringByKey(value, ["delta", "text_delta", "output_text_delta"]);
}

function extractText(value) {
  return findStringByKey(value, ["text", "content", "message", "output", "stdout", "summary", "final_message"]) || "";
}

function findStringByKey(value, keys) {
  const seen = new Set();
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    for (const key of keys) {
      if (typeof item[key] === "string" && item[key]) return item[key];
    }
    for (const child of Object.values(item)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return "";
}
