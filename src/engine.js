// engine.js
// Máquina de estados de la conversación. Cada paso decide qué se envía
// y a qué paso se pasa según la respuesta del paciente.
// Ahora todas las operaciones de datos son async contra SQL Server.

const wa = require('./whatsapp');
const db = require('./db');
const sessions = require('./sessions');
const { slotsDisponibles } = require('./availability');

function fmt(fecha) {
  return new Date(fecha).toLocaleString('es-VE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function procesarMensaje(telefono, texto, idInteractivo) {
  const sesion = sessions.get(telefono);
  const entrada = (idInteractivo || texto || '').trim();
  const entradaLower = entrada.toLowerCase();

  if (['asesor', 'humano', 'ayuda'].includes(entradaLower)) {
    await db.registrarEscalada(telefono, 'Solicitud explícita del paciente');
    await wa.enviarTexto(telefono, 'Te voy a comunicar con nuestro equipo, un momento por favor 🙋');
    sessions.reset(telefono);
    return;
  }
  if (entradaLower === 'cancelar' && sesion.paso !== 'inicio') {
    sessions.reset(telefono);
    await wa.enviarTexto(telefono, 'Cancelé el proceso actual. Escribe "hola" para empezar de nuevo cuando quieras.');
    return;
  }

  switch (sesion.paso) {
    case 'inicio':
      await wa.enviarLista(telefono, `👋 Hola, bienvenido/a a Clínica Echeverría. Soy tu asistente virtual.\n¿Qué deseas hacer hoy?`, 'Ver opciones', [
        { id: 'menu_agendar', title: 'Agendar cita' },
        { id: 'menu_ver_cita', title: 'Ver/cancelar mi cita' },
        { id: 'menu_asesor', title: 'Hablar con un asesor' }
      ]);
      sesion.paso = 'menu_principal';
      break;

    case 'menu_principal':
      if (entrada === 'menu_agendar') {
        await wa.enviarLista(telefono, '¿Qué especialidad necesitas?', 'Ver especialidades', [
          { id: 'esp_eeg', title: 'Electroencefalografía' },
          { id: 'esp_estetica', title: 'Medicina estética' },
          { id: 'esp_pediatria', title: 'Pediatría' },
          { id: 'esp_neurologia', title: 'Neurología' }
        ]);
        sesion.paso = 'especialidad';
      } else if (entrada === 'menu_ver_cita') {
        await wa.enviarTexto(telefono, 'Escribe el número de teléfono con el que agendaste (o escribe "este" para usar este número).');
        sesion.paso = 'ver_cita_telefono';
      } else if (entrada === 'menu_asesor') {
        await db.registrarEscalada(telefono, 'Solicitud desde menú principal');
        await wa.enviarTexto(telefono, 'Te voy a comunicar con nuestro equipo, un momento por favor 🙋');
        sessions.reset(telefono);
      } else {
        await wa.enviarTexto(telefono, 'No entendí esa opción, por favor selecciona una de la lista. 🙏');
      }
      break;

    // ---------------- Ver / cancelar cita ----------------
    case 'ver_cita_telefono': {
      const tel = entradaLower === 'este' ? telefono : entrada;
      const citas = await db.citasFuturasPorTelefono(tel);
      if (citas.length === 0) {
        await wa.enviarTexto(telefono, 'No encontré citas próximas con ese número.');
        sessions.reset(telefono);
        break;
      }
      const cita = citas[0];
      sesion.datos.citaId = cita.id;
      await wa.enviarBotones(telefono,
        `Encontré esta cita:\n📅 ${fmt(cita.fecha_hora_inicio)}\n👨‍⚕️ ${cita.doctor_nombre}\n🏥 ${cita.especialidad_nombre}`,
        [{ id: 'cita_cancelar', title: 'Cancelar' }, { id: 'cita_dejar', title: 'Dejarla así' }]
      );
      sesion.paso = 'ver_cita_accion';
      break;
    }
    case 'ver_cita_accion': {
      if (entrada === 'cita_cancelar') {
        await db.cancelarCita(sesion.datos.citaId);
        await wa.enviarTexto(telefono, 'Tu cita fue cancelada. El horario quedó libre para otro paciente.');
      } else {
        await wa.enviarTexto(telefono, 'Perfecto, nos vemos en tu cita 🙌');
      }
      sessions.reset(telefono);
      break;
    }

    // ---------------- Selección de especialidad ----------------
    case 'especialidad': {
      const mapa = { esp_eeg: 'eeg', esp_estetica: 'estetica', esp_pediatria: 'pediatria', esp_neurologia: 'neurologia' };
      const clave = mapa[entrada];
      if (!clave) { await wa.enviarTexto(telefono, 'Por favor selecciona una especialidad de la lista.'); break; }
      sesion.datos.especialidad = clave;

      if (clave === 'eeg') {
        await wa.enviarBotones(telefono,
          'Perfecto. Antes de continuar, ten en cuenta:\n• Dormir pocas horas la noche anterior\n• Evitar cafeína 12h antes\n• Cabello limpio, sin productos\n¿Continuamos?',
          [{ id: 'eeg_si', title: 'Sí, continuar' }, { id: 'eeg_no', title: 'No, más tarde' }]
        );
        sesion.paso = 'eeg_confirmar_instrucciones';
      } else if (clave === 'estetica') {
        await wa.enviarLista(telefono, '¿Qué procedimiento te interesa?', 'Ver opciones', [
          { id: 'proc_botox', title: 'Botox' },
          { id: 'proc_limpieza', title: 'Limpieza facial' },
          { id: 'proc_valoracion', title: 'Consulta valorativa' }
        ]);
        sesion.paso = 'estetica_procedimiento';
      } else if (clave === 'pediatria') {
        await wa.enviarBotones(telefono, '¿Es para ti o para un menor de edad?', [
          { id: 'ped_menor', title: 'Para un menor' }, { id: 'ped_adulto', title: 'Para mí' }
        ]);
        sesion.paso = 'pediatria_quien';
      } else if (clave === 'neurologia') {
        await wa.enviarTexto(telefono, '¿A nombre de quién agendo la cita? Escribe el nombre completo del paciente.');
        sesion.paso = 'pedir_nombre';
      }
      break;
    }

    case 'eeg_confirmar_instrucciones':
      if (entrada === 'eeg_si') {
        await wa.enviarTexto(telefono, '¿A nombre de quién agendo la cita? Escribe el nombre completo del paciente.');
        sesion.paso = 'pedir_nombre';
      } else {
        await wa.enviarTexto(telefono, 'Sin problema, aquí estaré cuando quieras agendar.');
        sessions.reset(telefono);
      }
      break;

    case 'estetica_procedimiento': {
      const mapa = { proc_botox: 'Botox', proc_limpieza: 'Limpieza facial', proc_valoracion: 'Consulta valorativa' };
      const nombre = mapa[entrada];
      if (!nombre) { await wa.enviarTexto(telefono, 'Selecciona una opción de la lista.'); break; }
      sesion.datos.procedimiento = nombre;
      if (entrada === 'proc_valoracion') {
        await wa.enviarTexto(telefono, '¿Qué área te gustaría valorar en la consulta? (rostro, cicatrices, manchas, etc.)');
        sesion.paso = 'estetica_area';
      } else {
        await wa.enviarTexto(telefono, '¿A nombre de quién agendo la cita? Escribe el nombre completo del paciente.');
        sesion.paso = 'pedir_nombre';
      }
      break;
    }
    case 'estetica_area':
      sesion.datos.areaValoracion = entrada;
      await wa.enviarTexto(telefono, '¿A nombre de quién agendo la cita? Escribe el nombre completo del paciente.');
      sesion.paso = 'pedir_nombre';
      break;

    case 'pediatria_quien':
      if (entrada === 'ped_menor') {
        await wa.enviarTexto(telefono, 'Indícame el nombre del niño/a y su fecha de nacimiento.');
        sesion.paso = 'pediatria_datos_nino';
      } else {
        await wa.enviarTexto(telefono, '¿A nombre de quién agendo la cita? Escribe el nombre completo del paciente.');
        sesion.paso = 'pedir_nombre';
      }
      break;
    case 'pediatria_datos_nino':
      sesion.datos.nombrePaciente = entrada;
      sesion.datos.esMenor = true;
      await wa.enviarTexto(telefono, 'Gracias. Ahora el nombre y teléfono del acudiente responsable.');
      sesion.paso = 'pediatria_datos_acudiente';
      break;
    case 'pediatria_datos_acudiente':
      sesion.datos.datosAcudiente = entrada;
      await mostrarHorarios(telefono, sesion);
      break;

    // ---------------- Nombre del paciente (adultos) ----------------
    case 'pedir_nombre':
      sesion.datos.nombrePaciente = entrada;
      await mostrarHorarios(telefono, sesion);
      break;

    // ---------------- Selección de horario ----------------
    case 'horario': {
      const idx = parseInt(entrada.replace('slot_', ''), 10);
      const slot = sesion.datos.slotsOfrecidos?.[idx];
      if (slot === undefined) { await wa.enviarTexto(telefono, 'Selecciona uno de los horarios de la lista.'); break; }
      sesion.datos.slotElegido = slot;
      await wa.enviarBotones(telefono,
        `Confirmo tu cita:\n📅 ${fmt(slot.inicio)}\n👨‍⚕️ ${sesion.datos.doctorNombre}\n🏥 ${sesion.datos.especialidadNombre}`,
        [{ id: 'conf_si', title: 'Confirmar' }, { id: 'conf_cambiar', title: 'Cambiar horario' }]
      );
      sesion.paso = 'confirmar';
      break;
    }
    case 'confirmar':
      if (entrada === 'conf_si') {
        const paciente = await db.upsertPaciente({
          telefono,
          nombre: sesion.datos.nombrePaciente,
          es_menor: !!sesion.datos.esMenor,
          nombre_acudiente: sesion.datos.datosAcudiente || null
        });
        const slot = sesion.datos.slotElegido;
        await db.crearCita({
          paciente_id: paciente.id,
          doctor_id: sesion.datos.doctorId,
          especialidad_codigo: sesion.datos.especialidad,
          recurso_id: slot.recurso_id,
          fecha_hora_inicio: slot.inicio,
          fecha_hora_fin: slot.fin,
          notas: sesion.datos.procedimiento || sesion.datos.areaValoracion || null
        });
        await wa.enviarTexto(telefono, '✅ ¡Cita confirmada! Te enviaremos un recordatorio antes de tu cita.');

        if (sesion.datos.especialidad === 'neurologia') {
          await wa.enviarBotones(telefono, '¿Deseas agendar también un electroencefalograma de seguimiento?',
            [{ id: 'eeg_seguimiento_si', title: 'Sí, agendar EEG' }, { id: 'eeg_seguimiento_no', title: 'No, gracias' }]);
          sesion.paso = 'neuro_seguimiento';
        } else {
          sessions.reset(telefono);
        }
      } else {
        await mostrarHorarios(telefono, sesion);
      }
      break;

    case 'neuro_seguimiento':
      if (entrada === 'eeg_seguimiento_si') {
        sesion.datos = { nombrePaciente: sesion.datos.nombrePaciente, especialidad: 'eeg' };
        await wa.enviarBotones(telefono,
          'Antes de continuar, ten en cuenta:\n• Dormir pocas horas la noche anterior\n• Evitar cafeína 12h antes\n• Cabello limpio, sin productos\n¿Continuamos?',
          [{ id: 'eeg_si', title: 'Sí, continuar' }, { id: 'eeg_no', title: 'No, más tarde' }]);
        sesion.paso = 'eeg_confirmar_instrucciones';
      } else {
        await wa.enviarTexto(telefono, 'Perfecto, nos vemos en tu cita 🙌');
        sessions.reset(telefono);
      }
      break;

    default:
      sessions.reset(telefono);
      await procesarMensaje(telefono, texto, idInteractivo);
      return;
  }

  sessions.set(telefono, sesion);
}

async function mostrarHorarios(telefono, sesion) {
  const doctor = await db.getDoctorPrincipalDeEspecialidad(sesion.datos.especialidad);
  if (!doctor) {
    await wa.enviarTexto(telefono, 'Por ahora no hay doctores configurados para esa especialidad. Un asesor te contactará.');
    sessions.reset(telefono);
    return;
  }
  const especialidad = await db.getEspecialidadPorCodigo(sesion.datos.especialidad);
  const slots = await slotsDisponibles({ doctorId: doctor.id, especialidadKey: sesion.datos.especialidad });

  sesion.datos.doctorId = doctor.id;
  sesion.datos.doctorNombre = doctor.nombre;
  sesion.datos.especialidadNombre = especialidad.nombre;
  sesion.datos.slotsOfrecidos = slots;

  if (slots.length === 0) {
    await wa.enviarTexto(telefono, 'No encontré horarios disponibles próximamente. Un asesor te contactará para coordinar.');
    sessions.reset(telefono);
    return;
  }
  await wa.enviarLista(telefono, `Estos son los horarios disponibles con ${doctor.nombre}:`, 'Ver horarios',
    slots.map((s, i) => ({ id: `slot_${i}`, title: fmt(s.inicio) }))
  );
  sesion.paso = 'horario';
}

module.exports = { procesarMensaje };
