import { Request, Response } from 'express';
import { verifyWebhookSignature } from '../../utils/razorpay';
import { createServiceClient } from '../../configs/supabase.config';
import { recordPaymentInternal } from '../../utils/payments';
import { trackEvent } from '../../utils/analytics';
import { autoAssignTaxpert } from '../../utils/auto-assign';
import { processReferralReward, consumeCoupon } from '../../utils/coupons';

export const webhookHandler = async (req: Request, res: Response) => {
  try {
    // The raw body is populated by express.raw() in the router before parsing JSON
    const rawBody = req.body;
    const signature = req.headers['x-razorpay-signature'] as string;

    if (!rawBody || !signature) {
      return res.status(400).json({ error: 'Missing body or signature' });
    }

    if (!verifyWebhookSignature(rawBody.toString('utf8'), signature)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));

    await trackEvent('webhook_received', null, { event_type: event.event });

    if (event.event !== 'payment.captured') {
      return res.json({ received: true });
    }

    const payment = event.payload.payment.entity;
    const { user_id, service_slug, coupon_id, referrer_id, referral_code } = payment.notes ?? {};

    if (!user_id || !service_slug) {
      return res.status(400).json({ error: 'Missing notes' });
    }

    const supabase = createServiceClient();

    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id, client_service_id')
      .eq('razorpay_payment_id', payment.id)
      .maybeSingle();

    if (existingPayment) return res.json({ received: true });

    const { data: existingCs } = await supabase
      .from('client_services')
      .select('id, service_id')
      .eq('razorpay_order_id', payment.order_id)
      .maybeSingle();

    if (existingCs) {
      await supabase
        .from('client_services')
        .update({
          payment_status: 'paid',
          payment_id: payment.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingCs.id);

      await recordPaymentInternal({
        userId: user_id,
        serviceId: existingCs.service_id,
        clientServiceId: existingCs.id,
        razorpayOrderId: payment.order_id,
        razorpayPaymentId: payment.id,
        amount: payment.amount,
        status: 'captured',
        paymentMethod: payment.method,
      });
      return res.json({ received: true });
    }

    const { data: service } = await supabase
      .from('services')
      .select('id, name')
      .eq('slug', service_slug)
      .single();

    if (!service) return res.status(404).json({ error: 'Service not found' });

    const now = new Date().toISOString();

    const { data: cs, error: csErr } = await supabase
      .from('client_services')
      .insert({
        user_id,
        service_id: service.id,
        status: 'documents_required',
        status_updated_at: now,
        payment_status: 'paid',
        payment_id: payment.id,
        razorpay_order_id: payment.order_id,
      })
      .select()
      .single();

    if (csErr || !cs) {
      return res.status(500).json({ error: 'Failed to create service' });
    }

    try {
      const assignment = await autoAssignTaxpert(supabase, user_id);
      if (assignment.error) {
        console.warn('[webhook] autoAssignTaxpert:', assignment.error);
      } else if (assignment.assigned) {
        console.log(`[webhook] auto-assigned ${assignment.taxpertName} to client ${user_id}`);
      }
    } catch (err) {
      console.error('[webhook] autoAssignTaxpert threw:', err);
    }

    const { data: docReqs } = await supabase
      .from('service_document_requirements')
      .select('id, is_required, sort_order, document_type:document_types(id, name)')
      .eq('service_id', service.id)
      .eq('is_required', true)
      .order('sort_order');

    if (docReqs && docReqs.length > 0) {
      const docs = docReqs.map((req: any) => {
        const dt = Array.isArray(req.document_type) ? req.document_type[0] : req.document_type;
        return {
          client_service_id: cs.id,
          template_id: null,
          document_name: dt?.name ?? 'Document',
          status: 'pending',
        };
      });
      await supabase.from('client_documents').insert(docs);
    } else {
      const { data: templates } = await supabase
        .from('document_templates')
        .select('id, name, required')
        .eq('service_id', service.id)
        .order('sort_order');

      if (templates && templates.length > 0) {
        const docs = templates
          .filter((t: any) => t.required)
          .map((t: any) => ({
            client_service_id: cs.id,
            template_id: t.id,
            document_name: t.name,
            status: 'pending',
          }));
        await supabase.from('client_documents').insert(docs);
      }
    }

    await recordPaymentInternal({
      userId: user_id,
      serviceId: service.id,
      clientServiceId: cs.id,
      razorpayOrderId: payment.order_id,
      razorpayPaymentId: payment.id,
      amount: payment.amount,
      status: 'captured',
      paymentMethod: payment.method,
      couponId: coupon_id || undefined,
    });

    trackEvent('payment_success', user_id, {
      service_slug,
      amount_paise: payment.amount,
      source: 'webhook',
    }).catch(console.error);

    if (referrer_id && referral_code) {
      processReferralReward({
        referrerId: referrer_id,
        referredId: user_id,
        referralCode: referral_code,
        paymentId: payment.id,
        paymentAmount: payment.amount,
      }).catch(console.error);
    }

    if (coupon_id) {
      consumeCoupon(coupon_id, user_id, payment.id).catch(console.error);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('webhookHandler error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
