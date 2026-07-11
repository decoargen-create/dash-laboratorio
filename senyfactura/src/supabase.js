import { createClient } from '@supabase/supabase-js'

// Proyecto compartido Senyfull. La publishable key es pública por diseño;
// el aislamiento entre clientes lo garantiza RLS (owner_id = auth.uid()).
const SUPABASE_URL = 'https://qlnfgjsjibwrkzgmwdgl.supabase.co'
const SUPABASE_KEY = 'sb_publishable_1y8WIxj11igqMJDpXXnAjg_Y2bseDJA'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`
