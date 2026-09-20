// Supabase client, created only if the env keys are present. Without them the app
// runs exactly as before (local-only, no accounts). Session persists in
// localStorage by default = "remember me" across reloads/reboots on this device.
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudEnabled: boolean = !!(url && key);

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(url as string, key as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
