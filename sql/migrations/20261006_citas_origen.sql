-- 20261006_citas_origen.sql  (Postgres / Supabase)
-- Origen de cada cita ('ia' | 'panel') para medir el impacto del módulo agendamiento_ia.
-- Idempotente. Ejecutar ANTES de desplegar el código que escribe citas.origen.

BEGIN;

-- Por si la tabla migrada desde SQL Server no conservó creado_en.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT now();

-- Se agrega SIN default: las citas históricas quedan NULL ("sin registro") y no alteran la métrica.
-- Las nuevas toman 'panel' salvo que el servidor indique 'ia'.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS origen VARCHAR(10);
ALTER TABLE citas ALTER COLUMN origen SET DEFAULT 'panel';

ALTER TABLE citas DROP CONSTRAINT IF EXISTS ck_citas_origen;
ALTER TABLE citas ADD CONSTRAINT ck_citas_origen CHECK (origen IS NULL OR origen IN ('ia', 'panel'));

-- Consultas de la tarjeta de impacto (rango por fecha de creación / captura).
CREATE INDEX IF NOT EXISTS ix_citas_ia_creado ON citas (creado_en) WHERE origen = 'ia';
CREATE INDEX IF NOT EXISTS ix_derivaciones_capturada ON derivaciones (capturada_en);

COMMIT;