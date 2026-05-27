import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

export const razorpayConfig = {
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
  webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
};

export function verifyPaymentSignature(order_id: string, payment_id: string, signature: string): boolean {
  const generated_signature = crypto
    .createHmac('sha256', razorpayConfig.key_secret)
    .update(order_id + '|' + payment_id)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(generated_signature), Buffer.from(signature));
}

export function verifyWebhookSignature(body: string, signature: string): boolean {
  const generated_signature = crypto
    .createHmac('sha256', razorpayConfig.webhook_secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(generated_signature), Buffer.from(signature));
}
