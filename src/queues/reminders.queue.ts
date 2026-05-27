import { Queue } from 'bullmq';
import { redisConnection } from '../configs/redis.config';

export const remindersQueue = new Queue('reminders', { connection: redisConnection });
