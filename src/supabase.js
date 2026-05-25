import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://uxhjqinnyyhxjbveyhom.supabase.co";
const SUPABASE_KEY  = "sb_publishable_1Ublru-RGZvC7KKlBss1Hg_J5rABoSb";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
