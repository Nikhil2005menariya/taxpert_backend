import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${extra}`;
  })
);

export const appLogger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: jsonFormat,
  transports: [
    new winston.transports.File({ filename: path.join(logsDir, 'app.log'), maxsize: 10_485_760, maxFiles: 5 }),
    ...(process.env.NODE_ENV !== 'test' ? [new winston.transports.Console({ format: consoleFormat })] : []),
  ],
});

export const auditLogger = winston.createLogger({
  level: 'info',
  format: jsonFormat,
  transports: [
    new winston.transports.File({ filename: path.join(logsDir, 'audit.log'), maxsize: 10_485_760, maxFiles: 10 }),
  ],
});

export const paymentLogger = winston.createLogger({
  level: 'info',
  format: jsonFormat,
  transports: [
    new winston.transports.File({ filename: path.join(logsDir, 'payment.log'), maxsize: 10_485_760, maxFiles: 10 }),
  ],
});
