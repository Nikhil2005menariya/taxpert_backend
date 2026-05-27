export function calcGst(totalPaise: number, rate = 18) {
  const base = Math.round(totalPaise / (1 + rate / 100));
  const gst = totalPaise - base;
  return { base, gst, rate };
}

export function formatRupees(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function calcDiscount(
  coupon: { type: 'flat' | 'percent'; value: number; max_discount?: number | null },
  orderAmountPaise: number
): number {
  if (coupon.type === 'flat') {
    return Math.min(coupon.value, orderAmountPaise);
  }
  const raw = Math.round((orderAmountPaise * coupon.value) / 10000);
  return coupon.max_discount ? Math.min(raw, coupon.max_discount) : raw;
}
