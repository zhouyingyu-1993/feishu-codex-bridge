export class ProcessPool {
  constructor(limitProvider) {
    this.limitProvider = limitProvider;
    this.active = 0;
    this.waiting = [];
  }

  async acquire() {
    const limit = Math.max(1, Number(this.limitProvider() || 1));
    if (this.active < limit) {
      this.active++;
      return () => this.release();
    }
    await new Promise((resolve) => this.waiting.push(resolve));
    this.active++;
    return () => this.release();
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiting.shift();
    if (next) next();
  }
}
