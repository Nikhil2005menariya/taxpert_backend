import { createServiceClient } from '../configs/supabase.config';
import { auditLogger } from './logger';

interface AuditParams {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit({ actorId, action, targetType, targetId, metadata = {} }: AuditParams) {
  const service = createServiceClient();
  const { error } = await service.from('audit_log').insert({
    actor_id:    actorId,
    action,
    target_type: targetType,
    target_id:   targetId,
    metadata,
  });
  if (error) {
    auditLogger.error('audit_write_failed', { actorId, action, targetType, targetId, error: error.message });
  } else {
    auditLogger.info(action, { actorId, targetType, targetId, metadata });
  }
}
