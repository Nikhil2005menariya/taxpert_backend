import { normalizeRole, type UserRole } from "./types";

export type Permission =
  | "manage_users"
  | "manage_services"
  | "manage_payments"
  | "manage_coupons"
  | "view_analytics"
  | "view_documents"
  | "update_status";

export const ALL_PERMISSIONS: Permission[] = [
  "manage_users",
  "manage_services",
  "manage_payments",
  "manage_coupons",
  "view_analytics",
  "view_documents",
  "update_status",
];

export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  manage_users:    { label: "Manage Users",    description: "Create, edit, and manage user accounts and roles" },
  manage_services: { label: "Manage Services", description: "Create and update client service assignments and workflows" },
  manage_payments: { label: "Manage Payments", description: "View all payments, export GST worksheets, manage pricing" },
  manage_coupons:  { label: "Manage Coupons",  description: "Create, toggle, and manage discount coupons and referrals" },
  view_analytics:  { label: "View Analytics",  description: "Access platform-wide analytics and reports" },
  view_documents:  { label: "View Documents",  description: "Access and review client-uploaded documents" },
  update_status:   { label: "Update Status",   description: "Advance workflows and update filing/service statuses" },
};

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: ["manage_users", "manage_services", "manage_payments", "manage_coupons", "view_analytics", "view_documents", "update_status"],
  admin:       ["manage_users", "manage_services", "manage_payments", "manage_coupons", "view_analytics", "view_documents", "update_status"],
  expert:      ["manage_services", "view_documents", "update_status"],
  ca:          ["manage_services", "view_documents", "update_status"],
  staff:       ["view_documents", "update_status"],
  client:      [],
};

/** Base permissions for a role (no overrides). */
export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  return ROLE_PERMISSIONS[normalizeRole(role)].includes(permission);
}

/** Base permissions list for a role (no overrides). */
export function getPermissions(role: string | null | undefined): Permission[] {
  return ROLE_PERMISSIONS[normalizeRole(role)];
}

/**
 * Compute effective permissions for a user given their role and any
 * granted/revoked overrides set by super_admin.
 *
 * - super_admin and admin always keep ALL permissions (overrides ignored for them)
 * - For other roles: start with role defaults, add granted, subtract revoked
 */
export function computeEffectivePermissions(
  role: string,
  granted: Permission[],
  revoked: Permission[],
): Permission[] {
  const normalizedRole = normalizeRole(role);

  // Admins always have full permissions — overrides don't apply
  if (normalizedRole === "super_admin" || normalizedRole === "admin") {
    return ROLE_PERMISSIONS[normalizedRole];
  }

  const base = new Set<Permission>(ROLE_PERMISSIONS[normalizedRole] ?? []);

  // Add granted
  for (const p of granted) {
    if (ALL_PERMISSIONS.includes(p)) base.add(p);
  }

  // Remove revoked
  for (const p of revoked) {
    base.delete(p);
  }

  return Array.from(base);
}
