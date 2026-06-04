import { Worker, Job } from 'bullmq';
import { redisConnection } from '../configs/redis.config';
import { createServiceClient } from '../configs/supabase.config';
import { appLogger } from '../utils/logger';
import { writeAudit } from '../utils/audit';
import {
  sendPaymentOverdueEmail,
  sendPaymentOverdueEscalationEmail,
} from '../utils/email';

const APP_URL = process.env.APP_URL ?? 'https://thetaxpert.com';

// ── Overdue invoice handling ──────────────────────────────────
// Runs daily at 3:30 AM (scheduled in workers/index.ts).
// Two passes:
//   Pass 1 — pending invoices past due_date → mark overdue + send first reminder
//   Pass 2 — invoices already overdue for 7+ more days → send escalation + notify admin

async function processOverdueInvoices() {
  const db  = createServiceClient();
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // ── Pass 1: pending → overdue ─────────────────────────────
  // Find invoices that are still 'pending' but past their due_date
  const { data: pendingOverdue, error: e1 } = await db
    .from('invoices')
    .select('id, invoice_number, client_id, client_service_id, total_amount, due_date, service:services(name)')
    .eq('status', 'pending')
    .lt('due_date', today)
    .not('due_date', 'is', null);

  if (e1) {
    appLogger.error('[reminders] failed to fetch pending overdue invoices', { err: e1.message });
    return;
  }

  const pass1 = pendingOverdue ?? [];
  appLogger.info(`[reminders] pass1: ${pass1.length} invoices to mark overdue`);

  for (const inv of pass1) {
    try {
      const dueDate  = new Date(inv.due_date);
      const daysOver = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const svcRaw   = inv.service as any;
      const svcName: string = Array.isArray(svcRaw) ? (svcRaw[0]?.name ?? '') : (svcRaw?.name ?? '');

      // Mark invoice as overdue
      await db.from('invoices')
        .update({ status: 'overdue' })
        .eq('id', inv.id);

      // Fetch client details
      const { data: client } = await db
        .from('users')
        .select('first_name, email')
        .eq('id', inv.client_id)
        .single();

      if (client?.email) {
        await sendPaymentOverdueEmail({
          to:               client.email,
          firstName:        client.first_name,
          serviceName:      svcName || 'your service',
          invoiceNumber:    inv.invoice_number,
          totalAmountPaise: inv.total_amount,
          daysOverdue:      daysOver,
          payLink:          `${APP_URL}/client/invoices/${inv.client_service_id}`,
        });
      }

      await writeAudit({
        actorId:    'system',
        action:     'invoice_overdue_notified',
        targetType: 'invoice',
        targetId:   inv.id,
        metadata:   { invoiceNumber: inv.invoice_number, daysOverdue: daysOver, clientId: inv.client_id },
      });

      appLogger.info(`[reminders] marked overdue + notified`, { invoiceId: inv.id, daysOver });
    } catch (err: any) {
      appLogger.error(`[reminders] pass1 error for invoice ${inv.id}`, { err: err.message });
    }
  }

  // ── Pass 2: escalation for invoices overdue 7+ days ───────
  // Find invoices already in 'overdue' status where due_date is 7+ days ago
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: escalationDue, error: e2 } = await db
    .from('invoices')
    .select('id, invoice_number, client_id, client_service_id, total_amount, due_date, service:services(name)')
    .eq('status', 'overdue')
    .lt('due_date', sevenDaysAgo)
    .not('due_date', 'is', null);

  if (e2) {
    appLogger.error('[reminders] failed to fetch escalation candidates', { err: e2.message });
    return;
  }

  const pass2 = escalationDue ?? [];
  appLogger.info(`[reminders] pass2: ${pass2.length} invoices for escalation check`);

  for (const inv of pass2) {
    try {
      // Check audit log — only escalate once
      const { data: alreadyEscalated } = await db
        .from('audit_logs')
        .select('id')
        .eq('action', 'invoice_overdue_escalated')
        .eq('target_id', inv.id)
        .maybeSingle();

      if (alreadyEscalated) continue;

      const dueDate  = new Date(inv.due_date);
      const daysOver = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const svcRaw2  = inv.service as any;
      const svcName2: string = Array.isArray(svcRaw2) ? (svcRaw2[0]?.name ?? '') : (svcRaw2?.name ?? '');

      const { data: client } = await db
        .from('users')
        .select('first_name, email')
        .eq('id', inv.client_id)
        .single();

      if (client?.email) {
        await sendPaymentOverdueEscalationEmail({
          to:               client.email,
          firstName:        client.first_name,
          serviceName:      svcName2 || 'your service',
          invoiceNumber:    inv.invoice_number,
          totalAmountPaise: inv.total_amount,
          daysOverdue:      daysOver,
          payLink:          `${APP_URL}/client/invoices/${inv.client_service_id}`,
        });
      }

      await writeAudit({
        actorId:    'system',
        action:     'invoice_overdue_escalated',
        targetType: 'invoice',
        targetId:   inv.id,
        metadata:   { invoiceNumber: inv.invoice_number, daysOverdue: daysOver, clientId: inv.client_id },
      });

      appLogger.info(`[reminders] escalation sent`, { invoiceId: inv.id, daysOver });
    } catch (err: any) {
      appLogger.error(`[reminders] pass2 error for invoice ${inv.id}`, { err: err.message });
    }
  }

  appLogger.info('[reminders] daily run complete', {
    markedOverdue:  pass1.length,
    escalationsSent: pass2.filter(Boolean).length,
  });
}

// ── Worker ────────────────────────────────────────────────────
// Note: there is no stale-account cleanup here. The OTP signup flow keeps
// unverified registrations entirely in Redis (self-expiring), and only
// commits to the database after verification — so unconfirmed users never
// exist in Postgres. The synchronous resolveUniqueness() check in the signup
// controller is the only backstop needed for any rare orphan.

// ── Notification retention ────────────────────────────────────
// Delete notifications that have been READ for more than 3 days. Unread
// notifications are kept indefinitely so nothing is missed.
async function cleanupReadNotifications() {
  const db = createServiceClient();
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await db
    .from('notifications')
    .delete({ count: 'exact' })
    .eq('is_read', true)
    .lt('read_at', cutoff);
  if (error) {
    appLogger.error('[reminders] notification cleanup failed', { err: error.message });
  } else {
    appLogger.info(`[reminders] cleaned up ${count ?? 0} read notifications older than 3 days`);
  }
}

export const remindersWorker = new Worker('reminders', async (_job: Job) => {
  appLogger.info('[reminders] daily run started');
  await processOverdueInvoices();
  await cleanupReadNotifications();
}, { connection: redisConnection });

remindersWorker.on('completed', () => {
  appLogger.info('[reminders] daily run completed');
});

remindersWorker.on('failed', (_job, err) => {
  appLogger.error('[reminders] daily run failed', { err: err.message });
});
