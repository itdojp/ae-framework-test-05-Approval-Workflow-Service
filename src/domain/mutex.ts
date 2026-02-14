export class Mutex {
  private queue: Promise<void> = Promise.resolve();

  async lock(): Promise<() => void> {
    let unlockNext!: () => void;
    const willLock = new Promise<void>((resolve) => {
      unlockNext = resolve;
    });

    const previous = this.queue;
    this.queue = this.queue.then(() => willLock);
    await previous;

    let released = false;
    return () => {
      if (!released) {
        released = true;
        unlockNext();
      }
    };
  }

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.lock();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

