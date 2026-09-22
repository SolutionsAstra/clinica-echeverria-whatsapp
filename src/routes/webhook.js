// routes/webhook.js
const express = require('express');
const router = express.Router();
const engine = require('../engine');

// Meta llama a este endpoint UNA vez al configurar el webhook, para verificar que te pertenece.
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verificado correctamente.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta envía aquí cada mensaje entrante del paciente.
router.post('/', async (req, res) => {
  // Responder rápido siempre — el procesamiento no debe bloquear el ack a Meta.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const mensaje = value?.messages?.[0];
    if (!mensaje) return; // puede ser un evento de "status" (entregado/leído), lo ignoramos

    const telefono = mensaje.from;
    let texto = null, idInteractivo = null;

    if (mensaje.type === 'text') {
      texto = mensaje.text.body;
    } else if (mensaje.type === 'interactive') {
      idInteractivo = mensaje.interactive?.button_reply?.id || mensaje.interactive?.list_reply?.id;
    }

    await engine.procesarMensaje(telefono, texto, idInteractivo);
  } catch (err) {
    console.error('Error procesando mensaje entrante:', err);
  }
});

module.exports = router;
