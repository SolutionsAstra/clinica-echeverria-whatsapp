# Asistente de WhatsApp — Clínica Echeverría

Backend funcional (no es un prototipo) que conecta con la **API oficial de WhatsApp
Business (Meta Cloud API)** y automatiza el agendamiento de citas para las 4
especialidades: Electroencefalografía, Medicina estética, Pediatría y Neurología.

## Qué incluye

- Webhook de WhatsApp (verificación + recepción de mensajes)
- Máquina de estados de conversación (`src/engine.js`) con las reglas de cada especialidad
- Motor de disponibilidad que evita doble reserva de doctor **y** de la sala/equipo de EEG
- Job automático de recordatorios (24h y 2h antes de la cita)
- Job diario que genera un Excel por especialidad y lo envía por correo a cada doctor,
  con un stub listo para disparar el refresh de un dataset de Power BI
- Panel administrativo web (`/admin`) para gestionar citas, horarios y reportes
- **Base de datos en SQL Server** (`sql/schema.sql` + `sql/seed.sql`) — ya no es un
  archivo JSON local, es la base de datos real lista para producción

## 1. Requisitos previos

- Node.js 18 o superior
- **SQL Server** (local, en un contenedor Docker, o Azure SQL) accesible desde donde
  corra este servidor
- Una cuenta de **Meta for Developers** con una app de tipo "Business" y el producto
  **WhatsApp** agregado: https://developers.facebook.com/apps
- Para pruebas locales: [ngrok](https://ngrok.com/) (o similar) para exponer tu
  `localhost` a internet, ya que Meta necesita una URL pública HTTPS para el webhook

## 2. Base de datos

1. Crea la base de datos vacía, por ejemplo desde SSMS o `sqlcmd`:
   ```sql
   CREATE DATABASE ClinicaEcheverria;
   ```
2. Ejecuta el esquema:
   ```bash
   sqlcmd -S localhost -U sa -P tu_clave -d ClinicaEcheverria -i sql/schema.sql
   ```
3. Carga los datos iniciales (doctores, especialidades, horarios):
   ```bash
   sqlcmd -S localhost -U sa -P tu_clave -d ClinicaEcheverria -i sql/seed.sql
   ```

Si prefieres SSMS o Azure Data Studio, simplemente abre y ejecuta ambos archivos
en ese orden (`schema.sql` primero, `seed.sql` después) contra la base de datos vacía.

> **Nota:** `STRING_AGG` (usado para listar las especialidades de cada doctor) requiere
> SQL Server 2017 o superior. Si usas una versión anterior, avísame y lo adapto.

## 3. Instalación del backend

```bash
npm install
cp .env.example .env
```

Edita `.env` con tus datos reales:

| Variable | Dónde conseguirla |
|---|---|
| `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` | Credenciales de tu instancia de SQL Server |
| `DB_TRUST_CERT` | `true` en desarrollo local; en producción con certificado válido, ponlo en `false` |
| `WHATSAPP_TOKEN` | Meta for Developers → tu app → WhatsApp → API Setup (token temporal) o System User token permanente |
| `WHATSAPP_PHONE_NUMBER_ID` | Misma pantalla, "Phone number ID" del número de prueba o el número real de la clínica |
| `WHATSAPP_VERIFY_TOKEN` | Lo inventas tú — cualquier palabra secreta, la usarás también al configurar el webhook en Meta |
| `SMTP_*` | Credenciales del correo desde el que se enviarán los reportes (ej. Office365 de la clínica) |
| `ADMIN_USER`, `ADMIN_PASS` | *(ya no se usan — el login del panel ahora es por usuario/contraseña en la tabla `usuarios`, ver sección 7)* |
| `SESSION_SECRET` | Cualquier cadena larga y aleatoria — firma las cookies de sesión del panel. Cámbiala en producción. |

## 4. Levantar el servidor

```bash
npm run dev
```

Si la conexión a SQL Server falla, verás el error en la consola apenas llegue la
primera petición (la conexión es "perezosa", se abre en el primer query, no al
arrancar) — revisa `DB_SERVER`/credenciales/firewall si eso pasa.

En otra terminal, expón el puerto con ngrok:

```bash
ngrok http 3000
```

Copia la URL HTTPS que te da ngrok (ej. `https://abcd1234.ngrok-free.app`).

## 5. Configurar el webhook en Meta

1. En tu app → WhatsApp → Configuration → Webhook → **Edit**
2. Callback URL: `https://TU_URL_DE_NGROK/webhook`
3. Verify token: el mismo valor que pusiste en `WHATSAPP_VERIFY_TOKEN`
4. Suscríbete al campo **messages**

Meta hará un GET a tu webhook para verificarlo — si el servidor está corriendo, esto
pasa automáticamente.

## 6. Probar

Desde WhatsApp, escríbele al número de prueba que te dio Meta (en la pantalla de
API Setup hay un número de teléfono personal que puedes agregar como destinatario
de prueba). Escribe "hola" y deberías recibir el menú principal.

> **Nota sobre el número de prueba de Meta:** solo permite enviar mensajes a números
> que agregues manualmente en la consola mientras no verifiques tu negocio ante Meta
> (Business Verification). Para producción con clientes reales, necesitas completar
> esa verificación y comprar/portar el número real de la clínica.

## 7. Panel administrativo y roles

Una vez el servidor esté corriendo, entra a:

```
http://localhost:3000/admin
```

Te pedirá **correo y contraseña** (ya no es un usuario/clave compartido — cada
persona de la clínica tiene su propia cuenta). El `seed.sql` trae 3 usuarios de
ejemplo, cada uno con un rol distinto:

| Rol | Correo de ejemplo | Contraseña de ejemplo | Qué puede hacer |
|---|---|---|---|
| **Recepción** | `recepcion@clinicaecheverria.com` | `recepcion123` | Ver y filtrar todas las citas, cancelarlas o marcarlas no-show, ver las conversaciones escaladas a un asesor. No ve reportes ni puede editar horarios de doctores. |
| **Doctor** | `rojas@clinicaecheverria.com` | `doctor123` | Ve **solo su propia agenda** (el sistema lo filtra automáticamente, no importa qué le pidas por la URL/API), puede cancelar o marcar no-show únicamente en sus propias citas. |
| **Dirección** | `direccion@clinicaecheverria.com` | `direccion123` | Acceso completo: todas las citas, editar horarios de cualquier doctor, ver y disparar reportes, ver escaladas. |

> ⚠️ **Cambia estas contraseñas antes de producción.** Están en `sql/seed.sql`
> como hashes de bcrypt (no en texto plano), pero son las mismas para cualquiera
> que descargue este proyecto — genera hashes nuevos con
> `node -e "console.log(require('bcryptjs').hashSync('tu-clave-nueva', 10))"`
> y actualiza la tabla `usuarios` con el resultado.

La separación de permisos vive en dos lugares:
- **Backend** (`src/middleware/auth.js` + `src/routes/adminApi.js`): cada endpoint
  exige sesión iniciada, y varios además exigen un rol específico. Esta es la
  protección real — aunque alguien manipule la interfaz, la API igual rechaza
  lo que su rol no permite (lo probé con `curl`: un doctor que intenta cancelar
  la cita de otro doctor recibe `403`, aunque cambie el ID manualmente).
- **Frontend** (`public/admin/app.js`): oculta del menú las pestañas que ese
  rol no usa, solo para que la interfaz no muestre botones inútiles — es
  cosmético, no es la seguridad de verdad.

El panel consulta las mismas tablas de SQL Server que usa el motor conversacional —
no es una maqueta aparte, así que lo que hagas ahí (cancelar una cita, cambiar un
horario) se refleja de inmediato en lo que el bot ofrece por WhatsApp.

## 8. Datos iniciales (doctores, horarios y usuarios)

Los doctores, especialidades y horarios de ejemplo están en `sql/seed.sql`. Edítalos
ahí con los datos reales de Clínica Echeverría antes de ir a producción, o gestiónalos
después directamente desde el panel administrativo (los horarios ya son editables ahí;
agregar/editar doctores es un paso natural para sumar al panel más adelante).

## 9. Gestión de usuarios desde el panel

Ya no hace falta tocar SQL para crear o editar cuentas del panel — la pestaña
**Usuarios** (visible solo para el rol Dirección) permite:

- Crear un usuario nuevo (nombre, correo, contraseña, rol, y el doctor asociado
  si el rol es "Doctor")
- Cambiar el rol o el doctor asociado de un usuario existente
- Activar/desactivar una cuenta (un usuario desactivado no puede iniciar sesión,
  aunque conozca su contraseña — lo verifiqué probándolo)
- Restablecer la contraseña de cualquier usuario sin necesitar la anterior

Protecciones que ya están puestas (probadas con `curl` antes de entregar):
- Un correo duplicado responde `409`, no crea una cuenta duplicada
- Crear un usuario con rol "Doctor" sin indicar a qué doctor corresponde responde `400`
- Contraseñas de menos de 6 caracteres se rechazan
- **Dirección no puede desactivar su propia cuenta** (evita quedarse afuera del panel por accidente)
- Solo el rol Dirección llega a estos endpoints — cualquier otro rol recibe `403`

## 10. Siguientes pasos sugeridos

- [ ] Verificar el negocio ante Meta para poder escribir a cualquier número
- [ ] Configurar `POWERBI_*` en `.env` si vas a usar el refresh automático
- [ ] Mover las sesiones (login del panel Y sesiones de conversación de
      `src/sessions.js`) a un store compartido como Redis si vas a correr más
      de una instancia del servidor
- [ ] Agregar migraciones versionadas (ej. con `db-migrate` o Flyway) en vez de
      correr `schema.sql` a mano, para cuando el esquema evolucione
- [ ] "Recuperar contraseña" para el panel (hoy si alguien la olvida, hay que
      regenerar el hash a mano)
