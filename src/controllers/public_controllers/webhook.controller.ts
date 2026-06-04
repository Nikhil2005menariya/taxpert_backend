import { Request, Response } from 'express';
import { verifyWebhookSignature } from '../../utils/razorpay';
import { createServiceClient } from '../../configs/supabase.config';
import { recordPaymentInternal } from '../../utils/payments';
import { trackEvent } from '../../utils/analytics';
import { autoAssignTaxpert } from '../../utils/auto-assign';
import { processReferralReward, consumeCoupon } from '../../utils/coupons';
import { emailQueue } from '../../queues/email.queue';
import { appLogger } from '../../utils/logger';
import { writeAudit } from '../../utils/audit';

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

    if (event.event === 'payment.failed') {
      const failedPayment = event.payload.payment.entity;
      const { user_id: failedUserId, service_slug: failedSlug } = failedPayment.notes ?? {};
      if (failedUserId) {
        try {
          const supabase = createServiceClient();
          const [{ data: clientUser }, { data: svc }] = await Promise.all([
            supabase.from('users').select('first_name, email').eq('id', failedUserId).single(),
            failedSlug ? supabase.from('services').select('name').eq('slug', failedSlug).single() : Promise.resolve({ data: null }),
          ]);
          if (clientUser?.email) {
            emailQueue.add('payment-failed', {
              type: 'payment-failed',
              payload: {
                to:          clientUser.email,
                firstName:   clientUser.first_name,
                serviceName: svc?.name ?? failedSlug ?? 'your service',
                reason:      failedPayment.error_description ?? null,
              },
            }).catch(console.error);
          }
        } catch {}
      }
      return res.json({ received: true });
    }

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
      // Mark payment confirmed. Do NOT auto-advance the workflow — the service
      // stays at its current stage (e.g. 'payment') so a texpert/admin closes it out.
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
        couponId: coupon_id || undefined,
      });

      // Timeline event + confirmation email (non-blocking)
      void supabase.from('service_events').insert({
        client_service_id: existingCs.id,
        actor_user_id:     user_id,
        event_type:        'payment_received',
        message:           `Payment of ₹${(payment.amount / 100).toLocaleString('en-IN')} received.`,
        metadata:          { razorpayPaymentId: payment.id, amount: payment.amount },
      });

      try {
        const [{ data: clientUser }, { data: svc }, { data: invoice }] = await Promise.all([
          supabase.from('users').select('first_name, email').eq('id', user_id).single(),
          supabase.from('services').select('name').eq('id', existingCs.service_id).single(),
          supabase.from('invoices').select('invoice_number').eq('client_service_id', existingCs.id).maybeSingle(),
        ]);
        if (clientUser?.email) {
          emailQueue.add('payment-confirmation', {
            type: 'payment-confirmation',
            payload: {
              to:            clientUser.email,
              firstName:     clientUser.first_name,
              serviceName:   svc?.name ?? service_slug ?? 'your service',
              amountPaise:   payment.amount,
              paymentId:     payment.id,
              invoiceNumber: invoice?.invoice_number ?? null,
            },
          }).catch(console.error);
        }
      } catch {}

      writeAudit({
        actorId:    user_id ?? 'system',
        action:     'payment_captured',
        targetType: 'payment',
        targetId:   payment.id,
        metadata: {
          razorpayOrderId: payment.order_id,
          userId:          user_id,
          serviceSlug:     service_slug,
          amountPaise:     payment.amount,
          couponId:        coupon_id ?? null,
          clientServiceId: existingCs.id,
          source:          'main_webhook_existing_cs',
        },
      }).catch(console.error);

      if (coupon_id) {
        consumeCoupon(coupon_id, user_id, payment.id).catch(console.error);
      }

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
        appLogger.warn('[webhook] autoAssignTaxpert:', assignment.error);
      } else if (assignment.assigned) {
        appLogger.info(`[webhook] auto-assigned ${(assignment as any).taxpertName} to client ${user_id}`);
      }
    } catch (err) {
      appLogger.error('[webhook] autoAssignTaxpert threw:', err);
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

    writeAudit({
      actorId:    user_id ?? 'system',
      action:     'payment_captured',
      targetType: 'payment',
      targetId:   payment.id,
      metadata: {
        razorpayOrderId:  payment.order_id,
        userId:           user_id,
        serviceSlug:      service_slug,
        amountPaise:      payment.amount,
        couponId:         coupon_id ?? null,
        clientServiceId:  cs.id,
        source:           'main_webhook',
      },
    }).catch(console.error);

    // Send payment confirmation email (non-blocking)
    try {
      const [{ data: clientUser }, { data: invoice }] = await Promise.all([
        supabase.from('users').select('first_name, email').eq('id', user_id).single(),
        supabase.from('invoices').select('invoice_number').eq('client_service_id', cs.id).maybeSingle(),
      ]);
      if (clientUser?.email) {
        emailQueue.add('payment-confirmation', {
          type: 'payment-confirmation',
          payload: {
            to:            clientUser.email,
            firstName:     clientUser.first_name,
            serviceName:   service.name,
            amountPaise:   payment.amount,
            paymentId:     payment.id,
            invoiceNumber: invoice?.invoice_number ?? null,
          },
        }).catch(console.error);
      }
    } catch {}

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
    appLogger.error('webhookHandler error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
