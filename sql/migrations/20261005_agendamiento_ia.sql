-- 20261005_agendamiento_ia.sql  (Postgres / Supabase)
-- Módulo premium "agendamiento_ia": la IA confirma citas sola. Prueba gratuita de 7 días.
-- Idempotente. Ejecutar DESPUÉS de 20261004_plan_licencias.sql.
--
-- Activación comercial por Soluciones Astra:
--   UPDATE plan_clinica SET modulos = array_append(modulos, 'agendamiento_ia'), actualizado_en = now() WHERE id = 1;
-- Desactivación:
--   UPDATE plan_clinica SET modulos = array_remove(modulos, 'agendamiento_ia'), actualizado_en = now() WHERE id = 1;

BEGIN;

-- Los CHECK en línea de la migración anterior reciben nombres automáticos <tabla>_<columna>_check.
ALTER TABLE plan_clinica DROP CONSTRAINT IF EXISTS plan_clinica_modulos_check;
ALTER TABLE plan_clinica ADD CONSTRAINT plan_clinica_modulos_check
  CHECK (modulos <@ ARRAY['reportes','multi_calendario','notificaciones_avanzadas','agendamiento_ia']::TEXT[]);

ALTER TABLE plan_pruebas DROP CONSTRAINT IF EXISTS plan_pruebas_modulo_check;
ALTER TABLE plan_pruebas ADD CONSTRAINT plan_pruebas_modulo_check
  CHECK (modulo IN ('reportes','multi_calendario','notificaciones_avanzadas','agendamiento_ia'));

COMMIT;

-- Verificación (debe listar ambos CHECK con agendamiento_ia):
-- SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
-- FROM pg_constraint WHERE conname IN ('plan_clinica_modulos_check', 'plan_pruebas_modulo_check');