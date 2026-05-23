export class ActiveRuns {
  constructor() {
    this.runs = new Map();
  }

  get(scope) {
    return this.runs.get(scope);
  }

  register(scope, run) {
    const handle = { run, interrupted: false };
    this.runs.set(scope, handle);
    return handle;
  }

  unregister(scope, run) {
    const current = this.runs.get(scope);
    if (current?.run === run) this.runs.delete(scope);
  }

  async stop(scope) {
    const handle = this.runs.get(scope);
    if (!handle) return false;
    handle.interrupted = true;
    await handle.run.stop();
    return true;
  }

  async stopAll() {
    await Promise.all([...this.runs.keys()].map((scope) => this.stop(scope)));
  }
}
