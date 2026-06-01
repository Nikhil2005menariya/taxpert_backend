import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Separate from BullMQ connection — used for direct key-value ops (OTP storage).
// BullMQ needs maxRetriesPerRequest: null; regular KV ops need a finite retry.
export const redisKv = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

redisKv.on('error', (err) => {
  // Non-fatal — OTP flow will fail gracefully if Redis is down
  console.error('[redis-kv] connection error:', err.message);
});
