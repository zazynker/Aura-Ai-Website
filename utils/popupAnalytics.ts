import { supabase } from './supabase';

export const TEMPLATE_DETAIL_AUTH_GATE_KEY = 'template_detail_auth_gate';

export async function trackPopupImpression(
  popupKey: string = TEMPLATE_DETAIL_AUTH_GATE_KEY,
): Promise<void> {
  const { error } = await supabase.rpc('log_popup_impression', {
    p_popup_key: popupKey,
  });

  if (error) {
    console.warn('Unable to record popup impression:', error.message);
  }
}
