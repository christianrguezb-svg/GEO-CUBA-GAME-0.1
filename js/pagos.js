// ============================================
// MÓDULO DE PAGOS - Sistema con bot de Telegram
// ============================================

const PAGO = {
  overlay:        document.getElementById('pago-overlay'),
  cerrar:         document.getElementById('pago-cerrar'),
  codigoPedido:   document.getElementById('pago-codigo-pedido'),
  idTransaccion:  document.getElementById('pago-id-transaccion'),
  estado:         document.getElementById('pago-estado'),
  enviar:         document.getElementById('pago-enviar')
};

let codigoPedidoActual = null;
let callbackExito = null;
let intervaloVerificacion = null;

// --- Abrir modal de pago ---
async function abrirModalPago(callback) {
  callbackExito = callback;
  PAGO.overlay.style.display = 'flex';
  PAGO.estado.style.display = 'none';
  PAGO.idTransaccion.value = '';
  PAGO.enviar.disabled = true;
  PAGO.enviar.textContent = '⏳ Generando código...';

  // Crear solicitud en el backend
  try {
    const res = await fetch('/api/crear-solicitud', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      codigoPedidoActual = data.codigoPedido;
      PAGO.codigoPedido.value = data.codigoPedido;
      PAGO.enviar.disabled = false;
      PAGO.enviar.textContent = '📲 Enviar por Telegram';
    } else {
      throw new Error(data.error || 'No se pudo generar el código');
    }
  } catch (err) {
    console.error('Error:', err);
    PAGO.estado.textContent = '❌ ' + err.message;
    PAGO.estado.className = 'pago-estado error';
    PAGO.estado.style.display = 'block';
    PAGO.enviar.disabled = false;
    PAGO.enviar.textContent = 'Reintentar';
  }
}

// --- Cerrar modal ---
function cerrarModalPago() {
  PAGO.overlay.style.display = 'none';
  if (intervaloVerificacion) {
    clearInterval(intervaloVerificacion);
    intervaloVerificacion = null;
  }
}

// --- Mostrar estado ---
function mostrarEstadoPago(mensaje, tipo = 'info') {
  PAGO.estado.textContent = mensaje;
  PAGO.estado.className = 'pago-estado ' + tipo;
  PAGO.estado.style.display = 'block';
}

// --- Enviar por Telegram ---
PAGO.enviar.addEventListener('click', async () => {
  const idTransaccion = PAGO.idTransaccion.value.trim();

  if (idTransaccion.length < 6) {
    mostrarEstadoPago('⚠️ Ingresa un ID de transacción válido (mínimo 6 dígitos)', 'error');
    return;
  }
  if (!codigoPedidoActual) {
    mostrarEstadoPago('⚠️ No hay código de pedido. Cierra y vuelve a intentar.', 'error');
    return;
  }

  mostrarEstadoPago('📲 Abriendo Telegram...', 'info');

  // Construir el texto pre-rellenado
  const texto = `${codigoPedidoActual} ${idTransaccion}`;
  const url = `https://t.me/geocuba_pagos_bot?text=${encodeURIComponent(texto)}`;

  // Abrir en nueva ventana/pestaña
  window.open(url, '_blank');

  // Cambiar el estado después de 2 segundos
  setTimeout(() => {
    mostrarEstadoPago(
      '✅ Envía el mensaje en Telegram. El sistema detectará tu pago automáticamente.',
      'exito'
    );
  }, 2000);

  // Empezar a verificar el estado
  iniciarVerificacionPago();
});

// --- Verificar estado cada 3 segundos ---
function iniciarVerificacionPago() {
  if (intervaloVerificacion) clearInterval(intervaloVerificacion);

  intervaloVerificacion = setInterval(async () => {
    if (!codigoPedidoActual) return;
    try {
      const res = await fetch(`/api/verificar-solicitud?codigo=${codigoPedidoActual}`);
      const data = await res.json();

      if (data.estado === 'aprobado') {
        clearInterval(intervaloVerificacion);
        intervaloVerificacion = null;

        mostrarEstadoPago('🎉 ¡Pago aprobado! Desbloqueando Urbano...', 'exito');

        setTimeout(() => {
          cerrarModalPago();
          if (typeof callbackExito === 'function') callbackExito();
        }, 1500);

      } else if (data.estado === 'rechazado') {
        clearInterval(intervaloVerificacion);
        intervaloVerificacion = null;
        mostrarEstadoPago('❌ El pago no pudo ser verificado. Contacta al soporte.', 'error');
        PAGO.enviar.disabled = false;
        PAGO.enviar.textContent = 'Reintentar';
      }
    } catch (err) {
      console.warn('Error verificando pago:', err);
    }
  }, 3000);
}

// --- Cerrar modal ---
PAGO.cerrar.addEventListener('click', cerrarModalPago);
PAGO.overlay.addEventListener('click', (e) => {
  if (e.target === PAGO.overlay) cerrarModalPago();
});

// --- Clic en el número para copiar ---
document.querySelector('.pago-numero')?.addEventListener('click', function () {
  const numero = this.textContent.trim();
  navigator.clipboard.writeText(numero).then(() => {
    const original = this.textContent;
    this.textContent = '✅ Copiado!';
    setTimeout(() => { this.textContent = original; }, 1500);
  });
});

// --- Verificar desbloqueo ---
function urbanoDesbloqueado() {
  return localStorage.getItem('geocuba_urbano_pagado') === 'true';
}

function marcarUrbanoDesbloqueado() {
  localStorage.setItem('geocuba_urbano_pagado', 'true');
}