import { Queue } from 'bullmq';
import { redisConnection } from '../configs/redis.config';

export const slaQueue = new Queue('sla', { connection: redisConnection });
