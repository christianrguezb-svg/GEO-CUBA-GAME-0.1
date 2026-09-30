import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Verificar secret token
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  if (secretToken !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const update = req.body;

  // --- Mensajes de texto ---
  if (update.message && update.message.text) {
    const texto = update.message.text;
    const userId = update.message.from.id;
    const username = update.message.from.username || 'Sin username';

    const matchCodigo = texto.match(/GEO-[A-Z0-9]{6}/i);
    const matchTransaccion = texto.match(/\d{6,}/);

    if (matchCodigo && matchTransaccion) {
      const codigoPedido = matchCodigo[0].toUpperCase();
      const idTransaccion = matchTransaccion[0];

      // Verificar que la solicitud existe
      const { data: solicitud } = await supabase
        .from('solicitudes_pago')
        .select('codigo_pedido, estado')
        .eq('codigo_pedido', codigoPedido)
        .single();

      if (!solicitud) {
        await enviarMensaje(userId,
          `❌ Código de pedido no encontrado.\n\n` +
          `Asegúrate de que empiece con "GEO-" y tenga 6 caracteres.`
        );
        return res.status(200).json({ ok: true });
      }

      if (solicitud.estado === 'aprobado') {
        await enviarMensaje(userId,
          `✅ Este pedido ya fue aprobado anteriormente.\n\n` +
          `Si necesitas ayuda, contacta al soporte.`
        );
        return res.status(200).json({ ok: true });
      }

      // Actualizar solicitud
      await supabase
        .from('solicitudes_pago')
        .update({
          telegram_user_id: userId,
          telegram_username: username,
          id_transaccion: idTransaccion,
          estado: 'pendiente'
        })
        .eq('codigo_pedido', codigoPedido);

      await enviarMensaje(userId,
        `✅ ¡Solicitud recibida!\n\n` +
        `📋 Código: ${codigoPedido}\n` +
        `🔢 ID Transacción: ${idTransaccion}\n\n` +
        `⏳ Un administrador verificará tu pago en las próximas horas.\n` +
        `Recibirás tu código de activación en este chat.`
      );

      await notificarAdmin(codigoPedido, username, idTransaccion, userId);
    } else {
      await enviarMensaje(userId,
        `⚠️ Formato incorrecto.\n\n` +
        `Envía un mensaje con el código de pedido y el ID de transacción:\n\n` +
        `Ejemplo:\nGEO-7A2B9C 123456789`
      );
    }
  }

  // --- Botones inline ---
  if (update.callback_query) {
    const data = update.callback_query.data;
    const callbackId = update.callback_query.id;

    if (data.startsWith('approve:') || data.startsWith('reject:')) {
      const [accion, codigoPedido] = data.split(':');

      if (accion === 'approve') {
        const codigoActivacion = 'GEO-' +
          Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
          Math.random().toString(36).substring(2, 6).toUpperCase();

        await supabase
          .from('solicitudes_pago')
          .update({
            estado: 'aprobado',
            codigo_activacion: codigoActivacion,
            aprobado_en: new Date().toISOString()
          })
          .eq('codigo_pedido', codigoPedido);

        await supabase
          .from('codigos_activacion')
          .insert({ codigo: codigoActivacion, codigo_pedido: codigoPedido });

        const { data: solicitud } = await supabase
          .from('solicitudes_pago')
          .select('telegram_user_id')
          .eq('codigo_pedido', codigoPedido)
          .single();

        if (solicitud && solicitud.telegram_user_id) {
          await enviarMensaje(solicitud.telegram_user_id,
            `🎉 ¡Pago aprobado!\n\n` +
            `Tu código de activación es:\n` +
            `\`${codigoActivacion}\`\n\n` +
            `Ya puedes acceder a la categoría "Urbano" en el juego. ¡Disfrútalo!`
          );
        }

        await editarMensaje(
          update.callback_query.message.chat.id,
          update.callback_query.message.message_id,
          `✅ *APROBADO* — ${codigoPedido}\nCódigo: \`${codigoActivacion}\``
        );
        await responderCallback(callbackId, '✅ Aprobado');

      } else if (accion === 'reject') {
        await supabase
          .from('solicitudes_pago')
          .update({ estado: 'rechazado' })
          .eq('codigo_pedido', codigoPedido);

        const { data: solicitud } = await supabase
          .from('solicitudes_pago')
          .select('telegram_user_id')
          .eq('codigo_pedido', codigoPedido)
          .single();

        if (solicitud && solicitud.telegram_user_id) {
          await enviarMensaje(solicitud.telegram_user_id,
            `❌ Tu pago no pudo ser verificado.\n\n` +
            `Verifica el ID de transacción e intenta de nuevo, ` +
            `o contacta al soporte.`
          );
        }

        await editarMensaje(
          update.callback_query.message.chat.id,
          update.callback_query.message.message_id,
          `❌ *RECHAZADO* — ${codigoPedido}`
        );
        await responderCallback(callbackId, '❌ Rechazado');
      }
    }
  }

  return res.status(200).json({ ok: true });
}

// --- Funciones auxiliares ---

async function enviarMensaje(chatId, texto) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: texto,
      parse_mode: 'Markdown'
    })
  });
}

async function editarMensaje(chatId, messageId, texto) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: texto,
      parse_mode: 'Markdown'
    })
  });
}

async function responderCallback(callbackId, texto) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text: texto })
  });
}

async function notificarAdmin(codigoPedido, username, idTransaccion, userId) {
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Aprobar', callback_data: `approve:${codigoPedido}` },
      { text: '❌ Rechazar', callback_data: `reject:${codigoPedido}` }
    ]]
  };

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: ADMIN_CHAT_ID,
      text:
        `🔔 *Nueva solicitud de pago*\n\n` +
        `📋 Código: ${codigoPedido}\n` +
        `👤 Usuario: @${username}\n` +
        `🔢 ID Transacción: ${idTransaccion}\n\n` +
        `Verifica el ID en tu app Transfermóvil antes de aprobar.`,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    })
  });
}