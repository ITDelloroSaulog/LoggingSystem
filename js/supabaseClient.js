import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://oahibjucnzpeuhjilpjj.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_-0NM6WkbuBqldf4Y_f58qw_LWLMGBkw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

