import { Request, Response, NextFunction } from 'express';
import { createServiceClient } from '../configs/supabase.config';
import { isAdminRole, isStaffRole, UserRole } from '../shared/roles';

export function requireRole(checkFn: (role: UserRole) => boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from('users')
        .select('role, is_active')
        .eq('id', req.user.id)
        .single();

      if (error || !data) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (!data.is_active) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }

      if (!checkFn(data.role as UserRole)) {
        return res.status(403).json({ error: 'Forbidden: Insufficient role' });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const requireAdmin = requireRole(isAdminRole);
export const requireStaff = requireRole(isStaffRole);
export const requireSuperAdmin = requireRole((role) => role === 'super_admin');
