import { createServiceClient } from '../configs/supabase.config';
import { calcGst } from './finance';

export async function recordPaymentInternal({
  userId,
  serviceId,
  clientServiceId,
  razorpayOrderId,
  razorpayPaymentId,
  amount,
  status,
  paymentMethod,
  couponId,
  discountAmount = 0,
  originalAmount,
}: {
  userId: string;
  serviceId: string;
  clientServiceId?: string;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  amount: number;
  status: 'pending' | 'captured' | 'failed';
  paymentMethod?: string;
  couponId?: string;
  discountAmount?: number;
  originalAmount?: number;
}) {
  const { base, gst, rate } = calcGst(amount);
  const supabase = createServiceClient();

  const { error } = await supabase.from('payments').upsert(
    {
      user_id: userId,
      service_id: serviceId,
      client_service_id: clientServiceId ?? null,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId ?? null,
      amount,
      base_amount: base,
      gst_amount: gst,
      gst_rate: rate,
      status,
      payment_method: paymentMethod ?? null,
      coupon_id: couponId ?? null,
      discount_amount: discountAmount,
      original_amount: originalAmount ?? amount,
      captured_at: status === 'captured' ? new Date().toISOString() : null,
    },
    { onConflict: 'razorpay_payment_id', ignoreDuplicates: true }
  );

  return { error: error?.message ?? null };
}
