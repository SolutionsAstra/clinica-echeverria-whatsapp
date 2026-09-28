# Handoff: Bandeja de Derivaciones de la IA (frontend recepción)

## Estado
- Entregado `BandejaDerivaciones.jsx` (React 18 + Tailwind 3.3+ + lucide-react). Renderiza sin errores con 6 solicitudes demo.
- La acción "Reservar & Notificar" hoy es una simulación (`simularReservaYNotificacion`, 900 ms). Se reemplaza pasando la prop `onReservar`.

## Contrato que espera el componente
Prop `solicitudes`, un arreglo de:
`{ id, paciente, telefono, especialidad: 'neurologia'|'eeg'|'pediatria'|'estetica', bloque: 'manana'|'tarde', fecha: 'YYYY-MM-DD', doctorId, doctorName, capturadaEn: ISO, acudiente?, notas?, horasDisponibles?: ['HH:MM'] }`

`onReservar(payload, solicitud)` recibe el mismo cuerpo que `POST /api/vet/citas` (ver `INTEGRACION_VET.md`) más `derivacionId`. Si falla, lanzar un error con `code` (`SLOT_TAKEN`, `SLOT_NOT_OFFERED`, `BUSY_RETRY`, `INVALID_INPUT`) o dejar el `error` en `response.data`; el componente muestra el mensaje y, si la hora se perdió, la limpia.

## Pendiente en backend
1. Endpoint para listar derivaciones pendientes (hoy solo existe `db.registrarEscalada`; falta capturar especialidad, bloque y fecha).
2. Endpoint con sesión (`requireLogin`) tipo `POST /api/derivaciones/:id/reservar` que llame a `vet.book` y luego a `wa.enviarTexto`. El navegador nunca debe llevar `x-api-key` de `/api/vet` ni `WHATSAPP_TOKEN`.
3. Poblar `horasDisponibles` desde `GET /api/vet/disponibilidad` para deshabilitar horas ocupadas.
4. Confirmar duraciones (neurología 60, EEG 120, pediatría 30, estética 45) contra `src/modules/vet/domain/specialty`.

## Siguiente pieza
Calendario unificado de citas: reutilizar `ESPECIALIDADES` (colores y duraciones) exportado desde el componente para que ambas vistas agrupen igual.

## Skills sugeridas
`uiux-pro-max`, `frontend-design`, `engineering:system-design` (para los endpoints), `tdd`.
