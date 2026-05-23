export class PendingQueue {
  constructor(debounceMs, flush) {
    this.debounceMs = debounceMs;
    this.flush = flush;
    this.queues = new Map();
    this.timers = new Map();
    this.blocked = new Set();
  }

  push(scope, message) {
    const queue = this.queues.get(scope) || [];
    queue.push(message);
    this.queues.set(scope, queue);
    this.arm(scope);
    return queue.length;
  }

  block(scope) {
    this.blocked.add(scope);
    this.clearTimer(scope);
  }

  unblock(scope) {
    this.blocked.delete(scope);
    this.arm(scope);
  }

  cancel(scope) {
    const queue = this.queues.get(scope) || [];
    this.queues.delete(scope);
    this.clearTimer(scope);
    return queue;
  }

  cancelAll() {
    for (const scope of this.queues.keys()) this.cancel(scope);
  }

  arm(scope) {
    if (this.blocked.has(scope)) return;
    this.clearTimer(scope);
    this.timers.set(scope, setTimeout(() => {
      const batch = this.queues.get(scope) || [];
      this.queues.delete(scope);
      this.timers.delete(scope);
      if (batch.length) void this.flush(scope, batch);
    }, this.debounceMs));
  }

  clearTimer(scope) {
    const timer = this.timers.get(scope);
    if (timer) clearTimeout(timer);
    this.timers.delete(scope);
  }
}
