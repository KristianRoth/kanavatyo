// Pool of Mandelbrot workers. A job is a grid split into row chunks.
// Each channel ('explorer', 'pattern') runs one job at a time: starting a new job
// cancels the previous one on that channel. Explorer chunks jump the queue so the
// view stays responsive while a large pattern is computing.
const PRIORITY = { explorer: 0, pattern: 1 };

export class FieldPool {
  constructor(size = Math.max(2, Math.min(12, navigator.hardwareConcurrency || 4))) {
    this.idle = [];
    this.queue = [];
    this.jobs = new Map();
    this.channels = {};
    this.nextId = 1;
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => this.done(w, e.data);
      w.onerror = e => console.error('worker error', e.message);
      this.idle.push(w);
    }
  }

  // Resolves true when every chunk is done, false if cancelled.
  run(channel, grid, rows, chunkRows, onChunk) {
    this.cancel(channel);
    const id = this.nextId++;
    return new Promise(resolve => {
      const job = { id, channel, remaining: 0, onChunk, resolve };
      for (let r = 0; r < rows; r += chunkRows) {
        this.queue.push({
          id,
          prio: PRIORITY[channel],
          msg: { id, grid, rowStart: r, rowEnd: Math.min(rows, r + chunkRows) },
        });
        job.remaining++;
      }
      this.jobs.set(id, job);
      this.channels[channel] = id;
      this.queue.sort((a, b) => a.prio - b.prio); // stable: keeps row order within a job
      this.pump();
    });
  }

  cancel(channel) {
    const id = this.channels[channel];
    if (!id) return;
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    delete this.channels[channel];
    this.queue = this.queue.filter(t => t.id !== id);
    job?.resolve(false);
  }

  pump() {
    while (this.idle.length && this.queue.length) {
      this.idle.pop().postMessage(this.queue.shift().msg);
    }
  }

  done(worker, data) {
    this.idle.push(worker);
    const job = this.jobs.get(data.id);
    if (job) {
      job.onChunk(data.rowStart, data.rowEnd, data.out);
      if (--job.remaining === 0) {
        this.jobs.delete(job.id);
        delete this.channels[job.channel];
        job.resolve(true);
      }
    }
    this.pump();
  }
}
