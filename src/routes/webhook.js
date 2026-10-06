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
router.post('/', (req, res) => {
  res.sendStatus(200);
  const mensajes = (req.body?.entry ?? []).flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []);
  for (const mensaje of mensajes) {
    if (yaProcesado(mensaje.id)) continue;
    const texto = mensaje.type === 'text' ? mensaje.text?.body ?? null : null;
    const idInteractivo = mensaje.type === 'interactive'
      ? mensaje.interactive?.button_reply?.id || mensaje.interactive?.list_reply?.id || null
      : null;
    enCola(mensaje.from, () => engine.procesarMensaje(mensaje.from, texto, idInteractivo))
      .catch((err) => console.error('Error procesando mensaje entrante:', err));
  }
});

module.exports = router;
