import { Worker, Job } from 'bullmq';
import { redisConnection } from '../configs/redis.config';

export const remindersWorker = new Worker('reminders', async (job: Job) => {
  console.log(`[RemindersWorker] Running daily reminders check at ${new Date().toISOString()}`);
  // Execute daily reminders logic
}, { connection: redisConnection });

remindersWorker.on('completed', job => {
  console.log(`[RemindersWorker] Daily run completed`);
});
