import { createServiceClient } from '../configs/supabase.config';
import { emailQueue } from '../queues/email.queue';

const REFERRAL_REWARD_PERCENT = 10;
const REFERRAL_REWARD_CAP = 100000;

export async function consumeCoupon(couponId: string, userId?: string, paymentId?: string) {
  const supabase = createServiceClient();
  await supabase.rpc('increment_coupon_used', {
    coupon_id: couponId,
    p_user_id: userId ?? null,
    p_payment_id: paymentId ?? null,
  });
}

export async function processReferralReward({
  referrerId,
  referredId,
  referralCode,
  paymentId,
  paymentAmount,
}: {
  referrerId: string;
  referredId: string;
  referralCode: string;
  paymentId: string;
  paymentAmount: number;
}) {
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('referrals')
    .select('id')
    .eq('referred_id', referredId)
    .maybeSingle();

  if (existing) return;

  const rewardAmount = Math.min(
    Math.round((paymentAmount * REFERRAL_REWARD_PERCENT) / 100),
    REFERRAL_REWARD_CAP
  );

  const rewardCode = `REF${Date.now().toString(36).toUpperCase()}`;
  const { data: rewardCoupon } = await supabase
    .from('coupons')
    .insert({
      code: rewardCode,
      description: `Referral reward — ₹${(rewardAmount / 100).toLocaleString('en-IN')} off your next service`,
      type: 'flat',
      value: rewardAmount,
      min_order: 0,
      usage_limit: 1,
      is_referral: true,
      for_user_id: referrerId,
    })
    .select()
    .single();

  await supabase.from('referrals').insert({
    referrer_id: referrerId,
    referred_id: referredId,
    referral_code: referralCode,
    status: 'rewarded',
    first_payment_id: paymentId,
    reward_amount: rewardAmount,
    reward_coupon_id: rewardCoupon?.id ?? null,
    converted_at: new Date().toISOString(),
    rewarded_at: new Date().toISOString(),
  });

  try {
    const { data: referrerUser } = await supabase.from('users').select('first_name').eq('id', referrerId).single();
    const { data: authReferrer } = await supabase.auth.admin.getUserById(referrerId);
    const email = authReferrer?.user?.email;
    if (email) {
      emailQueue.add('referral-reward', { type: 'referral-reward', payload: {
        to: email,
        firstName: referrerUser?.first_name ?? 'there',
        rewardAmount: rewardAmount,
        couponCode: rewardCode,
      } }).catch(console.error);
    }
  } catch {}
}
