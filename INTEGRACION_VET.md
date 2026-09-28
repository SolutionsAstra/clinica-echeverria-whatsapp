# Integración del módulo VET

Cambios puntuales sobre archivos existentes. Los archivos nuevos del módulo
(`src/modules/vet/**`, `src/integrations/vetClient.js`, `sql/migrations/001_modulo_vet.sql`,
`tsconfig.json`) se copian tal cual.

## 0. Archivos que se eliminan

```bash
git rm src/db.js                                                        # reemplazado por src/db.ts
git rm src/modules/vet/infrastructure/mssql/mssql-busy-agenda.ts        # esqueleto con tablas inexistentes
npm uninstall mssql
```

`src/db.js` **debe** borrarse: si conviven `db.js` y `db.ts`, `require('./db')`
resuelve primero el `.js` y seguirías usando SQL Server sin darte cuenta.

## 1. `package.json`

Usa el `package.json` incluido (agrega `pg`, `@types/pg`, TypeScript, `tsx` y los scripts):

```bash
npm i pg && npm i -D typescript tsx @types/node @types/express@4 @types/pg
```

`allowJs` compila todo `src/` (JS legado + TS nuevo) a `dist/`, así el proyecto
sigue siendo CommonJS: `require('./db')` y `require('./modules/vet')` funcionan
desde los `.js` existentes sin tocarlos. En desarrollo `tsx` resuelve los `.ts`.

## 2. `src/db.ts`

Misma API pública que `db.js` (mismos nombres de función y mismos parámetros),
incluido `getPool()`, que sigue siendo perezoso y devuelve `Promise<Pool>`.
Ningún consumidor (rutas, jobs, `engine.js`, `availability.js`) necesita cambios.

## 3. `src/server.js` — montar el servicio

```js
const { getPool } = require('./db');
const { createVetModule, requireApiKey } = require('./modules/vet');

const vetModule = createVetModule({ getPool, schema: process.env.DB_SCHEMA || 'public' });
```

Y **antes** de `app.use('/api', requireLogin, adminApiRoutes);` (si va después,
`requireLogin` intercepta `/api/vet` y responde 401 al asistente):

```js
// Servicio VET: consumido por el Asistente de WhatsApp con API key, sin sesión del panel.
app.use('/api/vet', requireApiKey(process.env.VET_API_KEY), vetModule.router);
```

Opcional, para cerrar conexiones al apagar:

```js
const { closePool } = require('./db');
process.on('SIGTERM', () => closePool().finally(() => process.exit(0)));
```

## 4. `.env` / `.env.example`

Las variables `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`,
`DB_ENCRYPT` y `DB_TRUST_CERT` ya no se usan. Se reemplazan por:

```dotenv
# Supabase → Connect → Session pooler (puerto 5432). NO agregues ?sslmode=… a la URL:
# pg le da prioridad sobre la configuración TLS de db.ts.
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres
# Certificado de Supabase (Database → SSL Configuration → Download certificate)
DB_SSL_CA_PATH=./certs/supabase-prod-ca.crt
DB_POOL_MAX=10
DB_SCHEMA=public

# Genérala con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
VET_API_KEY=
VET_API_URL=http://localhost:3000/api/vet
```

## 5. Base de datos

Ya aplicada en el proyecto `clinica-echeverria-core` (esquema, datos iniciales y
migración 001). Para otro entorno, ejecuta los tres scripts de PostgreSQL en ese
orden desde el SQL Editor de Supabase.

## 6. `src/engine.js` — el asistente consume el servicio

Arriba del archivo:

```js
const vet = require('./integrations/vetClient');

const TZ = 'America/Caracas';
const NOMBRE_ESPECIALIDAD = { eeg: 'Electroencefalografía', estetica: 'Medicina estética', pediatria: 'Pediatría', neurologia: 'Neurología' };
const ETIQUETA_DIA = { hoy: 'Hoy', manana: 'Mañana', pasado_manana: 'Pasado mañana' };

function tituloDia(dia) {
  const [, mes, d] = dia.date.split('-');
  const base = ETIQUETA_DIA[dia.label]
    || new Date(`${dia.date}T12:00:00Z`).toLocaleDateString('es-VE', { weekday: 'long', timeZone: 'UTC' });
  return `${base} ${d}/${mes}`.slice(0, 20); // límite de título de botón de WhatsApp
}
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
```

Reemplaza `fmt` (hoy usa el huso del servidor, no el de Caracas):

```js
function fmt(fecha) {
  return new Date(fecha).toLocaleString('es-VE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
```

Quita `const { slotsDisponibles } = require('./availability');` y reemplaza `mostrarHorarios`
completo. El paciente elige primero el día (máx. 3 botones = la ventana VET) y luego la hora:

```js
async function mostrarHorarios(telefono, sesion) {
  let disp;
  try {
    disp = await vet.obtenerDisponibilidad(sesion.datos.especialidad);
  } catch (err) {
    console.error('Módulo VET no disponible:', err.code, err.message);
    await db.registrarEscalada(telefono, `Agenda no disponible (${err.code})`);
    await wa.enviarTexto(telefono, 'No pude consultar la agenda en este momento. Un asesor te contactará para coordinar. 🙏');
    sessions.reset(telefono);
    return;
  }

  const dias = disp.days.filter(d => d.slots.length > 0);
  if (dias.length === 0) {
    await db.registrarEscalada(telefono, `Sin cupos en ventana VET: ${sesion.datos.especialidad}`);
    await wa.enviarTexto(telefono, 'No hay horarios disponibles en los próximos 3 días. Un asesor te contactará para coordinar.');
    sessions.reset(telefono);
    return;
  }

  sesion.datos.especialidadNombre = NOMBRE_ESPECIALIDAD[sesion.datos.especialidad];
  sesion.datos.diasOfrecidos = dias;
  await wa.enviarBotones(telefono,
    `¿Qué día prefieres para ${sesion.datos.especialidadNombre}? (duración: ${disp.durationMin} min)`,
    dias.map((d, i) => ({ id: `dia_${i}`, title: tituloDia(d) }))
  );
  sesion.paso = 'dia';
}
```

Nuevo `case` (junto a `'horario'`):

```js
    case 'dia': {
      const dia = sesion.datos.diasOfrecidos?.[parseInt(entrada.replace('dia_', ''), 10)];
      if (!dia) { await wa.enviarTexto(telefono, 'Selecciona uno de los días de la lista.'); break; }
      const slots = dia.slots.slice(0, 10); // una lista de WhatsApp admite máx. 10 filas
      sesion.datos.slotsOfrecidos = slots;
      await wa.enviarLista(telefono, `Horarios disponibles — ${tituloDia(dia)}:`, 'Ver horarios',
        slots.map((s, i) => ({ id: `slot_${i}`, title: `${hora(s.start)} · ${s.doctorName}`.slice(0, 24) }))
      );
      sesion.paso = 'horario';
      break;
    }
```

`case 'horario'`: cambia solo el mensaje de confirmación (el slot ahora trae `start` y `doctorName`):

```js
      await wa.enviarBotones(telefono,
        `Confirmo tu cita:\n📅 ${fmt(slot.start)}\n👨‍⚕️ ${slot.doctorName}\n🏥 ${sesion.datos.especialidadNombre}`,
        [{ id: 'conf_si', title: 'Confirmar' }, { id: 'conf_cambiar', title: 'Cambiar horario' }]
      );
```

`case 'confirmar'`: reemplaza el bloque `db.upsertPaciente(...)` + `db.crearCita(...)` por:

```js
        const slot = sesion.datos.slotElegido;
        try {
          await vet.reservar({
            especialidad: sesion.datos.especialidad,
            doctorId: slot.doctorId,
            inicio: slot.start,
            paciente: {
              telefono,
              nombre: sesion.datos.nombrePaciente,
              esMenor: !!sesion.datos.esMenor,
              nombreAcudiente: sesion.datos.datosAcudiente || null
            },
            notas: sesion.datos.procedimiento || sesion.datos.areaValoracion || null
          });
        } catch (err) {
          if (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_NOT_OFFERED') {
            await wa.enviarTexto(telefono, 'Ese horario acaba de ocuparse 😕 Te muestro los disponibles actualizados.');
            await mostrarHorarios(telefono, sesion);
            break;
          }
          throw err;
        }
        await wa.enviarTexto(telefono, '✅ ¡Cita confirmada! Te enviaremos un recordatorio antes de tu cita.');
        // ...el resto (seguimiento de EEG tras Neurología) queda igual
```

Con esto `src/availability.js` queda sin uso. Bórralo cuando confirmes que ningún job
o ruta del panel lo importa (`grep -rn "availability" src/`).

## Contrato HTTP

`GET /api/vet/disponibilidad?especialidad=neurologia` (header `x-api-key`)

```json
{
  "specialty": "neurologia",
  "durationMin": 60,
  "timeZone": "America/Caracas",
  "generatedAt": "2026-09-28T15:20:00-04:00",
  "days": [
    { "date": "2026-09-29", "label": "manana", "slots": [
      { "start": "2026-09-29T08:00:00-04:00", "end": "2026-09-29T09:00:00-04:00", "doctorId": 1, "doctorName": "Dr. Rojas" }
    ]},
    { "date": "2026-09-30", "label": "pasado_manana", "slots": [] },
    { "date": "2026-10-01", "label": "dia_4", "slots": [] }
  ]
}
```

`POST /api/vet/citas`

```json
{ "especialidad": "neurologia", "doctorId": 1, "inicio": "2026-09-29T08:00:00-04:00",
  "paciente": { "telefono": "584141234567", "nombre": "Ana Pérez" }, "notas": null }
```

| Status | `error` | Significado |
|---|---|---|
| 201 | — | Cita creada: `{ appointmentId, patientId, doctorId, doctorName, resourceId, start, end }` |
| 400 | `INVALID_INPUT` / `especialidad_invalida` | Datos mal formados |
| 401 | `api_key_invalida` | Falta o no coincide `x-api-key` |
| 409 | `SLOT_TAKEN` | Otro paciente reservó primero: volver a pedir disponibilidad |
| 422 | `SLOT_NOT_OFFERED` | Fuera de la ventana VET, desalineado, fuera de turno u ocupado |
| 503 | `BUSY_RETRY` | Contención de candados >5 s: reintentar |
| 500 | `RESOURCE_NOT_CONFIGURED` | Falta la fila en `recursos` (corre la migración) |
