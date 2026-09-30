import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { codigo } = req.query;

  if (!codigo) {
    return res.status(400).json({ ok: false, error: 'Falta el código' });
  }

  const { data, error } = await supabase
    .from('codigos_activacion')
    .select('*')
    .eq('codigo', codigo.toUpperCase())
    .eq('usado', false)
    .single();

  if (error || !data) {
    return res.status(200).json({ ok: false, error: 'Código inválido o ya usado' });
  }

  await supabase
    .from('codigos_activacion')
    .update({ usado: true })
    .eq('codigo', data.codigo);

  return res.status(200).json({ ok: true, categoria: 'urbano' });
}