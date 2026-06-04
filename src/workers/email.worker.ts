import { Worker, Job } from 'bullmq';
import { redisConnection } from '../configs/redis.config';
import {
  sendWorkflowStatusEmail,
  sendDocumentRequestEmail,
  sendEmailVerificationEmail,
  sendSignupEmail,
  sendReferralRewardEmail,
  sendDocumentReminderEmail,
  sendDocumentStatusEmail,
  sendTexpertAssignedEmail,
  sendReuploadRequestEmail,
  sendAdditionalDocAddedEmail,
  sendTexpertCredentialsEmail,
  sendPayoutRecordedEmail,
  sendManualNotificationEmail,
  sendPaymentConfirmationEmail,
  sendPaymentFailedEmail,
  sendInvoiceGeneratedEmail,
  sendCouponIssuedEmail,
  sendPasswordResetEmail,
  sendNewUserWelcomeEmail,
  sendDeletionRequestedEmail,
  sendServiceHoldEmail,
  sendPinnedMessageEmail,
  sendServiceQueuedEmail,
} from '../utils/email';
import { appLogger } from '../utils/logger';

export const emailWorker = new Worker('email', async (job: Job) => {
  const { type, payload } = job.data;

  switch (type) {
    // ── Existing ──────────────────────────────────────────────
    case 'workflow-status':
      await sendWorkflowStatusEmail(payload);
      break;
    case 'document-request':
      await sendDocumentRequestEmail(payload);
      break;
    case 'email-verification':
      await sendEmailVerificationEmail(payload);
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

    // ── Phase 2 — previously missing ─────────────────────────
    case 'texpert-assigned':
      await sendTexpertAssignedEmail(payload);
      break;
    case 'reupload-request':
      await sendReuploadRequestEmail(payload);
      break;
    case 'additional-doc-added':
      await sendAdditionalDocAddedEmail(payload);
      break;
    case 'texpert-credentials':
      await sendTexpertCredentialsEmail(payload);
      break;
    case 'admin-password-reset':
      await sendPasswordResetEmail(payload);
      break;
    case 'new-user-welcome':
      await sendNewUserWelcomeEmail(payload);
      break;
    case 'deletion-requested':
      await sendDeletionRequestedEmail(payload);
      break;
    case 'service-hold':
      await sendServiceHoldEmail(payload);
      break;
    case 'pinned-message':
      await sendPinnedMessageEmail(payload);
      break;
    case 'service-queued':
      await sendServiceQueuedEmail(payload);
      break;
    case 'payout-recorded':
      await sendPayoutRecordedEmail(payload);
      break;
    case 'manual-notification':
      await sendManualNotificationEmail(payload);
      break;

    // ── Payment ───────────────────────────────────────────────
    case 'payment-confirmation':
      await sendPaymentConfirmationEmail(payload);
      break;
    case 'payment-failed':
      await sendPaymentFailedEmail(payload);
      break;
    case 'invoice-generated':
      await sendInvoiceGeneratedEmail(payload);
      break;
    case 'coupon-issued':
      await sendCouponIssuedEmail(payload);
      break;

    default:
      appLogger.warn(`[EmailWorker] Unknown job type: ${type}`);
  }
}, {
  connection: redisConnection,
  concurrency: 5,
});

emailWorker.on('completed', job => {
  appLogger.info(`[EmailWorker] ${job.data.type} sent (job ${job.id})`);
});

emailWorker.on('failed', (job, err) => {
  appLogger.error(`[EmailWorker] ${job?.data?.type ?? 'unknown'} failed (job ${job?.id})`, { err: err.message });
});
