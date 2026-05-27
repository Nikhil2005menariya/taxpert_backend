import { Queue } from 'bullmq';
import { redisConnection } from '../configs/redis.config';

export const emailQueue = new Queue('email', { connection: redisConnection });
