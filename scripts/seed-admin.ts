/**
 * One-time seed script — creates nik@gmail.com as admin.
 * Run: npx ts-node -r dotenv/config scripts/seed-admin.ts
 * Safe to re-run: skips if the user already exists.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL              = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const EMAIL    = 'nik@gmail.com';
const PASSWORD = 'Nikhil@123';
const ROLE     = 'admin';

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Check if user already exists in public.users
  const { data: existing } = await service
    .from('users')
    .select('id, email, role')
    .eq('email', EMAIL)
    .maybeSingle();

  if (existing) {
    console.log(`User already exists: ${existing.email} (role: ${existing.role}, id: ${existing.id})`);
    // Update role to admin if it isn't already
    if (existing.role !== ROLE) {
      await service.from('users').update({ role: ROLE }).eq('id', existing.id);
      await service.auth.admin.updateUserById(existing.id, { user_metadata: { role: ROLE } });
      console.log(`Role updated to ${ROLE}.`);
    }
    return;
  }

  // Create auth user
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: 'Nikhil', last_name: 'Admin', role: ROLE },
  });

  if (authError) {
    // If auth user exists but profile row doesn't, try fetching the auth user
    if (authError.message.includes('already')) {
      console.log('Auth user already exists, attempting to upsert profile row…');
      const { data: { users: authUsers } } = await service.auth.admin.listUsers();
      const authUser = authUsers.find(u => u.email === EMAIL);
      if (!authUser) throw new Error('Could not find auth user');

      await service.from('users').upsert({
        id:         authUser.id,
        first_name: 'Nikhil',
        last_name:  'Admin',
        email:      EMAIL,
        mobile:     '9999999999',
        pan:        'NIKHL9999Z',
        role:       ROLE,
        is_active:  true,
      }, { onConflict: 'id' });

      console.log(`Profile upserted for existing auth user ${authUser.id}`);
      return;
    }
    throw authError;
  }

  // Insert profile row
  const { error: profileError } = await service.from('users').insert({
    id:         authData.user.id,
    first_name: 'Nikhil',
    last_name:  'Admin',
    email:      EMAIL,
    mobile:     '9999999999',
    pan:        'NIKHL9999Z',
    role:       ROLE,
    is_active:  true,
  });

  if (profileError) {
    // Roll back auth user to avoid orphan
    await service.auth.admin.deleteUser(authData.user.id);
    throw profileError;
  }

  console.log(`Admin user created successfully!`);
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  Role:     ${ROLE}`);
  console.log(`  ID:       ${authData.user.id}`);
}

main().catch(err => {
  console.error('Seed failed:', err.message ?? err);
  process.exit(1);
});
