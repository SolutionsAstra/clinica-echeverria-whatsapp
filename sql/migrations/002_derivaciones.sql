-- 002_derivaciones.sql — Bandeja de Derivaciones de la IA (PostgreSQL / Supabase)
-- Idempotente. Ejecutar en el SQL Editor de Supabase DESPUÉS de 001_modulo_vet.
-- Si DB_SCHEMA no es 'public', antepone: SET search_path TO <tu_schema>;

BEGIN;

CREATE TABLE IF NOT EXISTS derivaciones (
  id                  SERIAL PRIMARY KEY,
  telefono            VARCHAR(30)  NOT NULL,              -- WhatsApp de quien escribió (acudiente si es menor)
  paciente_nombre     VARCHAR(150) NOT NULL,
  nombre_acudiente    VARCHAR(150),
  especialidad        VARCHAR(20)  NOT NULL,
  doctor_id           INT          NOT NULL REFERENCES doctores(id),
  bloque              VARCHAR(10)  NOT NULL,
  fecha_preferida     DATE         NOT NULL,
  notas               VARCHAR(400),

  -- Máquina de estados: pendiente → en_proceso → reservada (o vuelve a pendiente)
  estado              VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
  capturada_en        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  reclamada_en        TIMESTAMPTZ,
  reclamada_por       INT          REFERENCES usuarios(id),
  cita_id             INT          REFERENCES citas(id),
  reservada_en        TIMESTAMPTZ,
  reservada_por       INT          REFERENCES usuarios(id),
  notificado_en       TIMESTAMPTZ,
  notificacion_error  TEXT,

  CONSTRAINT ck_derivaciones_especialidad CHECK (especialidad IN ('neurologia', 'eeg', 'pediatria', 'estetica')),
  CONSTRAINT ck_derivaciones_bloque       CHECK (bloque IN ('manana', 'tarde')),
  CONSTRAINT ck_derivaciones_estado       CHECK (estado IN ('pendiente', 'en_proceso', 'reservada', 'descartada')),
  CONSTRAINT ck_derivaciones_reclamo      CHECK (estado <> 'en_proceso' OR reclamada_en IS NOT NULL),
  CONSTRAINT ck_derivaciones_reservada    CHECK (estado <> 'reservada'  OR cita_id IS NOT NULL)
);

-- La bandeja solo lee pendientes/en_proceso ordenadas por antigüedad: índice parcial pequeño.
CREATE INDEX IF NOT EXISTS ix_derivaciones_bandeja
  ON derivaciones (capturada_en, id)
  WHERE estado IN ('pendiente', 'en_proceso');

-- Una cita no puede cerrar dos derivaciones.
CREATE UNIQUE INDEX IF NOT EXISTS ux_derivaciones_cita
  ON derivaciones (cita_id)
  WHERE cita_id IS NOT NULL;

-- Datos de pacientes: sin políticas, la API pública de Supabase (anon/authenticated)
-- no puede leerla. El backend conecta como 'postgres' (dueño) y no se ve afectado.
ALTER TABLE derivaciones ENABLE ROW LEVEL SECURITY;

COMMIT;
