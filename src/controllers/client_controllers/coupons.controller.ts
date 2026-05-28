import { Request, Response } from 'express';
import { calcDiscount } from '../../utils/finance';

const REFERRAL_DISCOUNT_FLAT = 50000;

export const validateCode = async (req: Request, res: Response) => {
  try {
    const { code, servicePrice } = req.body;
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const now = new Date().toISOString();

    const { data: coupon } = await req.supabase
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .single();

    if (coupon) {
      if (coupon.valid_until && coupon.valid_until < now) return res.json({ valid: false, error: 'This coupon has expired' });
      if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) return res.json({ valid: false, error: 'This coupon has reached its usage limit' });
      if (coupon.for_user_id && coupon.for_user_id !== req.user.id) return res.json({ valid: false, error: 'This coupon is not valid for your account' });
      if (servicePrice < coupon.min_order) return res.json({ valid: false, error: `Minimum order ₹${(coupon.min_order / 100).toLocaleString('en-IN')} required` });

      const { data: prevUse } = await req.supabase
        .from('coupon_usages')
        .select('id')
        .eq('coupon_id', coupon.id)
        .eq('user_id', req.user.id)
        .maybeSingle();

      if (prevUse) return res.json({ valid: false, error: 'You have already used this coupon' });

      const discount = calcDiscount(coupon as any, servicePrice);
      return res.json({
        valid: true,
        codeType: 'coupon',
        couponId: coupon.id,
        couponCode: coupon.code,
        discountAmount: discount,
        finalAmount: servicePrice - discount,
        description: coupon.description ?? (coupon.type === 'flat' ? `₹${(coupon.value / 100).toLocaleString('en-IN')} off` : `${coupon.value / 100}% off`),
      });
    }

    const { data: referrer } = await req.supabase
      .from('users')
      .select('id, first_name')
      .eq('referral_code', code.toUpperCase().trim())
      .single();

    if (referrer) {
      if (referrer.id === req.user.id) return res.json({ valid: false, error: 'You cannot use your own referral code' });

      const { data: existingReferral } = await req.supabase
        .from('referrals')
        .select('id')
        .eq('referred_id', req.user.id)
        .maybeSingle();
      if (existingReferral) return res.json({ valid: false, error: 'You have already used a referral code' });

      // Referrer has hit the 3-person limit
      const { count: referralCount } = await req.supabase
        .from('referrals')
        .select('id', { count: 'exact', head: true })
        .eq('referrer_id', referrer.id)
        .in('status', ['converted', 'rewarded']);
      if ((referralCount ?? 0) >= 3) return res.json({ valid: false, error: 'This referral code has reached its limit' });

      const discount = Math.min(REFERRAL_DISCOUNT_FLAT, servicePrice);
      return res.json({
        valid: true,
        codeType: 'referral',
        referrerId: referrer.id,
        referralCode: code.toUpperCase().trim(),
        discountAmount: discount,
        finalAmount: servicePrice - discount,
        description: `Referral by ${referrer.first_name} — ₹${(discount / 100).toLocaleString('en-IN')} off`,
      });
    }

    res.json({ valid: false, error: 'Invalid code' });
  } catch (error) {
    console.error('validateCode error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getMyReferralData = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await req.supabase
      .from('users')
      .select('first_name, referral_code')
      .eq('id', req.user.id)
      .single();

    let code = profile?.referral_code;
    if (!code) {
      code = `TAXPERT-${req.user.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
      await req.supabase.from('users').update({ referral_code: code }).eq('id', req.user.id);
    }

    const [{ data: referrals }, { data: rewardCoupons }] = await Promise.all([
      req.supabase.from('referrals').select('*, referred:users!referrals_referred_id_fkey(first_name, last_name)').eq('referrer_id', req.user.id).order('created_at', { ascending: false }),
      req.supabase.from('coupons').select('*').eq('for_user_id', req.user.id).eq('is_referral', true).order('created_at', { ascending: false }),
    ]);

    const totalEarned = referrals?.filter((r: any) => r.status === 'rewarded').reduce((s: number, r: any) => s + (r.reward_amount ?? 0), 0) ?? 0;

    res.json({
      data: {
        referralCode: code,
        referrals: referrals ?? [],
        rewardCoupons: rewardCoupons ?? [],
        totalEarned,
        count: referrals?.length ?? 0,
      }
    });
  } catch (error) {
    console.error('getMyReferralData error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
