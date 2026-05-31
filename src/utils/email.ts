import { resend, DEFAULT_FROM_EMAIL as FROM } from '../configs/email.config';

const WORKFLOW_COPY: Record<string, { subject: string; headline: string; body: string }> = {
  documents_received: {
    subject: "Documents received — we're on it",
    headline: "Documents received ✓",
    body: "All required documents are in. Our team will begin work on your service shortly.",
  },
  in_progress: {
    subject: "Work has started on your service",
    headline: "In progress",
    body: "Your service is now in progress. We’ll update you again when it moves into review.",
  },
  under_review: {
    subject: "Your service is under review",
    headline: "Under review",
    body: "Your service is currently being reviewed by our Taxpert team. We'll be in touch soon.",
  },
  invoice_pending: {
    subject: "Invoice pending for your service",
    headline: "Invoice pending",
    body: "Your service is ready for the invoice step. Complete payment so we can close it out.",
  },
  completed: {
    subject: "Service completed — all done!",
    headline: "Completed ✓",
    body: "Your service has been successfully completed. Thank you for choosing TheTaxpert.",
  },
};

export async function sendWorkflowStatusEmail({
  to,
  firstName,
  serviceName,
  status,
}: {
  to: string;
  firstName: string;
  serviceName: string;
  status: string;
}) {
  const copy = WORKFLOW_COPY[status];
  if (!copy || !resend) return;

  await resend.emails.send({
    from: FROM,
    to,
    subject: `${copy.subject} — ${serviceName}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
        <p style="font-size:16px">Hi ${firstName},</p>
        <h2 style="font-size:18px;font-weight:700;margin:0 0 8px">${copy.headline}</h2>
        <p style="margin:0 0 16px">${copy.body}</p>
        <p style="font-size:14px;color:#555">Service: <strong>${serviceName}</strong></p>
        <p>
          <a href="https://thetaxpert.com/my-services"
             style="display:inline-block;background:#c49a3a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">
            View Service →
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="font-size:12px;color:#999">TheTaxpert · Tax &amp; Compliance Services</p>
      </div>
    `,
  });
}

export async function sendDocumentRequestEmail({
  to,
  firstName,
  serviceName,
  documents,
}: {
  to: string;
  firstName: string;
  serviceName: string;
  documents: string[];
}) {
  if (!resend) return;
  const docList = documents.map(d => `<li style="margin:4px 0">${d}</li>`).join("");

  await resend.emails.send({
    from: FROM,
    to,
    subject: `Action required: Documents needed for ${serviceName}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
        <p style="font-size:16px">Hi ${firstName},</p>
        <p>Your <strong>${serviceName}</strong> service has been activated. Please upload the following documents to proceed:</p>
        <ul style="padding-left:20px;line-height:1.8">
          ${docList}
        </ul>
        <p>
          <a href="https://thetaxpert.com/vault"
             style="display:inline-block;background:#c49a3a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">
            Upload Documents →
          </a>
        </p>
        <p style="font-size:13px;color:#666">
          If you have any questions, reply to this email or contact us at
          <a href="mailto:info@thetaxpert.com">info@thetaxpert.com</a>.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="font-size:12px;color:#999">TheTaxpert · Tax &amp; Compliance Services</p>
      </div>
    `,
  });
}

export async function sendSignupEmail({
  to,
  firstName,
}: {
  to: string;
  firstName: string;
}) {
  if (!resend) return;
  await resend.emails.send({
    from: FROM,
    to,
    subject: "Welcome to TheTaxpert — here's how to get started",
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
        <p style="font-size:16px">Hi ${firstName},</p>
        <p style="margin:0 0 16px">
          Welcome to <strong>TheTaxpert</strong>! Your account is ready and your personal
          Tax Vault has been created.
        </p>
        <p style="font-weight:600;margin:0 0 10px">Here&rsquo;s what to do next:</p>
        <table style="border-collapse:collapse;width:100%;margin:0 0 24px">
          <tr>
            <td style="vertical-align:top;padding:8px 12px 8px 0;width:28px">
              <div style="width:24px;height:24px;border-radius:50%;background:#f9f5ec;border:1px solid #c49a3a;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#c49a3a;text-align:center;line-height:24px">1</div>
            </td>
            <td style="vertical-align:top;padding:8px 0;font-size:14px;color:#333;line-height:1.55">
              Browse our services and select what you need (ITR filing, GST, company registration, and more)
            </td>
          </tr>
          <tr>
            <td style="vertical-align:top;padding:8px 12px 8px 0;width:28px">
              <div style="width:24px;height:24px;border-radius:50%;background:#f9f5ec;border:1px solid #c49a3a;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#c49a3a;text-align:center;line-height:24px">2</div>
            </td>
            <td style="vertical-align:top;padding:8px 0;font-size:14px;color:#333;line-height:1.55">
              Upload your documents to your Tax Vault — we&rsquo;ll tell you exactly what&rsquo;s needed
            </td>
          </tr>
          <tr>
            <td style="vertical-align:top;padding:8px 12px 8px 0;width:28px">
              <div style="width:24px;height:24px;border-radius:50%;background:#f9f5ec;border:1px solid #c49a3a;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#c49a3a;text-align:center;line-height:24px">3</div>
            </td>
            <td style="vertical-align:top;padding:8px 0;font-size:14px;color:#333;line-height:1.55">
              Your assigned Taxpert will review everything and complete the filing
            </td>
          </tr>
        </table>
        <p>
          <a href="https://thetaxpert.com/services"
             style="display:inline-block;background:#c49a3a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">
            Browse Services →
          </a>
        </p>
        <p style="font-size:13px;color:#666;margin-top:20px">
          Have questions? Reply to this email or contact us at
          <a href="mailto:info@thetaxpert.com" style="color:#c49a3a">info@thetaxpert.com</a>.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="font-size:12px;color:#999">TheTaxpert · Tax &amp; Compliance Services</p>
      </div>
    `,
  });
}

export async function sendReferralRewardEmail({
  to,
  firstName,
  rewardAmount,
  couponCode,
}: {
  to: string;
  firstName: string;
  rewardAmount: number;
  couponCode: string;
}) {
  if (!resend) return;
  const rupees = (rewardAmount / 100).toLocaleString("en-IN");
  await resend.emails.send({
    from: FROM,
    to,
    subject: `You earned ₹${rupees} — referral reward from TheTaxpert`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
        <p style="font-size:16px">Hi ${firstName},</p>
        <p>Great news! Someone you referred just completed their first payment on TheTaxpert.
           As a thank-you, here's your reward coupon:</p>
        <div style="background:#f9f5ec;border:1px dashed #c49a3a;border-radius:10px;padding:20px 24px;text-align:center;margin:20px 0">
          <p style="margin:0 0 6px;font-size:13px;color:#888;letter-spacing:.05em">YOUR REWARD COUPON</p>
          <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:.1em;color:#1a1a2e">${couponCode}</p>
          <p style="margin:8px 0 0;font-size:15px;color:#2f7a5b;font-weight:600">₹${rupees} off your next service</p>
        </div>
        <p>Use this code at checkout on your next TheTaxpert service. Valid for 12 months.</p>
        <p>
          <a href="https://thetaxpert.com/services"
             style="display:inline-block;background:#c49a3a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">
            Browse Services →
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="font-size:12px;color:#999">TheTaxpert · Tax &amp; Compliance Services</p>
      </div>
    `,
  });
}

const REMINDER_COPY: Record<string, { subject: (s: string) => string; headline: (s: string) => string; body: (s: string) => string }> = {
  auto_48h: {
    subject:  (s) => `Friendly reminder — documents needed for ${s}`,
    headline: (s) => `Friendly reminder — we need a few documents to get started on your ${s}`,
    body:     ()  => "We just need the documents listed below before we can begin. It only takes a few minutes to upload them.",
  },
  auto_5d: {
    subject:  (s) => `Documents still needed for ${s} — please upload soon`,
    headline: (s) => `Your ${s} is waiting on documents — please upload soon`,
    body:     ()  => "We've been waiting on these documents for a few days. Please upload them at your earliest convenience so we can get started.",
  },
  auto_7d: {
    subject:  (s) => `Urgent: documents needed for ${s} — filing deadline approaching`,
    headline: (s) => `Urgent: documents needed for your ${s} — filing deadline approaching`,
    body:     ()  => "This is an urgent reminder. Filing deadlines are approaching and we still need the documents below. Please upload them immediately to avoid delays or penalties.",
  },
  manual_nudge: {
    subject:  (s) => `Your Taxpert is requesting documents for ${s}`,
    headline: (s) => `Your Taxpert is requesting documents for ${s}`,
    body:     ()  => "Your assigned Taxpert has reviewed your case and is requesting the following documents to proceed with your filing.",
  },
};

export async function sendDocumentReminderEmail({
  to,
  firstName,
  serviceName,
  pendingDocuments,
  vaultLink,
  reminderType,
}: {
  to: string;
  firstName: string;
  serviceName: string;
  pendingDocuments: string[];
  vaultLink: string;
  reminderType: "auto_48h" | "auto_5d" | "auto_7d" | "manual_nudge";
}) {
  if (!resend) return;
  const copy = REMINDER_COPY[reminderType] ?? REMINDER_COPY.manual_nudge;
  const docList = pendingDocuments.map(d => `<li style="margin:4px 0">${d}</li>`).join("");
  const isUrgent = reminderType === "auto_7d";

  await resend.emails.send({
    from: FROM,
    to,
    subject: copy.subject(serviceName),
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
        <p style="font-size:16px">Hi ${firstName},</p>
        ${isUrgent ? `<p style="background:#fff3f3;border-left:3px solid #b64545;padding:10px 14px;border-radius:4px;font-weight:600;color:#b64545">⚠️ Urgent action required</p>` : ""}
        <h2 style="font-size:18px;font-weight:700;margin:0 0 8px">${copy.headline(serviceName)}</h2>
        <p style="margin:0 0 16px">${copy.body(serviceName)}</p>
        <p style="font-weight:600;margin:0 0 6px">Documents required:</p>
        <ul style="padding-left:20px;line-height:1.8;margin:0 0 20px">
          ${docList}
        </ul>
        <p>
          <a href="${vaultLink}"
             style="display:inline-block;background:#c49a3a;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            Upload Documents →
          </a>
        </p>
        <p style="font-size:13px;color:#666;margin-top:20px">
          If you have any questions, reply to this email or contact us at
          <a href="mailto:info@thetaxpert.com">info@thetaxpert.com</a>.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="font-size:12px;color:#999">TheTaxpert · Tax &amp; Compliance Services</p>
      </div>
    `,
  });
}

export async function sendDocumentStatusEmail({
  to,
  firstName,
  documentName,
  status,
  notes,
  vaultLink,
  final,
}: {
  to: string;
  firstName: string;
  documentName: string;
  status: "approved" | "rejected";
  notes?: string;
  vaultLink?: string;
  final?: boolean; // If rejected with final=true, no re-upload CTA
}) {
  if (!resend) return;
  const isApproved = status === "approved";
  const uploadUrl = vaultLink ?? "https://thetaxpert.com/vault";
  const showReuploadCta = !isApproved && !final;
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Document ${isApproved ? "approved" : "rejected"}: ${documentName}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
        <p style="font-size:16px">Hi ${firstName},</p>
        <p>
          Your document <strong>${documentName}</strong> has been
          <strong style="color:${isApproved ? "#2f7a5b" : "#b64545"}">${isApproved ? "approved ✓" : "rejected ✕"}</strong>.
        </p>
        ${notes ? `<p style="background:#f5f5f0;padding:12px 16px;border-radius:8px;font-size:14px">Note from your Taxpert: ${notes}</p>` : ""}
        ${showReuploadCta ? `
        <p>
          <a href="${uploadUrl}"
             style="display:inline-block;background:#c49a3a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">
            Re-upload Document →
          </a>
        </p>` : ""}
        ${!isApproved && final ? `<p style="font-size:13px;color:#666">If you believe this is a mistake, reply to this email or contact <a href="mailto:info@thetaxpert.com">info@thetaxpert.com</a>.</p>` : ""}
        <p style="font-size:12px;color:#999">TheTaxpert · Tax &amp; Compliance Services</p>
      </div>
    `,
  });
}

// ── Phase 2 email templates ───────────────────────────────────

const BASE_URL = process.env.APP_URL ?? 'https://thetaxpert.com';

function emailShell(body: string) {
  return `
    <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
      ${body}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="font-size:12px;color:#999">TheTaxpert &middot; Tax &amp; Compliance Services</p>
    </div>
  `;
}

function goldButton(href: string, label: string) {
  return `<p><a href="${href}" style="display:inline-block;background:#c49a3a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">${label} &rarr;</a></p>`;
}

export async function sendTexpertAssignedEmail({
  clientEmail, clientFirstName,
  texpertEmail, texpertFirstName,
  serviceName, fiscalYear,
}: {
  clientEmail: string;  clientFirstName: string;
  texpertEmail: string; texpertFirstName: string;
  serviceName: string;  fiscalYear?: string | null;
}) {
  if (!resend) return;
  const fy = fiscalYear ? ` (${fiscalYear})` : '';

  await Promise.all([
    resend.emails.send({
      from: FROM, to: clientEmail,
      subject: `Your Taxpert has been assigned — ${serviceName}${fy}`,
      html: emailShell(`
        <p style="font-size:16px">Hi ${clientFirstName},</p>
        <p>Good news! A Taxpert has been assigned to your <strong>${serviceName}${fy}</strong> service.</p>
        <p>Your Taxpert <strong>${texpertFirstName}</strong> will review your case and reach out if anything is needed.</p>
        ${goldButton(`${BASE_URL}/dashboard/services`, 'View Service')}
      `),
    }),
    resend.emails.send({
      from: FROM, to: texpertEmail,
      subject: `New service assigned to you — ${serviceName}${fy}`,
      html: emailShell(`
        <p style="font-size:16px">Hi ${texpertFirstName},</p>
        <p>A new service has been assigned to you: <strong>${serviceName}${fy}</strong>.</p>
        <p>Please log in to review the client's documents and get started.</p>
        ${goldButton(`${BASE_URL}/dashboard/texpert/services`, 'View Assigned Services')}
      `),
    }),
  ]);
}

export async function sendReuploadRequestEmail({
  to, firstName, serviceName, documentName, note,
}: {
  to: string; firstName: string; serviceName: string; documentName: string; note?: string | null;
}) {
  if (!resend) return;
  await resend.emails.send({
    from: FROM, to,
    subject: `Action required: re-upload needed for ${serviceName}`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <p>Your Taxpert has requested a re-upload of the following document for <strong>${serviceName}</strong>:</p>
      <div style="background:#f9f5ec;border-left:3px solid #c49a3a;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0">
        <strong>${documentName}</strong>
        ${note ? `<p style="margin:8px 0 0;font-size:14px;color:#555">${note}</p>` : ''}
      </div>
      ${goldButton(`${BASE_URL}/dashboard/vault`, 'Go to Vault')}
    `),
  });
}

export async function sendAdditionalDocAddedEmail({
  to, firstName, serviceName, docName,
}: {
  to: string; firstName: string; serviceName: string; docName: string;
}) {
  if (!resend) return;
  await resend.emails.send({
    from: FROM, to,
    subject: `New document requested for ${serviceName}`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <p>Your Taxpert has added a new document slot to your <strong>${serviceName}</strong> service:</p>
      <div style="background:#f9f5ec;border-left:3px solid #c49a3a;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0">
        <strong>${docName}</strong>
      </div>
      <p>Please upload this document in your Vault to help your Taxpert proceed.</p>
      ${goldButton(`${BASE_URL}/dashboard/vault`, 'Upload Now')}
    `),
  });
}

export async function sendTexpertCredentialsEmail({
  to, firstName, email, password,
}: {
  to: string; firstName: string; email: string; password: string;
}) {
  if (!resend) return;
  await resend.emails.send({
    from: FROM, to,
    subject: 'Your TheTaxpert Taxpert account is ready',
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <p>Your Taxpert account on TheTaxpert has been created. Here are your login credentials:</p>
      <div style="background:#f9f5ec;border:1px dashed #c49a3a;border-radius:10px;padding:20px 24px;margin:20px 0">
        <p style="margin:0 0 6px;font-size:13px;color:#888">EMAIL</p>
        <p style="margin:0 0 16px;font-weight:700">${email}</p>
        <p style="margin:0 0 6px;font-size:13px;color:#888">TEMPORARY PASSWORD</p>
        <p style="margin:0;font-weight:700;letter-spacing:.05em">${password}</p>
      </div>
      <p style="color:#b64545;font-size:13px">Please change your password after first login.</p>
      ${goldButton(`${BASE_URL}/login`, 'Login Now')}
    `),
  });
}

export async function sendPayoutRecordedEmail({
  to, firstName, serviceName, amountPaise, notes,
}: {
  to: string; firstName: string; serviceName: string; amountPaise: number; notes?: string | null;
}) {
  if (!resend) return;
  const rupees = (amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  await resend.emails.send({
    from: FROM, to,
    subject: `Payout recorded — ₹${rupees} for ${serviceName}`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <p>A payout has been recorded for your completed service.</p>
      <div style="background:#f9f5ec;border-left:3px solid #2f7a5b;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0">
        <p style="margin:0 0 4px;font-size:13px;color:#888">SERVICE</p>
        <p style="margin:0 0 12px;font-weight:700">${serviceName}</p>
        <p style="margin:0 0 4px;font-size:13px;color:#888">AMOUNT</p>
        <p style="margin:0;font-size:22px;font-weight:700;color:#2f7a5b">₹${rupees}</p>
      </div>
      ${notes ? `<p style="font-size:14px;color:#555">Note: ${notes}</p>` : ''}
    `),
  });
}

export async function sendManualNotificationEmail({
  to, subject, body,
}: {
  to: string; subject: string; body: string;
}) {
  if (!resend) return;
  await resend.emails.send({
    from: FROM, to, subject,
    html: emailShell(`<p style="font-size:15px;line-height:1.6">${body}</p>`),
  });
}

export async function sendPaymentConfirmationEmail({
  to, firstName, serviceName, amountPaise, paymentId, invoiceNumber,
}: {
  to: string;
  firstName: string;
  serviceName: string;
  amountPaise: number;
  paymentId?: string | null;
  invoiceNumber?: string | null;
}) {
  if (!resend) return;
  const rupees = (amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  await resend.emails.send({
    from: FROM, to,
    subject: `Payment confirmed — ₹${rupees} for ${serviceName}`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <p>Your payment has been received. Here's a summary:</p>
      <div style="background:#f9f5ec;border-left:3px solid #2f7a5b;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0">
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Service</p>
        <p style="margin:0 0 14px;font-weight:700;font-size:16px">${serviceName}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Amount Paid</p>
        <p style="margin:0 0 14px;font-size:24px;font-weight:800;color:#2f7a5b">₹${rupees}</p>
        ${invoiceNumber ? `<p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Invoice</p><p style="margin:0 0 14px;font-weight:600">${invoiceNumber}</p>` : ''}
        ${paymentId ? `<p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Payment ID</p><p style="margin:0;font-size:12px;font-family:monospace;color:#475569">${paymentId}</p>` : ''}
      </div>
      <p style="font-size:14px;color:#555">Your Taxpert has been notified and will begin working on your service shortly.</p>
      ${goldButton(`${BASE_URL}/my-services`, 'View My Services')}
    `),
  });
}

export async function sendPaymentFailedEmail({
  to, firstName, serviceName, reason,
}: {
  to: string;
  firstName: string;
  serviceName: string;
  reason?: string | null;
}) {
  if (!resend) return;
  await resend.emails.send({
    from: FROM, to,
    subject: `Payment failed — ${serviceName}`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <p style="background:#fff3f3;border-left:3px solid #b64545;padding:10px 14px;border-radius:0 4px 4px 0;font-weight:600;color:#b64545">
        ⚠️ Your payment could not be processed
      </p>
      <p>We were unable to process your payment for <strong>${serviceName}</strong>.
         ${reason ? `Reason: ${reason}` : 'This can happen due to insufficient funds, network issues, or bank restrictions.'}</p>
      <p style="font-size:14px;color:#555">Please try again with a different payment method. Your service has not been activated.</p>
      ${goldButton(`${BASE_URL}/payments`, 'Retry Payment')}
      <p style="font-size:13px;color:#666">
        Need help? Contact us at <a href="mailto:info@thetaxpert.com" style="color:#c49a3a">info@thetaxpert.com</a>.
      </p>
    `),
  });
}

export async function sendInvoiceGeneratedEmail({
  to, firstName, serviceName, invoiceNumber, totalAmountPaise, dueDate,
}: {
  to: string;
  firstName: string;
  serviceName: string;
  invoiceNumber: string;
  totalAmountPaise: number;
  dueDate?: string | null;
}) {
  if (!resend) return;
  const rupees = (totalAmountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const due = dueDate ? new Date(dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  await resend.emails.send({
    from: FROM, to,
    subject: `Invoice ${invoiceNumber} ready — ₹${rupees} due for ${serviceName}`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <p>Your Taxpert has completed work on <strong>${serviceName}</strong> and an invoice is ready for payment.</p>
      <div style="background:#f9f5ec;border-left:3px solid #c49a3a;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0">
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Invoice</p>
        <p style="margin:0 0 14px;font-weight:700">${invoiceNumber}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Amount Due</p>
        <p style="margin:0 0 ${due ? '14px' : '0'};font-size:24px;font-weight:800;color:#c49a3a">₹${rupees}</p>
        ${due ? `<p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Due Date</p><p style="margin:0;font-weight:600;color:#b45309">${due}</p>` : ''}
      </div>
      ${goldButton(`${BASE_URL}/payments`, 'Pay Now')}
      <p style="font-size:13px;color:#666">
        Questions about this invoice? Contact us at <a href="mailto:info@thetaxpert.com" style="color:#c49a3a">info@thetaxpert.com</a>.
      </p>
    `),
  });
}

export async function sendCouponIssuedEmail({
  to, firstName, couponCode, description, validUntil,
}: {
  to: string;
  firstName: string;
  couponCode: string;
  description: string;
  validUntil?: string | null;
}) {
  if (!resend) return;
  const expiry = validUntil ? new Date(validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  await resend.emails.send({
    from: FROM, to,
    subject: `You've received a discount coupon — ${couponCode}`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <p>A discount coupon has been issued to your account by TheTaxpert:</p>
      <div style="background:#f9f5ec;border:1px dashed #c49a3a;border-radius:10px;padding:20px 24px;text-align:center;margin:20px 0">
        <p style="margin:0 0 6px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.08em">Your Coupon Code</p>
        <p style="margin:0 0 8px;font-size:28px;font-weight:800;letter-spacing:.12em;color:#1a1a2e">${couponCode}</p>
        <p style="margin:0;font-size:14px;color:#555">${description}</p>
        ${expiry ? `<p style="margin:8px 0 0;font-size:12px;color:#888">Valid until ${expiry}</p>` : ''}
      </div>
      <p style="font-size:14px;color:#555">Apply this code at checkout when paying for your next service.</p>
      ${goldButton(`${BASE_URL}/payments`, 'Use Coupon')}
    `),
  });
}

export async function sendPaymentOverdueEmail({
  to, firstName, serviceName, invoiceNumber, totalAmountPaise, daysOverdue, payLink,
}: {
  to: string;
  firstName: string;
  serviceName: string;
  invoiceNumber: string;
  totalAmountPaise: number;
  daysOverdue: number;
  payLink: string;
}) {
  if (!resend) return;
  const rupees = (totalAmountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  await resend.emails.send({
    from: FROM, to,
    subject: `Payment overdue — Invoice ${invoiceNumber} for ${serviceName}`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <div style="background:#fff3f3;border-left:3px solid #b64545;padding:12px 16px;border-radius:0 8px 8px 0;margin:0 0 20px">
        <p style="margin:0;font-weight:700;color:#b64545">⚠️ Payment overdue by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}</p>
      </div>
      <p>Your invoice for <strong>${serviceName}</strong> was due for payment and has not been settled yet.</p>
      <div style="background:#f9f5ec;border-left:3px solid #c49a3a;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0">
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Invoice</p>
        <p style="margin:0 0 14px;font-weight:700">${invoiceNumber}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Amount Due</p>
        <p style="margin:0;font-size:24px;font-weight:800;color:#c49a3a">₹${rupees}</p>
      </div>
      <p>Please complete your payment at the earliest to avoid any disruption to your service.</p>
      ${goldButton(payLink, 'Pay Now →')}
      <p style="font-size:13px;color:#666;margin-top:20px">
        If you have already made the payment or have a query, please reply to this email or contact us at
        <a href="mailto:info@thetaxpert.com" style="color:#c49a3a">info@thetaxpert.com</a>.
      </p>
    `),
  });
}

export async function sendPaymentOverdueEscalationEmail({
  to, firstName, serviceName, invoiceNumber, totalAmountPaise, daysOverdue, payLink,
}: {
  to: string;
  firstName: string;
  serviceName: string;
  invoiceNumber: string;
  totalAmountPaise: number;
  daysOverdue: number;
  payLink: string;
}) {
  if (!resend) return;
  const rupees = (totalAmountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  await resend.emails.send({
    from: FROM, to,
    subject: `Urgent: Invoice ${invoiceNumber} is ${daysOverdue} days overdue — action required`,
    html: emailShell(`
      <p style="font-size:16px">Hi ${firstName},</p>
      <div style="background:#fff3f3;border-left:3px solid #b64545;padding:12px 16px;border-radius:0 8px 8px 0;margin:0 0 20px">
        <p style="margin:0;font-weight:700;color:#b64545">🚨 Invoice ${daysOverdue} days overdue — urgent action required</p>
      </div>
      <p>We have still not received payment for your <strong>${serviceName}</strong> invoice (${invoiceNumber}). This invoice is now <strong>${daysOverdue} days past its due date</strong>.</p>
      <div style="background:#f9f5ec;border-left:3px solid #c49a3a;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0">
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.05em">Outstanding Amount</p>
        <p style="margin:0;font-size:24px;font-weight:800;color:#c49a3a">₹${rupees}</p>
      </div>
      <p>Please settle this immediately. Continued non-payment may affect your service status.</p>
      ${goldButton(payLink, 'Pay Now →')}
      <p style="font-size:13px;color:#666;margin-top:20px">
        If you believe this is an error or need to discuss payment, please contact us immediately at
        <a href="mailto:info@thetaxpert.com" style="color:#c49a3a">info@thetaxpert.com</a>.
      </p>
    `),
  });
}
