let Queue;
let QueueScheduler;
let QueueEvents;
try {
  // Lazy load to keep tests working even if bullmq isn't installed locally
  // (e.g., in CI without Redis). Queue will be disabled if this import fails.
  ({ Queue, QueueScheduler, QueueEvents } = require('bullmq'));
} catch (err) {
  console.warn('[queue] bullmq not available; queue disabled for this run');
}

const redisUrl = process.env.REDIS_URL || null;
const prefix = process.env.QUEUE_PREFIX || 'teketeke';
const queueName = `${prefix}-jobs`;
const defaultAttempts = Number(process.env.QUEUE_ATTEMPTS || 5);

let queue = null;
let scheduler = null;
let events = null;

function isQueueEnabled() {
  return Boolean(redisUrl && Queue && QueueScheduler && QueueEvents);
}

function getConnection() {
  if (!isQueueEnabled()) return null;
  return { url: redisUrl };
}

function getQueue() {
  if (!isQueueEnabled()) return null;
  if (!queue) {
    queue = new Queue(queueName, { connection: getConnection(), prefix });
  }
  if (!scheduler) {
    scheduler = new QueueScheduler(queueName, { connection: getConnection(), prefix });
  }
  if (!events) {
    events = new QueueEvents(queueName, { connection: getConnection(), prefix });
    events.on('failed', ({ jobId, failedReason }) => {
      console.warn('[queue] job failed', jobId, failedReason);
    });
  }
  return queue;
}

async function enqueueJob(name, data = {}, opts = {}) {
  if (!isQueueEnabled()) {
    throw new Error('queue_disabled');
  }
  const q = getQueue();
  const jobId = opts.jobId || undefined;
  const job = await q.add(name, data, {
    attempts: defaultAttempts,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 200,
    ...opts,
    jobId,
  });
  return job;
}

function getQueueConfig() {
  return {
    queueName,
    prefix,
    connection: getConnection(),
  };
}

module.exports = {
  isQueueEnabled,
  getQueue,
  enqueueJob,
  getQueueConfig,
};
