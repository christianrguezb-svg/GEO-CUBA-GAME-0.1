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
    .from('solicitudes_pago')
    .select('estado, codigo_activacion')
    .eq('codigo_pedido', codigo)
    .single();

  if (error) {
    return res.status(200).json({ ok: false, estado: 'no_encontrado' });
  }

  return res.status(200).json({
    ok: true,
    estado: data.estado,
    codigoActivacion: data.codigo_activacion
  });
}