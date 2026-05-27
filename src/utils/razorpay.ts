import { razorpayConfig, verifyPaymentSignature as verifyPaymentSig, verifyWebhookSignature as verifyWebhookSig } from '../configs/razorpay.config';

const KEY_ID = razorpayConfig.key_id;
const KEY_SECRET = razorpayConfig.key_secret;

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createRazorpayOrder({
  amount,
  receipt,
  notes = {},
}: {
  amount: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount, currency: "INR", receipt, notes }),
  });

  if (!res.ok) {
    const err = await res.json() as { error?: { description?: string } };
    throw new Error(err.error?.description ?? "Failed to create Razorpay order");
  }

  return res.json() as Promise<RazorpayOrder>;
}

export { verifyPaymentSig as verifyPaymentSignature, verifyWebhookSig as verifyWebhookSignature };

export const RAZORPAY_KEY_ID = KEY_ID;

export async function fetchRazorpayPayment(paymentId: string) {
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return null;
    return res.json() as Promise<{
      id: string;
      order_id: string;
      method: string;
      status: string;
      amount: number;
    }>;
  } catch {
    return null;
  }
}

export function formatPrice(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}
