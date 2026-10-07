-- 20261007_derivaciones_columnas.sql  (Postgres / Supabase)
-- Alinea la tabla derivaciones con 002_derivaciones.sql si quedó con nombres alternativos
-- (nombre_paciente, created_at). Idempotente: no hace nada si los nombres ya son los canónicos.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'derivaciones' AND column_name = 'nombre_paciente')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'derivaciones' AND column_name = 'paciente_nombre') THEN
    ALTER TABLE derivaciones RENAME COLUMN nombre_paciente TO paciente_nombre;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'derivaciones' AND column_name = 'created_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'derivaciones' AND column_name = 'capturada_en') THEN
    ALTER TABLE derivaciones RENAME COLUMN created_at TO capturada_en;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_derivaciones_capturada ON derivaciones (capturada_en);

COMMIT;

-- Verificación: deben aparecer paciente_nombre y capturada_en.
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = current_schema() AND table_name = 'derivaciones' ORDER BY ordinal_position;