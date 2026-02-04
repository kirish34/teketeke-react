const { Worker } = require('bullmq');
const { getQueueConfig, getQueue, isQueueEnabled } = require('./queues/queue');
const { logAdminAction } = require('./services/audit.service');

const { queueName, connection } = getQueueConfig();

if (!connection) {
  console.error('[worker] REDIS_URL not configured; worker will not start');
  process.exit(1);
}

const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);

const worker = new Worker(
  queueName,
  async (job) => {
    const ctx = {
      requestId: job.id,
      actorUserId: job.data?.actorUserId || null,
      actorRole: job.data?.actorRole || 'system_admin',
    };
    await logAdminAction({
      req: { user: { id: ctx.actorUserId, role: ctx.actorRole }, requestId: ctx.requestId },
      action: 'job_started',
      resource_type: job.name,
      resource_id: job.id,
      payload: job.data || {},
    });

    switch (job.name) {
      case 'FRAUD_DETECTOR_RUN':
        {
          const { runFraudDetection } = require('./services/fraudDetector.service');
          await runFraudDetection({
            fromTs: job.data?.from,
            toTs: job.data?.to,
            actorUserId: ctx.actorUserId,
            actorRole: ctx.actorRole,
            requestId: ctx.requestId,
            mode: 'write',
          });
        }
        break;
      case 'FRAUD_ALERT_ESCALATION':
        {
          const { maybeEscalateAndNotify } = require('./services/alertRouting.service');
          await maybeEscalateAndNotify({
            actorUserId: ctx.actorUserId,
            actorRole: ctx.actorRole,
            requestId: ctx.requestId,
          });
        }
        break;
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }

    await logAdminAction({
      req: { user: { id: ctx.actorUserId, role: ctx.actorRole }, requestId: ctx.requestId },
      action: 'job_succeeded',
      resource_type: job.name,
      resource_id: job.id,
      payload: { batchId: job.data?.batchId || null },
    });
    return { ok: true };
  },
  { connection, concurrency },
);

worker.on('failed', async (job, err) => {
  console.error('[worker] job failed', job?.id, job?.name, err?.message);
  try {
    await logAdminAction({
      req: { user: { id: job?.data?.actorUserId || null, role: job?.data?.actorRole || null }, requestId: job?.id },
      action: 'job_failed',
      resource_type: job?.name,
      resource_id: job?.id || null,
      payload: { error: err?.message || 'failed' },
    });
  } catch (e) {
    console.warn('[worker] failed to log audit for job failure:', e.message);
  }
});

worker.on('completed', (job) => {
  console.log('[worker] job completed', job.id, job.name);
});

async function ensureRepeatableJobs() {
  if (!isQueueEnabled()) return;
  try {
    const queue = getQueue();
    const every = Number(process.env.ALERT_ESCALATION_REPEAT_MS || 10 * 60 * 1000);
    await queue.add(
      'FRAUD_ALERT_ESCALATION',
      { actorRole: 'system_admin' },
      {
        jobId: 'fraud-alert-escalation-repeat',
        repeat: { every },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    console.log('[worker] repeatable FRAUD_ALERT_ESCALATION scheduled', every, 'ms');
  } catch (err) {
    console.warn('[worker] failed to schedule repeatable escalation job', err.message);
  }
}

ensureRepeatableJobs().catch((err) => {
  console.warn('[worker] repeatable scheduling error', err?.message || err);
});

console.log(`[worker] started for queue ${queueName} (concurrency=${concurrency})`);
