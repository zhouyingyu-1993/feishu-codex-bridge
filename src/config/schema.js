import { homedir } from "node:os";

export function defaultConfig() {
  return {
    accounts: {
      app: {
        id: "",
        secret: "",
        tenant: "feishu"
      }
    },
    agent: {
      command: "codex",
      model: "",
      profile: "",
      sandbox: "workspace-write",
      skipGitRepoCheck: true,
      extraArgs: []
    },
    preferences: {
      replyMode: "card",
      requireMentionInGroup: true,
      respondToMentionAll: false,
      showToolCalls: true,
      maxConcurrentRuns: 1,
      stopGraceMs: 2000,
      idleTimeoutMinutes: 0,
      defaultCwd: homedir(),
      access: {
        allowedUsers: [],
        allowedChats: [],
        admins: []
      }
    }
  };
}

export function normalizeConfig(input = {}) {
  const base = defaultConfig();
  const cfg = merge(base, input);
  if (!["feishu", "lark"].includes(cfg.accounts.app.tenant)) cfg.accounts.app.tenant = "feishu";
  if (!["card", "markdown", "text"].includes(cfg.preferences.replyMode)) cfg.preferences.replyMode = "card";
  if (!["read-only", "workspace-write", "danger-full-access"].includes(cfg.agent.sandbox)) {
    cfg.agent.sandbox = "workspace-write";
  }
  cfg.preferences.maxConcurrentRuns = positiveInteger(cfg.preferences.maxConcurrentRuns, 1);
  cfg.preferences.stopGraceMs = positiveInteger(cfg.preferences.stopGraceMs, 2000);
  cfg.preferences.idleTimeoutMinutes = Math.max(0, Number(cfg.preferences.idleTimeoutMinutes || 0));
  cfg.agent.extraArgs = Array.isArray(cfg.agent.extraArgs) ? cfg.agent.extraArgs.map(String) : [];
  for (const key of ["allowedUsers", "allowedChats", "admins"]) {
    cfg.preferences.access[key] = toStringList(cfg.preferences.access[key]);
  }
  return cfg;
}

export function getAccess(cfg) {
  return cfg.preferences?.access || {};
}

export function isUserAllowed(cfg, openId) {
  const allowed = toStringList(getAccess(cfg).allowedUsers);
  return allowed.length === 0 || allowed.includes(openId);
}

export function isChatAllowed(cfg, chatId) {
  const allowed = toStringList(getAccess(cfg).allowedChats);
  return allowed.length === 0 || allowed.includes(chatId);
}

export function isAdmin(cfg, openId) {
  const admins = toStringList(getAccess(cfg).admins);
  return admins.length === 0 || admins.includes(openId);
}

export function setPreference(cfg, key, rawValue) {
  const value = String(rawValue ?? "").trim();
  switch (key) {
    case "replyMode":
      if (!["card", "markdown", "text"].includes(value)) throw new Error("replyMode must be card, markdown, or text");
      cfg.preferences.replyMode = value;
      break;
    case "requireMentionInGroup":
    case "showToolCalls":
    case "respondToMentionAll":
      cfg.preferences[key] = parseBoolean(value);
      break;
    case "maxConcurrentRuns":
    case "stopGraceMs":
      cfg.preferences[key] = positiveInteger(Number(value), cfg.preferences[key]);
      break;
    case "idleTimeoutMinutes":
      cfg.preferences.idleTimeoutMinutes = Math.max(0, Number(value));
      break;
    case "allowedUsers":
    case "allowedChats":
    case "admins":
      cfg.preferences.access[key] = splitCsv(value);
      break;
    default:
      throw new Error(`Unknown preference: ${key}`);
  }
}

function merge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") {
      out[key] = merge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toStringList(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function splitCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseBoolean(value) {
  if (["1", "true", "yes", "on", "y"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off", "n"].includes(value.toLowerCase())) return false;
  throw new Error("Boolean value must be on/off, true/false, or yes/no");
}
