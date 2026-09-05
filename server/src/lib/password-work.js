const bcrypt = require('bcryptjs');

const MAX_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.PASSWORD_WORK_CONCURRENCY) || 2),
);
const MAX_QUEUE = Math.max(20, Number(process.env.PASSWORD_WORK_QUEUE_LIMIT) || 100);

let active = 0;
let rejected = 0;
const queue = [];

class PasswordWorkQueueFullError extends Error {
  constructor() {
    super('Password service is busy');
    this.code = 'PASSWORD_WORK_QUEUE_FULL';
    this.status = 503;
  }
}

function drain() {
  while (active < MAX_CONCURRENCY && queue.length > 0) {
    const work = queue.shift();
    active += 1;
    Promise.resolve()
      .then(work.task)
      .then(work.resolve, work.reject)
      .finally(() => {
        active -= 1;
        drain();
      });
  }
}

function schedule(task) {
  if (queue.length >= MAX_QUEUE) {
    rejected += 1;
    return Promise.reject(new PasswordWorkQueueFullError());
  }
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
}

function hashPassword(value, rounds = 10) {
  return schedule(() => bcrypt.hash(String(value), rounds));
}

function comparePassword(value, hash) {
  return schedule(() => bcrypt.compare(String(value), String(hash)));
}

function getPasswordWorkStats() {
  return { active, queued: queue.length, rejected, concurrency: MAX_CONCURRENCY, queueLimit: MAX_QUEUE };
}

module.exports = {
  hashPassword,
  comparePassword,
  getPasswordWorkStats,
  PasswordWorkQueueFullError,
};
