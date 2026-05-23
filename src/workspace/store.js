import { homedir } from "node:os";
import { resolve } from "node:path";
import { paths } from "../config/paths.js";
import { readJsonFile, writeJsonFile } from "../core/json-store.js";

export class WorkspaceStore {
  constructor(path = paths.workspacesFile, defaultCwd = homedir()) {
    this.path = path;
    this.defaultCwd = defaultCwd;
    this.data = { scopes: {}, named: {} };
  }

  async load() {
    this.data = await readJsonFile(this.path, { scopes: {}, named: {} });
    if (!this.data.scopes) this.data.scopes = {};
    if (!this.data.named) this.data.named = {};
  }

  cwdFor(scope) {
    return this.data.scopes[scope]?.cwd || this.defaultCwd;
  }

  setCwd(scope, cwd) {
    this.data.scopes[scope] = { cwd: resolve(cwd), updatedAt: new Date().toISOString() };
    void this.flush();
  }

  saveNamed(name, cwd) {
    this.data.named[name] = resolve(cwd);
    void this.flush();
  }

  useNamed(scope, name) {
    const cwd = this.data.named[name];
    if (!cwd) return "";
    this.setCwd(scope, cwd);
    return cwd;
  }

  removeNamed(name) {
    if (!this.data.named[name]) return false;
    delete this.data.named[name];
    void this.flush();
    return true;
  }

  listNamed() {
    return { ...this.data.named };
  }

  async flush() {
    await writeJsonFile(this.path, this.data);
  }
}
