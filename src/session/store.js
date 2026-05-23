import { paths } from "../config/paths.js";
import { readJsonFile, writeJsonFile } from "../core/json-store.js";

export class SessionStore {
  constructor(path = paths.sessionsFile) {
    this.path = path;
    this.data = { sessions: {} };
  }

  async load() {
    this.data = await readJsonFile(this.path, { sessions: {} });
    if (!this.data.sessions) this.data.sessions = {};
  }

  resumeFor(scope, cwd) {
    const entry = this.data.sessions[scope];
    if (!entry || entry.cwd !== cwd) return "";
    return entry.sessionId || "";
  }

  set(scope, sessionId, cwd) {
    this.data.sessions[scope] = {
      ...(this.data.sessions[scope] || {}),
      sessionId,
      cwd,
      updatedAt: new Date().toISOString()
    };
    void this.flush();
  }

  clear(scope) {
    delete this.data.sessions[scope];
    void this.flush();
  }

  setIdleTimeout(scope, minutes) {
    const entry = this.data.sessions[scope] || {};
    this.data.sessions[scope] = { ...entry, idleTimeoutMinutes: minutes, updatedAt: new Date().toISOString() };
    void this.flush();
  }

  getIdleTimeout(scope) {
    return this.data.sessions[scope]?.idleTimeoutMinutes;
  }

  list() {
    return Object.entries(this.data.sessions).map(([scope, entry]) => ({ scope, ...entry }));
  }

  async flush() {
    await writeJsonFile(this.path, this.data);
  }
}
