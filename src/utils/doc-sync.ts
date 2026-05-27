/**
 * doc-sync.ts
 *
 * Bidirectional sync utility between `common_documents` and `client_documents`.
 *
 * The platform has two document storage layers:
 *   - common_documents : PAN, Aadhaar, DSC etc. shared across all services
 *   - client_documents : per-service checklist rows
 *
 * This module ensures:
 *   A) When a common doc is uploaded  → propagate to all matching pending service docs
 *   B) When a service doc is uploaded → mirror to common_documents if it's a common type
 *   C) When a new service is assigned → pre-fill matching docs from existing common docs
 *
 * Adding new common doc types:
 *   Add a new key + aliases to COMMON_DOC_ALIASES below.
 *   The key MUST match the `document_type` value stored in the `common_documents` table.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ─── Alias map ────────────────────────────────────────────────────────────────
// Keys  = canonical document_type stored in common_documents
// Values = all normalized name variants that should match this type
//
// To add a new admin-defined common doc type, append a new entry here.
export const COMMON_DOC_ALIASES: Record<string, string[]> = {
  pan: [
    'pan', 'pancard', 'pancardcopy', 'permanentaccountnumber', 'pancopy',
  ],
  aadhaar: [
    'aadhaar', 'aadhar', 'adhar', 'aadhaarcard', 'aadharcard',
    'uid', 'uidcard', 'aadhaarno', 'aadharnumber',
  ],
  dsc: [
    'dsc', 'digitalsignature', 'digitalsignaturecertificate', 'dsctoken',
    'dscdongle', 'digitalsignaturecard',
  ],
  bank_proof: [
    'bankproof', 'bankstatement', 'cancelledcheque', 'cancelcheque',
    'bankpassbook', 'bankproofdocument', 'bankdetails', 'bankaccount',
    'bankaccountproof',
  ],
  form16: [
    'form16', 'form16partapartb', 'form16parta', 'form16partb',
    'tdsform16', 'form16tds',
  ],
  form26as: [
    'form26as', 'annualinformationstatement', 'ais', 'taxcreditstatement',
    'form26', '26as',
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip all non-alphanumeric chars and lowercase — used for fuzzy matching */
export function normalizeDocName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Returns the canonical common_documents.document_type key if the given
 * document name matches one of the known common types, otherwise null.
 */
export function resolveCommonDocType(docName: string): string | null {
  const n = normalizeDocName(docName);
  for (const [type, aliases] of Object.entries(COMMON_DOC_ALIASES)) {
    if (aliases.some(a => n === a || n.includes(a) || a.includes(n))) {
      return type;
    }
  }
  return null;
}

/**
 * Tests whether two document names refer to the same common doc type.
 */
function namesMatch(docName: string, aliases: string[]): boolean {
  const n = normalizeDocName(docName);
  return aliases.some(a => n === a || n.includes(a) || a.includes(n));
}

// ─── Propagation helpers ─────────────────────────────────────────────────────

/**
 * Fix A — Common doc upload → mark matching pending service docs as uploaded.
 *
 * Called after uploadCommonDocument succeeds.
 * Finds all pending client_documents for active services owned by the user
 * whose document_name matches the uploaded common doc type, and marks them uploaded.
 */
export async function propagateCommonDocToServices(
  supabase: SupabaseClient,
  userId: string,
  docType: string,
  filePath: string,
  uploadedAt: string,
): Promise<void> {
  try {
    const aliases = COMMON_DOC_ALIASES[docType];
    if (!aliases?.length) return; // unknown type — nothing to propagate

    // Active services for this user
    const { data: activeServices } = await supabase
      .from('client_services')
      .select('id')
      .eq('user_id', userId)
      .not('status', 'in', '(completed,cancelled)');

    if (!activeServices?.length) return;

    const serviceIds = activeServices.map((s: any) => s.id);

    // All pending docs across those services
    const { data: pendingDocs } = await supabase
      .from('client_documents')
      .select('id, document_name')
      .in('client_service_id', serviceIds)
      .eq('status', 'pending');

    if (!pendingDocs?.length) return;

    const matchingIds = (pendingDocs as any[])
      .filter(doc => namesMatch(doc.document_name, aliases))
      .map(doc => doc.id);

    if (!matchingIds.length) return;

    await supabase
      .from('client_documents')
      .update({
        status: 'uploaded',
        file_path: filePath,
        uploaded_at: uploadedAt,
      })
      .in('id', matchingIds);

  } catch (err) {
    // Non-fatal — log but do not surface to caller
    console.error('[doc-sync] propagateCommonDocToServices error:', err);
  }
}

/**
 * Fix C — New service assigned → pre-fill pending docs from existing common docs.
 *
 * Called right after client_documents rows are inserted for a new service.
 * Queries the user's common_documents and marks any already-uploaded matching
 * docs as uploaded immediately, so the user doesn't have to upload them again.
 */
export async function prefillServiceDocsFromCommon(
  supabase: SupabaseClient,
  userId: string,
  clientServiceId: string,
): Promise<void> {
  try {
    const { data: commonDocs } = await supabase
      .from('common_documents')
      .select('document_type, file_path, created_at')
      .eq('user_id', userId);

    if (!commonDocs?.length) return;

    const { data: pendingDocs } = await supabase
      .from('client_documents')
      .select('id, document_name')
      .eq('client_service_id', clientServiceId)
      .eq('status', 'pending');

    if (!pendingDocs?.length) return;

    // Match each common doc against pending service docs
    for (const commonDoc of commonDocs as any[]) {
      const aliases = COMMON_DOC_ALIASES[commonDoc.document_type];
      if (!aliases?.length) continue;

      const matchingIds = (pendingDocs as any[])
        .filter(doc => namesMatch(doc.document_name, aliases))
        .map(doc => doc.id);

      if (!matchingIds.length) continue;

      await supabase
        .from('client_documents')
        .update({
          status: 'uploaded',
          file_path: commonDoc.file_path,
          uploaded_at: commonDoc.created_at,
        })
        .in('id', matchingIds);
    }
  } catch (err) {
    console.error('[doc-sync] prefillServiceDocsFromCommon error:', err);
  }
}

/**
 * Fix B — Service doc upload → mirror to common_documents if it's a known common type.
 *
 * Called after uploadDocument (service-specific) succeeds.
 * If the uploaded document name resolves to a known common doc type, it upserts
 * a matching record in common_documents so the user doesn't have to re-upload it
 * in the Common Docs section, and future services are pre-filled automatically.
 */
export async function mirrorServiceDocToCommon(
  supabase: SupabaseClient,
  userId: string,
  documentName: string,
  filePath: string,
  uploadedAt: string,
  pan: string,
): Promise<void> {
  try {
    const docType = resolveCommonDocType(documentName);
    if (!docType) return; // not a common doc type — nothing to mirror

    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'pdf';
    const safeType = docType.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const storedFilename = `${pan}_${safeType}.${ext}`;
    const commonFilePath = `${userId}/common/${storedFilename}`;

    // Copy the file in storage to the common path (upsert)
    // We copy so the original service-path file is not lost
    await supabase.storage
      .from('client-docs')
      .copy(filePath, commonFilePath);

    // Upsert the common_documents record
    await supabase
      .from('common_documents')
      .upsert(
        {
          user_id: userId,
          document_type: docType,
          document_name: documentName,
          file_path: commonFilePath,
          file_url: null,
          original_filename: documentName,
          stored_filename: storedFilename,
          updated_at: uploadedAt,
        },
        { onConflict: 'user_id,document_type' },
      );

    // Now propagate this common doc to all other active services too
    await propagateCommonDocToServices(supabase, userId, docType, filePath, uploadedAt);

  } catch (err) {
    console.error('[doc-sync] mirrorServiceDocToCommon error:', err);
  }
}
