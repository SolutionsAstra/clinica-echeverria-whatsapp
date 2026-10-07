-- 20261008_cancelacion_reagendamiento_ia.sql  (Postgres / Supabase)
-- 1) Repara lo que dispara el 500 del panel: recursos de Neurología/EEG (001_modulo_vet.sql es T-SQL
--    y nunca corrió en Supabase) y la columna citas.origen.
-- 2) Política de cancelación (48 h) y reagendamiento autónomo con límite 1 por paciente.
-- Idempotente. Si DB_SCHEMA no es 'public', antepón: SET search_path TO <tu_schema>;

BEGIN;

-- ── 1. Reparación del alta manual ────────────────────────────────────────────────────
ALTER TABLE citas ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE citas ADD COLUMN IF NOT EXISTS origen VARCHAR(10);
ALTER TABLE citas ALTER COLUMN origen SET DEFAULT 'panel';
ALTER TABLE citas DROP CONSTRAINT IF EXISTS ck_citas_origen;
ALTER TABLE citas ADD CONSTRAINT ck_citas_origen CHECK (origen IS NULL OR origen IN ('ia', 'panel'));

INSERT INTO recursos (nombre, tipo)
SELECT 'Consultorio de Neurología', 'consultorio_neurologia'
WHERE NOT EXISTS (SELECT 1 FROM recursos WHERE tipo = 'consultorio_neurologia');

INSERT INTO recursos (nombre, tipo)
SELECT 'Sala EEG', 'equipo_eeg'
WHERE NOT EXISTS (SELECT 1 FROM recursos WHERE tipo = 'equipo_eeg');

-- ── 2. Cancelación y reagendamiento por la IA ────────────────────────────────────────
ALTER TABLE citas ADD COLUMN IF NOT EXISTS cancelada_en TIMESTAMPTZ;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS cancelada_por VARCHAR(10);
ALTER TABLE citas DROP CONSTRAINT IF EXISTS ck_citas_cancelada_por;
ALTER TABLE citas ADD CONSTRAINT ck_citas_cancelada_por CHECK (cancelada_por IS NULL OR cancelada_por IN ('ia', 'panel'));

-- Cita nueva → cita que reemplaza. Columna propia: cita_relacionada_id ya se usa para el EEG de seguimiento.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS reagendada_desde_id INT REFERENCES citas(id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_citas_reagendada_desde ON citas (reagendada_desde_id) WHERE reagendada_desde_id IS NOT NULL;

-- Contador por paciente de reagendamientos autónomos con la IA (límite: 1).
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS reagendamientos_ia SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE pacientes DROP CONSTRAINT IF EXISTS ck_pacientes_reagendamientos_ia;
ALTER TABLE pacientes ADD CONSTRAINT ck_pacientes_reagendamientos_ia CHECK (reagendamientos_ia >= 0);

COMMIT;

-- Verificación:
-- SELECT tipo FROM recursos ORDER BY id;
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name IN ('citas','pacientes')
--    AND column_name IN ('origen','cancelada_en','cancelada_por','reagendada_desde_id','reagendamientos_ia');