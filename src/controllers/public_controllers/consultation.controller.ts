import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { appLogger } from '../../utils/logger';
import { notifyAdmins } from '../../utils/notifications';

export const submitConsultation = async (req: Request, res: Response) => {
  try {
    const { name, phone, email, service_needed, message } = req.body;

    if (!name?.trim() || !phone?.trim() || !email?.trim() || !service_needed?.trim()) {
      return res.status(400).json({ error: 'name, phone, email, and service_needed are required' });
    }

    const sc = createServiceClient();
    const { error } = await sc.from('consultation_requests').insert({
      name:           name.trim(),
      phone:          phone.trim(),
      email:          email.trim().toLowerCase(),
      service_needed: service_needed.trim(),
      message:        message?.trim() || null,
    });

    if (error) return res.status(400).json({ error: error.message });

    void notifyAdmins({
      type:  'new_inquiry',
      title: `New consultation inquiry · ${service_needed.trim()}`,
      body:  `${name.trim()} (${phone.trim()}) requested a consultation.`,
      link:  '/admin/inquiries',
    });

    appLogger.info('consultation submitted', { email, service_needed });
    res.status(201).json({ success: true });
  } catch (err) {
    appLogger.error('submitConsultation error', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
};
