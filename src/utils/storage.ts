import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "../shared/roles";
import { storageConfig } from "../configs/storage.config";

const DOCUMENT_BUCKET = storageConfig.bucketName;
const SIGNED_URL_TTL_SECONDS = storageConfig.defaultExpirySeconds;

type ViewerContext = {
  userId: string;
  role: UserRole;
};

type DocumentAccessInput =
  | { kind: "client_document"; documentId: string }
  | { kind: "common_document"; documentId: string };

type ClientDocumentAccessRow = {
  file_path: string | null;
  client_services: { user_id: string } | { user_id: string }[] | null;
};

async function resolveFilePath(
  supabase: SupabaseClient,
  viewer: ViewerContext,
  input: DocumentAccessInput,
) {
  if (input.kind === "client_document") {
    const { data, error } = await supabase
      .from("client_documents")
      .select("id, file_path, client_services!inner(user_id)")
      .eq("id", input.documentId)
      .maybeSingle<ClientDocumentAccessRow>();

    if (error || !data?.file_path) return { filePath: null, error: "Document not found" };

    const clientService = Array.isArray(data.client_services)
      ? data.client_services[0]
      : data.client_services;
    const ownerId = clientService?.user_id;
    if (!ownerId) return { filePath: null, error: "Document owner not found" };
    if (viewer.role === "client" && ownerId !== viewer.userId) {
      return { filePath: null, error: "Forbidden" };
    }

    return { filePath: data.file_path, error: null };
  }

  const { data, error } = await supabase
    .from("common_documents")
    .select("id, user_id, file_path")
    .eq("id", input.documentId)
    .maybeSingle();

  if (error || !data?.file_path) return { filePath: null, error: "Document not found" };
  if (viewer.role === "client" && data.user_id !== viewer.userId) {
    return { filePath: null, error: "Forbidden" };
  }

  return { filePath: data.file_path, error: null };
}

export async function getSignedDocumentUrl(
  supabase: SupabaseClient,
  viewer: ViewerContext,
  input: DocumentAccessInput,
) {
  const { filePath, error } = await resolveFilePath(supabase, viewer, input);
  if (error || !filePath) return { url: null, error: error ?? "Document not found" };

  const { data, error: signedUrlError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !data?.signedUrl) {
    return { url: null, error: signedUrlError?.message ?? "Could not create signed URL" };
  }

  return { url: data.signedUrl, error: null };
}
