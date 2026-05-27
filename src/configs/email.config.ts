import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resendApiKey = process.env.RESEND_API_KEY;

export const resend = resendApiKey ? new Resend(resendApiKey) : null;
export const DEFAULT_FROM_EMAIL = 'TheTaxpert <updates@thetaxpert.com>';
