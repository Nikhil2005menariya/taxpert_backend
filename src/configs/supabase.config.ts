import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables');
}

/**
 * Creates a Supabase client configured with the user's JWT.
 * This ensures Row Level Security (RLS) is enforced.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Creates a Supabase client with the service_role key.
 * Bypasses Row Level Security (RLS). Use with caution!
 */
export function createServiceClient(): SupabaseClient {
  return createClient(supabaseUrl!, supabaseServiceRoleKey!, {
    auth: {
      persistSession: false,
    },
  });
}
