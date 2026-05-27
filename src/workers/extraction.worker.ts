import { Worker, Job } from 'bullmq';
import { redisConnection } from '../configs/redis.config';

export const extractionWorker = new Worker('extraction', async (job: Job) => {
  // Placeholder for OCR Python Microservice call
  console.log(`[ExtractionWorker] Processing job ${job.id} for document ${job.data.documentId}`);
  // await callPythonExtractionService(job.data.documentId);
}, { connection: redisConnection });

extractionWorker.on('completed', job => {
  console.log(`[ExtractionWorker] Job ${job.id} completed`);
});
