import { Worker, Job } from 'bullmq';
import { redisConnection } from '../configs/redis.config';
import {
  sendWorkflowStatusEmail,
  sendDocumentRequestEmail,
  sendSignupEmail,
  sendReferralRewardEmail,
  sendDocumentReminderEmail,
  sendDocumentStatusEmail
} from '../utils/email';

export const emailWorker = new Worker('email', async (job: Job) => {
  const { type, payload } = job.data;
  
  switch (type) {
    case 'workflow-status':
      await sendWorkflowStatusEmail(payload);
      break;
    case 'document-request':
      await sendDocumentRequestEmail(payload);
      break;
    case 'signup':
      await sendSignupEmail(payload);
      break;
    case 'referral-reward':
      await sendReferralRewardEmail(payload);
      break;
    case 'document-reminder':
      await sendDocumentReminderEmail(payload);
      break;
    case 'document-status':
      await sendDocumentStatusEmail(payload);
      break;
    default:
      console.warn(`Unknown email job type: ${type}`);
  }
}, { connection: redisConnection });

emailWorker.on('completed', job => {
  console.log(`[EmailWorker] Job ${job.id} completed successfully`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`[EmailWorker] Job ${job?.id} failed:`, err);
});
