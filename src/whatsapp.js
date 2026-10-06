// whatsapp.js
// Envío de mensajes con la API oficial de WhatsApp Business (Meta Cloud API).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
//
// Dos contratos:
//   enviarTexto / enviarBotones / enviarLista → NO lanzan (los usa engine.js en la conversación).
//   enviarTextoEstricto                        → LANZA si Meta rechaza (puerto Notifier del panel,
//                                                para registrar notificacion_error en la derivación).

const axios = require('axios');

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v20.0';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;

const client = axios.create({
  baseURL: `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}`,
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  timeout: 10000,
});

async function enviarOFallar(payload) {
  if (!PHONE_ID || !TOKEN) {
    throw Object.assign(new Error('WhatsApp no configurado (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN)'), { code: 'WHATSAPP_NO_CONFIGURADO' });
  }
  try {
    await client.post('/messages', payload);
  } catch (err) {
    const meta = err.response && err.response.data && err.response.data.error;
    const detalle = meta
      ? `Meta ${meta.code}${meta.error_subcode ? `/${meta.error_subcode}` : ''}: ${meta.message}`
      : err.message;
    throw Object.assign(new Error(detalle), {
      code: 'WHATSAPP_ENVIO_FALLIDO',
      status: err.response ? err.response.status : undefined,
      meta,
      cause: err,
    });
  }
}

async function enviar(payload) {
  try {
    await enviarOFallar(payload);
  } catch (err) {
    console.error('Error enviando mensaje de WhatsApp:', err.meta || err.message);
  }
}

const payloadTexto = (to, texto) => ({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } });

function enviarTexto(to, texto) {
  return enviar(payloadTexto(to, texto));
}

function enviarTextoEstricto(to, texto) {
  return enviarOFallar(payloadTexto(to, texto));
}

// Botones: máximo 3 opciones, ideal para menús cortos (sí/no, confirmar/cambiar)
function enviarBotones(to, texto, botones) {
  return enviar({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: texto },
      action: { buttons: botones.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  });
}

// Listas: hasta 10 opciones, ideal para el menú de especialidades u horarios
function enviarLista(to, texto, tituloBoton, filas) {
  return enviar({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: texto },
      action: {
        button: tituloBoton,
        sections: [{ title: 'Opciones', rows: filas.slice(0, 10).map((f) => ({ id: f.id, title: f.title.slice(0, 24), description: f.description?.slice(0, 72) })) }],
      },
    },
  });
}

module.exports = { enviarTexto, enviarTextoEstricto, enviarBotones, enviarLista };