import { Request, Response, NextFunction } from 'express';
import { config } from '../configs/app.config';

export const cronAuth = (req: Request, res: Response, next: NextFunction) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== config.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid cron secret' });
  }
  next();
};
