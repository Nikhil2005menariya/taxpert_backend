export type UserRole = "super_admin" | "admin" | "expert" | "ca" | "staff" | "client";
export const USER_ROLES: UserRole[] = ["super_admin", "admin", "expert", "ca", "staff", "client"];

export function normalizeRole(role: string | null | undefined): UserRole {
  return USER_ROLES.includes((role ?? "client") as UserRole) ? (role as UserRole) : "client";
}

export function isAdminRole(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  return normalized === "super_admin" || normalized === "admin";
}

export function isStaffRole(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  return normalized !== "client";
}

export function isTaxExpertRole(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  return normalized === "expert" || normalized === "ca";
}

export function isInternalOperatorRole(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  return normalized === "expert" || normalized === "ca" || normalized === "staff";
}

export function getRoleLabel(role: string | null | undefined) {
  switch (normalizeRole(role)) {
    case "super_admin":
      return "Super Admin";
    case "admin":
      return "Admin";
    case "expert":
    case "ca":
      return "Taxpert";
    case "staff":
      return "Staff";
    default:
      return "Client";
  }
}

// ── Service Status ────────────────────────────────────────────
// Canonical enum. Run migrations/rename-invoice-pending-to-payment.sql first.
// Flow: pending → documents_required → documents_received → in_progress → under_review → payment → completed
export type ServiceStatus =
  | "pending"
  | "documents_required"
  | "documents_received"
  | "in_progress"
  | "under_review"
  | "payment"
  | "completed"
  | "on_hold"
  | "cancelled";

export const SERVICE_STATUSES: ServiceStatus[] = [
  "pending",
  "documents_required",
  "documents_received",
  "in_progress",
  "under_review",
  "payment",
  "completed",
  "on_hold",
  "cancelled",
];

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  pending: "Pending",
  documents_required: "Documents Required",
  documents_received: "Documents Received",
  in_progress: "In Progress",
  under_review: "Under Review",
  payment: "Payment",
  completed: "Completed",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

export const SERVICE_STATUS_SHORT_LABELS: Record<ServiceStatus, string> = {
  pending: "Pending",
  documents_required: "Docs Required",
  documents_received: "Docs Received",
  in_progress: "In Progress",
  under_review: "Under Review",
  payment: "Payment",
  completed: "Completed",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

export const SERVICE_STATUS_STYLES: Record<ServiceStatus, { bg: string; fg: string }> = {
  pending: { bg: "var(--ink-50)", fg: "var(--ink-500)" },
  documents_required: { bg: "rgba(220,38,38,0.08)", fg: "#dc2626" },
  documents_received: { bg: "rgba(80,120,200,0.1)", fg: "#3a5fc4" },
  in_progress: { bg: "rgba(80,120,200,0.12)", fg: "#3a5fc4" },
  under_review: { bg: "rgba(130,80,200,0.1)", fg: "#7a3fc4" },
  payment: { bg: "rgba(245,158,11,0.12)", fg: "#b45309" },
  completed: { bg: "rgba(47,122,91,0.1)", fg: "var(--green-600)" },
  on_hold: { bg: "rgba(182,69,69,0.08)", fg: "var(--danger)" },
  cancelled: { bg: "rgba(182,69,69,0.08)", fg: "var(--danger)" },
};

/** @deprecated Use ServiceStatus */
export type ClientServiceStatus = ServiceStatus;

// ── Document Status ───────────────────────────────────────────
export type DocumentStatus =
  | "pending"
  | "uploaded"
  | "under_review"
  | "approved"
  | "rejected"
  | "expired";

export const DOCUMENT_STATUSES: DocumentStatus[] = [
  "pending",
  "uploaded",
  "under_review",
  "approved",
  "rejected",
  "expired",
];

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: "Pending upload",
  uploaded: "Uploaded",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected - please re-upload",
  expired: "Expired - please re-upload",
};

/** @deprecated Use DocumentStatus */
export type ClientDocumentStatus = DocumentStatus;

// ── Legacy filing types (deprecated, keep only until removal is complete) ──
export type FilingStatus = "uploaded" | "processing" | "reviewed" | "filed" | "documents_required";
/** @deprecated Use DocumentType from config-driven engine */
export type LegacyDocumentType = "form16" | "form26as" | "other";

// ── User ─────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  mobile: string;
  pan: string;
  role: UserRole;
  created_at: string;
}

export interface CaAssignment {
  ca_id: string;
  client_id: string;
  assigned_at: string;
  user?: UserProfile;
}

// ── Services & Documents ──────────────────────────────────────

export interface Service {
  id: string;
  slug: string;
  name: string;
  category: string;
  is_active: boolean;
  created_at: string;
}

export interface DocumentTemplate {
  id: string;
  service_id: string;
  name: string;
  description: string | null;
  type: "basic" | "conditional";
  required: boolean;
  sort_order: number;
}

export interface ClientService {
  id: string;
  user_id: string;
  service_id: string;
  status: ServiceStatus;
  fiscal_year: string | null;
  assigned_by: string | null;
  assigned_to: string | null;
  notes: string | null;
  status_updated_at: string | null;
  payment_status?: string | null;
  payment_id?: string | null;
  razorpay_order_id?: string | null;
  created_at: string;
  updated_at: string;
  service?: Service;
  client_documents?: ClientDocument[];
}

export interface ClientDocument {
  id: string;
  client_service_id: string;
  template_id: string | null;
  document_name: string;
  status: DocumentStatus;
  file_url: string | null;
  file_path: string | null;
  notes: string | null;
  uploaded_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
}

export type ServiceTaskStatus = "pending" | "in_progress" | "blocked" | "done" | "cancelled";
export type ServiceTaskScope = "client" | "internal";
export type ServiceEventType =
  | "service_created"
  | "status_changed"
  | "document_uploaded"
  | "document_approved"
  | "document_rejected"
  | "optional_document_added"
  | "payment_recorded"
  | "deletion_requested"
  | "deletion_request_cancelled"
  | "deletion_approved"
  | "deletion_rejected"
  | "workspace_bootstrapped";
export type DueDateStatus = "open" | "completed" | "dismissed";
export type AssignmentQueueStatus = "open" | "claimed" | "closed";
export type SlaSeverity = "warning" | "breach" | "critical";

export interface ServiceTask {
  id: string;
  client_service_id: string;
  title: string;
  description: string | null;
  task_type: string;
  scope: ServiceTaskScope;
  status: ServiceTaskStatus;
  owner_user_id: string | null;
  due_at: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at?: string | null;
}

export interface ServiceEvent {
  id: string;
  client_service_id: string;
  event_type: ServiceEventType | string;
  actor_user_id: string | null;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ServiceDueDate {
  id: string;
  client_service_id: string;
  title: string;
  description: string | null;
  due_at: string;
  status: DueDateStatus;
  source_key: string;
  created_at: string;
  completed_at?: string | null;
}

export interface AssignmentQueueItem {
  id: string;
  client_service_id: string;
  queue_name: string;
  priority: number;
  status: AssignmentQueueStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface SlaBreach {
  id: string;
  client_service_id: string;
  task_id: string | null;
  severity: SlaSeverity;
  starts_at: string;
  breach_at: string;
  resolved_at: string | null;
}

// ── Config-Driven Service Engine ─────────────────────────────

export interface ServiceCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface DocumentType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_common_document: boolean;
  allowed_extensions: string[];
  max_file_size_mb: number;
  is_active: boolean;
  created_at: string;
}

export interface ServiceDocumentRequirement {
  id: string;
  service_id: string;
  document_type_id: string;
  is_required: boolean;
  is_optional: boolean;
  requires_fy: boolean;
  sort_order: number;
  created_at: string;
  document_type?: DocumentType;
}

export interface ServiceDueDateTemplate {
  id: string;
  service_id: string;
  title: string;
  description: string | null;
  recurrence_type: 'annual' | 'monthly' | 'quarterly';
  applicable_month: number | null;
  applicable_day: number;
  applicable_quarter_months: number[] | null;
  is_active: boolean;
  created_at: string;
}

/** Extended Service — includes new config columns */
export interface ServiceConfig {
  id: string;
  slug: string;
  name: string;
  category: string; // legacy text field
  category_id: string | null;
  description: string | null;
  summary: string | null;
  price: number;
  is_active: boolean;
  requires_fy: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  service_category?: ServiceCategory | null;
  service_document_requirements?: ServiceDocumentRequirement[];
  service_due_date_templates?: ServiceDueDateTemplate[];
}

// ── Payments ──────────────────────────────────────────────────

export type CouponType = "flat" | "percent";

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: CouponType;
  value: number;
  min_order: number;
  max_discount: number | null;
  usage_limit: number | null;
  used_count: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  is_referral: boolean;
  for_user_id: string | null;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_id: string;
  referred_id: string;
  referral_code: string;
  status: "pending" | "converted" | "rewarded";
  reward_amount: number | null;
  reward_coupon_id: string | null;
  converted_at: string | null;
  rewarded_at: string | null;
  created_at: string;
}
