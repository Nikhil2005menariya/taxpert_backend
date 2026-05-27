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
}: {
  to: string;
  firstName: string;
  documentName: string;
  status: "approved" | "rejected";
  notes?: string;
  vaultLink?: string;
}) {
  if (!resend) return;
  const isApproved = status === "approved";
  const uploadUrl = vaultLink ?? "https://thetaxpert.com/vault";
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
        ${notes ? `<p style="background:#f5f5f0;padding:12px 16px;border-radius:8px;font-size:14px">Note: ${notes}</p>` : ""}
        ${!isApproved ? `
        <p>
          <a href="${uploadUrl}"
             style="display:inline-block;background:#c49a3a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600">
            Re-upload Document →
          </a>
        </p>` : ""}
        <p style="font-size:12px;color:#999">TheTaxpert · Tax &amp; Compliance Services</p>
      </div>
    `,
  });
}
