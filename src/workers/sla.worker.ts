import { Worker, Job } from 'bullmq';
import { redisConnection } from '../configs/redis.config';

export const slaWorker = new Worker('sla', async (job: Job) => {
  console.log(`[SlaWorker] Running SLA breach detection at ${new Date().toISOString()}`);
  // Execute SLA logic
}, { connection: redisConnection });

slaWorker.on('completed', job => {
  console.log(`[SlaWorker] SLA run completed`);
});
