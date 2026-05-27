import { createServiceClient } from '../configs/supabase.config';
import { canAccessClientServiceRecord } from './service-access';

type WorkspaceTaskSeed = {
  title: string;
  description: string;
  task_type: string;
  scope: 'client' | 'internal';
  status: 'pending' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  sort_order: number;
};

export function buildFallbackTasks(input: {
  status: string;
  docs: Array<{ status: string }>;
  paymentStatus?: string | null;
}): WorkspaceTaskSeed[] {
  const hasPendingDocs = input.docs.some((doc) =>
    doc.status === 'pending' || doc.status === 'rejected' || doc.status === 'expired',
  );
  const hasReviewableDocs = input.docs.some((doc) => doc.status === 'uploaded');
  const docsComplete = input.docs.length > 0 && !hasPendingDocs;
  const paymentDone = input.paymentStatus === 'paid' || input.status !== 'invoice_pending';

  return [
    {
      title: 'Upload required documents',
      description: 'Client-side checklist completion through the Vault.',
      task_type: 'document_collection',
      scope: 'client',
      status: docsComplete ? 'done' : hasPendingDocs ? 'in_progress' : 'pending',
      sort_order: 1,
    },
    {
      title: 'Review submitted documents',
      description: 'Internal review of uploaded documents before service execution.',
      task_type: 'document_review',
      scope: 'internal',
      status: hasReviewableDocs ? 'in_progress' : docsComplete ? 'done' : 'blocked',
      sort_order: 2,
    },
    {
      title: 'Execute service work',
      description: 'Operational execution of the selected service.',
      task_type: 'service_execution',
      scope: 'internal',
      status:
        input.status === 'completed'
          ? 'done'
          : input.status === 'in_progress' || input.status === 'under_review'
            ? 'in_progress'
            : docsComplete
              ? 'pending'
              : 'blocked',
      sort_order: 3,
    },
    {
      title: 'Confirm invoice payment',
      description: 'Client payment confirmation before final closure.',
      task_type: 'invoice_payment',
      scope: 'client',
      status: paymentDone ? 'done' : input.status === 'invoice_pending' ? 'in_progress' : 'blocked',
      sort_order: 4,
    },
    {
      title: 'Close service workspace',
      description: 'Final internal close-out and completion confirmation.',
      task_type: 'service_closure',
      scope: 'internal',
      status: input.status === 'completed' ? 'done' : paymentDone ? 'pending' : 'blocked',
      sort_order: 5,
    },
  ];
}

export async function ensureServiceWorkspace(clientServiceId: string) {
  const supabase = createServiceClient();

  const { data: existingCheck, error: checkErr } = await supabase
    .from('service_tasks')
    .select('id')
    .eq('client_service_id', clientServiceId)
    .limit(1);

  if (checkErr?.code !== '42P01' && existingCheck && existingCheck.length > 0) {
    return { error: null };
  }

  const { data: serviceRow, error: serviceError } = await supabase
    .from('client_services')
    .select(`
      id, user_id, status, payment_status, created_at, assigned_to,
      service:services(slug, name),
      client_documents(status)
    `)
    .eq('id', clientServiceId)
    .single();

  if (serviceError || !serviceRow) return { error: 'Service not found' };

  const docs = (serviceRow.client_documents ?? []) as Array<{ status: string }>;
  const fallbackTasks = buildFallbackTasks({
    status: serviceRow.status as string,
    docs,
    paymentStatus: serviceRow.payment_status ?? null,
  });

  const { error: tasksError } = await supabase.from('service_tasks').upsert(
    fallbackTasks.map((t) => ({
      client_service_id: clientServiceId,
      ...t,
    })),
    { onConflict: 'client_service_id, task_type' },
  );

  if (tasksError && tasksError.code !== '42P01') {
    return { error: tasksError.message };
  }

  return { error: null };
}

export async function logServiceEvent(input: {
  clientServiceId: string;
  actorUserId?: string | null;
  eventType: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServiceClient();
  const { error } = await supabase.from('service_events').insert({
    client_service_id: input.clientServiceId,
    actor_user_id: input.actorUserId ?? null,
    event_type: input.eventType,
    message: input.message,
    metadata: input.metadata ?? {},
  });

  if (error && error.code !== '42P01') {
    return { error: error.message };
  }
  return { error: null };
}
