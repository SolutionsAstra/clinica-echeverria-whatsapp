// whatsapp.js
// Envío de mensajes usando la API oficial de WhatsApp Business (Meta Cloud API).
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages

const axios = require('axios');

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v20.0';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;

const client = axios.create({
  baseURL: `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}`,
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
});

async function enviar(payload) {
  try {
    await client.post('/messages', payload);
  } catch (err) {
    console.error('Error enviando mensaje de WhatsApp:', err.response?.data || err.message);
  }
}

function enviarTexto(to, texto) {
  return enviar({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } });
}

// Botones: máximo 3 opciones, ideal para menús cortos (sí/no, confirmar/cambiar)
function enviarBotones(to, texto, botones) {
  return enviar({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: texto },
      action: { buttons: botones.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) }
    }
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
        sections: [{ title: 'Opciones', rows: filas.slice(0, 10).map(f => ({ id: f.id, title: f.title.slice(0, 24), description: f.description?.slice(0, 72) })) }]
      }
    }
  });
}

module.exports = { enviarTexto, enviarBotones, enviarLista };
