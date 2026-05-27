import { Request, Response, NextFunction } from 'express';
import { createUserClient } from '../configs/supabase.config';
import { SupabaseClient, User } from '@supabase/supabase-js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      accessToken?: string;
      supabase?: SupabaseClient;
    }
  }
}

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];
    const supabase = createUserClient(token);
    
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    req.user = user;
    req.accessToken = token;
    req.supabase = supabase;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
};
