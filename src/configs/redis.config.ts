import dotenv from 'dotenv';
import { ConnectionOptions } from 'bullmq';

dotenv.config();

export const redisConnection: ConnectionOptions = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  maxRetriesPerRequest: null,
};
