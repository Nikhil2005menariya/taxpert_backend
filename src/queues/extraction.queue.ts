import { Queue } from 'bullmq';
import { redisConnection } from '../configs/redis.config';

export const extractionQueue = new Queue('extraction', { connection: redisConnection });
