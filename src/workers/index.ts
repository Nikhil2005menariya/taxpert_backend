import { emailWorker } from './email.worker';
import { extractionWorker } from './extraction.worker';
import { remindersWorker } from './reminders.worker';
import { slaWorker } from './sla.worker';
import { remindersQueue } from '../queues/reminders.queue';
import { slaQueue } from '../queues/sla.queue';

console.log('🚀 Starting Background Workers...');

// Initialize repeatable jobs (Cron)
async function initSchedules() {
  // Reminders: Daily at 3:30 AM
  await remindersQueue.add('daily-reminders', {}, {
    repeat: {
      pattern: '30 3 * * *'
    }
  });

  // SLA: Every 4 hours
  await slaQueue.add('sla-check', {}, {
    repeat: {
      pattern: '0 */4 * * *'
    }
  });

  console.log('📅 Scheduled recurring jobs configured.');
}

initSchedules().catch(console.error);

// Handle graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down workers...');
  await Promise.all([
    emailWorker.close(),
    extractionWorker.close(),
    remindersWorker.close(),
    slaWorker.close()
  ]);
  console.log('Workers stopped gracefully');
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
