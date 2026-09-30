import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  // Generar código de pedido único (formato GEO-XXXXXX)
  const codigoPedido = 'GEO-' + Math.random().toString(36).substring(2, 8).toUpperCase();

  const { error } = await supabase
    .from('solicitudes_pago')
    .insert({ codigo_pedido: codigoPedido, estado: 'pendiente' });

  if (error) {
    console.error('Error insertando solicitud:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({
    ok: true,
    codigoPedido,
    instrucciones: 'Envía este código junto al ID de transacción a @geocuba_pagos_bot'
  });
}