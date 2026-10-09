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
const crypto = require('crypto');

/** Firma de Meta: "sha256=" + HMAC-SHA256(App Secret, cuerpo crudo). Comparación en tiempo constante. */
function firmaValida(req) {
  const secreto = process.env.WHATSAPP_APP_SECRET;
  const firma = req.get('x-hub-signature-256') || '';
  if (!secreto || !Buffer.isBuffer(req.rawBody) || !firma.startsWith('sha256=')) return false;
  const esperada = Buffer.from(`sha256=${crypto.createHmac('sha256', secreto).update(req.rawBody).digest('hex')}`);
  const recibida = Buffer.from(firma);
  return recibida.length === esperada.length && crypto.timingSafeEqual(recibida, esperada);
}

router.post('/', (req, res) => {
  if (!firmaValida(req)) {
    console.warn('[webhook] POST rechazado: firma X-Hub-Signature-256 ausente o inválida');
    return res.sendStatus(401);
  }
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
