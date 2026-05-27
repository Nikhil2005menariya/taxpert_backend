import { SupabaseClient } from "@supabase/supabase-js";

export async function autoAssignTaxpert(supabase: SupabaseClient, clientUserId: string): Promise<{
  error: string | null;
  assigned: boolean;
  taxpertName?: string;
}> {
  // Return early if the client already has an assignment
  const { data: existing } = await supabase
    .from("ca_assignments")
    .select("ca_id, ca:users!ca_assignments_ca_id_fkey(first_name, last_name)")
    .eq("client_id", clientUserId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const ca = (Array.isArray(existing.ca) ? existing.ca[0] : existing.ca) as
      | { first_name: string; last_name: string }
      | null;
    return {
      error: null,
      assigned: false,
      taxpertName: ca ? `${ca.first_name} ${ca.last_name}` : undefined,
    };
  }

  // Fetch all active Taxperts
  const { data: taxperts, error: taxpertsErr } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .in("role", ["expert", "ca"])
    .eq("is_active", true);

  if (taxpertsErr || !taxperts?.length) {
    return { error: "No Taxperts available", assigned: false };
  }

  // Count existing assignments per Taxpert (single query)
  const { data: assignments } = await supabase
    .from("ca_assignments")
    .select("ca_id")
    .in("ca_id", taxperts.map((t) => t.id));

  const loadMap = new Map<string, number>();
  for (const t of taxperts) loadMap.set(t.id, 0);
  for (const a of assignments ?? []) {
    loadMap.set(a.ca_id, (loadMap.get(a.ca_id) ?? 0) + 1);
  }

  // Pick the least-loaded Taxpert
  const chosen = taxperts.reduce((best, t) =>
    (loadMap.get(t.id) ?? 0) < (loadMap.get(best.id) ?? 0) ? t : best
  );

  const { error: insertErr } = await supabase
    .from("ca_assignments")
    .insert({ ca_id: chosen.id, client_id: clientUserId });

  if (insertErr) {
    return { error: insertErr.message, assigned: false };
  }

  return {
    error: null,
    assigned: true,
    taxpertName: `${chosen.first_name} ${chosen.last_name}`,
  };
}
