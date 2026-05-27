import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminRole, isStaffRole } from "../shared/types";

export async function getAssignedClientIds(
  supabase: SupabaseClient,
  assigneeId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("ca_assignments")
    .select("client_id")
    .eq("ca_id", assigneeId);

  if (error || !data) return [];
  return data.map((row) => row.client_id as string);
}

export async function canAccessClientServiceRecord(
  supabase: SupabaseClient,
  input: {
    viewerId: string;
    viewerRole: string | null | undefined;
    serviceUserId: string;
    assignedTo?: string | null;
  },
): Promise<boolean> {
  if (isAdminRole(input.viewerRole)) return true;
  if (!isStaffRole(input.viewerRole)) return input.viewerId === input.serviceUserId;
  if (input.assignedTo === input.viewerId) return true;

  const assignedClientIds = await getAssignedClientIds(supabase, input.viewerId);
  return assignedClientIds.includes(input.serviceUserId);
}
