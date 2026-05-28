import { Request, Response, NextFunction } from 'express';
import { appLogger } from '../utils/logger';

export const loggerMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    appLogger.info(`${req.method} ${req.originalUrl} ${res.statusCode}`, { ms });
  });
  next();
};
