// ── Compliance Due Dates Engine ───────────────────────────────
// Maps service slugs to their statutory compliance deadlines.
// Dates are computed relative to the current year/FY.

export interface DueDate {
  id: string;
  label: string;
  description: string;
  date: Date;
  serviceSlug: string;
  serviceName: string;
  urgency: "overdue" | "urgent" | "upcoming" | "later"; // <7d, 7-30d, 30-60d, >60d
}

interface RawDate {
  label: string;
  description: string;
  month: number; // 1-12
  day: number;
  // For monthly recurring, pass month: 0 (special case)
  recurring?: "monthly" | "quarterly" | "annual";
  quarterMonths?: number[]; // for quarterly
}

const SERVICE_CALENDAR: Record<string, RawDate[]> = {
  "income-tax-individuals": [
    { label: "ITR Filing Deadline", description: "Last date to file income tax return (individuals & HUF)", month: 7, day: 31, recurring: "annual" },
    { label: "Advance Tax — Q1 (15%)", description: "First instalment of advance tax", month: 6, day: 15, recurring: "annual" },
    { label: "Advance Tax — Q2 (45%)", description: "Second instalment of advance tax", month: 9, day: 15, recurring: "annual" },
    { label: "Advance Tax — Q3 (75%)", description: "Third instalment of advance tax", month: 12, day: 15, recurring: "annual" },
    { label: "Advance Tax — Q4 (100%)", description: "Final instalment of advance tax", month: 3, day: 15, recurring: "annual" },
  ],
  "income-tax-companies": [
    { label: "ITR Filing — Companies", description: "Income tax return for companies (non-audit)", month: 9, day: 30, recurring: "annual" },
    { label: "Tax Audit Report (Form 3CA/3CB)", description: "Tax audit completion deadline", month: 9, day: 30, recurring: "annual" },
    { label: "Advance Tax — Q1 (15%)", description: "First instalment", month: 6, day: 15, recurring: "annual" },
    { label: "Advance Tax — Q2 (45%)", description: "Second instalment", month: 9, day: 15, recurring: "annual" },
    { label: "Advance Tax — Q3 (75%)", description: "Third instalment", month: 12, day: 15, recurring: "annual" },
    { label: "Advance Tax — Q4 (100%)", description: "Final instalment", month: 3, day: 15, recurring: "annual" },
  ],
  "income-tax-llps": [
    { label: "ITR Filing — LLPs", description: "Income tax return for LLPs", month: 9, day: 30, recurring: "annual" },
    { label: "Advance Tax — Q1 (15%)", description: "First instalment", month: 6, day: 15, recurring: "annual" },
    { label: "Advance Tax — Q3 (75%)", description: "Third instalment", month: 12, day: 15, recurring: "annual" },
    { label: "Advance Tax — Q4 (100%)", description: "Final instalment", month: 3, day: 15, recurring: "annual" },
  ],
  "gst-registration": [
    { label: "GSTR-3B (Monthly)", description: "GST summary return — due 20th every month", month: 0, day: 20, recurring: "monthly" },
    { label: "GSTR-1 (Monthly)", description: "Outward supply details — due 11th every month", month: 0, day: 11, recurring: "monthly" },
  ],
  "gst-monthly-quarterly": [
    { label: "GSTR-3B (Monthly)", description: "GST summary return — due 20th every month", month: 0, day: 20, recurring: "monthly" },
    { label: "GSTR-1 (Monthly)", description: "Outward supply details — due 11th every month", month: 0, day: 11, recurring: "monthly" },
  ],
  "gst-annual-returns": [
    { label: "GSTR-9 Annual Return", description: "Annual GST return due 31st December", month: 12, day: 31, recurring: "annual" },
    { label: "GSTR-9C Reconciliation", description: "GST audit reconciliation statement", month: 12, day: 31, recurring: "annual" },
  ],
  "tds-returns-filing": [
    { label: "TDS Return — Q1 (Apr-Jun)", description: "Form 24Q/26Q for quarter 1", month: 7, day: 31, recurring: "annual" },
    { label: "TDS Return — Q2 (Jul-Sep)", description: "Form 24Q/26Q for quarter 2", month: 10, day: 31, recurring: "annual" },
    { label: "TDS Return — Q3 (Oct-Dec)", description: "Form 24Q/26Q for quarter 3", month: 1, day: 31, recurring: "annual" },
    { label: "TDS Return — Q4 (Jan-Mar)", description: "Form 24Q/26Q for quarter 4", month: 5, day: 31, recurring: "annual" },
  ],
  "private-limited-company": [
    { label: "DIR-3 KYC", description: "Annual KYC for directors — 30th September", month: 9, day: 30, recurring: "annual" },
    { label: "AOC-4 (Annual Accounts)", description: "Filing of financial statements with ROC", month: 10, day: 29, recurring: "annual" },
    { label: "MGT-7 (Annual Return)", description: "Annual return filing with ROC", month: 11, day: 28, recurring: "annual" },
    { label: "Advance Tax — Q2", description: "45% of advance tax liability", month: 9, day: 15, recurring: "annual" },
  ],
  "llp": [
    { label: "DIR-3 KYC", description: "Annual KYC for designated partners", month: 9, day: 30, recurring: "annual" },
    { label: "LLP Form 8 (Statement of Solvency)", description: "Filed within 30 days of end of 6 months", month: 10, day: 30, recurring: "annual" },
    { label: "LLP Form 11 (Annual Return)", description: "Annual return within 60 days of FY end", month: 5, day: 30, recurring: "annual" },
  ],
  "section-8-company": [
    { label: "DIR-3 KYC", description: "Annual KYC for directors", month: 9, day: 30, recurring: "annual" },
    { label: "AOC-4 (Annual Accounts)", description: "Filing of financial statements", month: 10, day: 29, recurring: "annual" },
    { label: "MGT-7 (Annual Return)", description: "Annual return filing with ROC", month: 11, day: 28, recurring: "annual" },
  ],
  "dir-3-kyc": [
    { label: "DIR-3 KYC Deadline", description: "Annual KYC for directors — mandatory every year", month: 9, day: 30, recurring: "annual" },
  ],
  "aoc-4": [
    { label: "AOC-4 Filing Deadline", description: "Annual financial statements with ROC", month: 10, day: 29, recurring: "annual" },
  ],
  "mgt-7": [
    { label: "MGT-7 Filing Deadline", description: "Annual return with ROC — 60 days from AGM", month: 11, day: 28, recurring: "annual" },
  ],
  "payroll-processing": [
    { label: "Provident Fund Deposit", description: "Monthly PF contribution due 15th", month: 0, day: 15, recurring: "monthly" },
    { label: "ESI Deposit", description: "Monthly ESI contribution due 15th", month: 0, day: 15, recurring: "monthly" },
    { label: "Professional Tax (State)", description: "Monthly PT filing", month: 0, day: 15, recurring: "monthly" },
  ],
  "monthly-accounting": [
    { label: "GSTR-3B (Monthly)", description: "GST summary return — due 20th", month: 0, day: 20, recurring: "monthly" },
    { label: "TDS Deposit", description: "Monthly TDS deposit deadline 7th", month: 0, day: 7, recurring: "monthly" },
  ],
};

function getUrgency(date: Date): DueDate["urgency"] {
  const diff = date.getTime() - Date.now();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 0) return "overdue";
  if (days <= 7) return "urgent";
  if (days <= 30) return "upcoming";
  return "later";
}

function buildDates(
  slug: string,
  serviceName: string,
  rawDates: RawDate[],
  windowMonths = 6
): DueDate[] {
  const now = new Date();
  const results: DueDate[] = [];

  for (const rd of rawDates) {
    if (rd.recurring === "monthly") {
      // Generate next 6 months of occurrences
      for (let i = 0; i < windowMonths; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, rd.day);
        if (d >= new Date(now.getFullYear(), now.getMonth() - 1, 1)) {
          results.push({
            id: `${slug}-${rd.label}-${d.getTime()}`,
            label: rd.label,
            description: rd.description,
            date: d,
            serviceSlug: slug,
            serviceName,
            urgency: getUrgency(d),
          });
        }
      }
    } else {
      // Annual / quarterly — try current year, then next year
      for (const yr of [now.getFullYear(), now.getFullYear() + 1]) {
        const d = new Date(yr, rd.month - 1, rd.day);
        const cutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        if (d >= cutoff) {
          results.push({
            id: `${slug}-${rd.label}-${yr}`,
            label: rd.label,
            description: rd.description,
            date: d,
            serviceSlug: slug,
            serviceName,
            urgency: getUrgency(d),
          });
          break; // only add the nearest upcoming occurrence
        }
      }
    }
  }

  return results;
}

export function computeClientDueDates(
  activeServices: Array<{ slug: string; name: string }>,
  windowMonths = 6
): DueDate[] {
  const all: DueDate[] = [];
  for (const svc of activeServices) {
    const raw = SERVICE_CALENDAR[svc.slug];
    if (raw) {
      all.push(...buildDates(svc.slug, svc.name, raw, windowMonths));
    }
  }
  // Sort by date ascending
  return all.sort((a, b) => a.date.getTime() - b.date.getTime());
}
