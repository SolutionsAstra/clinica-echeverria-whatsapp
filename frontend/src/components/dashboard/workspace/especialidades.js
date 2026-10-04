/**
 * Especialidades de la clínica: nombre, color de agrupación y duración de la cita.
 * Las claves y duraciones replican src/modules/vet/domain/specialty del backend.
 * Fuente única para la bandeja de derivaciones, la tabla de citas y el calendario.
 *
 * Colores elegidos para contraste ≥ 4.5:1 sobre #0E1F36 y para distinguirse entre sí
 * también con daltonismo deuteranope (azul / ámbar / rosa / turquesa).
 */
export const ESPECIALIDADES = {
  pediatria: { nombre: "Pediatría", color: "#E8B96A", duracionMin: 30 },
  neurologia: { nombre: "Neurología", color: "#8B9CF7", duracionMin: 60 },
  estetica: { nombre: "Estética", color: "#E59AB4", duracionMin: 45 },
  eeg: { nombre: "EEG", color: "#5EC4C0", duracionMin: 120 },
};

export const ORDEN_ESPECIALIDADES = ["pediatria", "neurologia", "estetica", "eeg"];

const DESCONOCIDA = { nombre: "Otra", color: "#7D8BA0", duracionMin: 30 };

export const especialidad = (codigo) => ESPECIALIDADES[codigo] ?? { ...DESCONOCIDA, nombre: codigo ?? DESCONOCIDA.nombre };
