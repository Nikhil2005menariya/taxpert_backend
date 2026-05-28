import { Request, Response, NextFunction } from 'express';
import { appLogger } from '../utils/logger';

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  appLogger.error(message, {
    statusCode,
    method: req.method,
    path: req.originalUrl,
    stack: statusCode === 500 ? err.stack : undefined,
  });

  res.status(statusCode).json({ error: message });
};
