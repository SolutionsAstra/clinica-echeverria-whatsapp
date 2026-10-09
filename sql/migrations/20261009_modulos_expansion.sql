-- 20261009_modulos_expansion.sql  (Postgres / Supabase)
-- Módulos premium de expansión del catálogo Astra Digital Solutions (prueba gratuita de 7 días c/u):
--   analitica_financiera   · Dashboard de Looker Studio (ganancias, ingresos por especialista, asistencia vs. cancelaciones)
--   lista_espera_vip       · Lista de espera con aviso automático por WhatsApp al liberarse un cupo
--   reactivacion_dormidos  · Campañas de reactivación a pacientes inactivos 3 o 6 meses
--
-- Idempotente: se puede ejecutar N veces. Ejecutar DESPUÉS de 20261004 y 20261005.
-- Si DB_SCHEMA no es 'public', antepón: SET search_path TO <tu_schema>;
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/20261009_modulos_expansion.sql
--
-- Activación comercial por Soluciones Astra (ejemplo):
--   UPDATE plan_clinica SET modulos = array_append(modulos, 'analitica_financiera'), actualizado_en = now()
--    WHERE id = 1 AND NOT ('analitica_financiera' = ANY (modulos));
-- Desactivación:
--   UPDATE plan_clinica SET modulos = array_remove(modulos, 'analitica_financiera'), actualizado_en = now() WHERE id = 1;
--
-- La lista de módulos DEBE coincidir con MODULOS de src/modules/plan/domain/plan.ts.

BEGIN;

-- Quita CUALQUIER CHECK que restrinja solo la columna de módulos, tenga el nombre que tenga
-- (automático de 20261004 o explícito de 20261005). No toca los CHECK de id, max_operadores
-- ni el de expira_en > iniciada_en, porque esos referencian otras columnas.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conrelid::regclass AS tabla, con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'c'
      AND con.conrelid IN (to_regclass('plan_clinica'), to_regclass('plan_pruebas'))
      AND array_length(con.conkey, 1) = 1
      AND (   (con.conrelid = to_regclass('plan_clinica') AND att.attname = 'modulos')
           OR (con.conrelid = to_regclass('plan_pruebas') AND att.attname = 'modulo'))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tabla, c.conname);
  END LOOP;
END
$$;

ALTER TABLE plan_clinica ADD CONSTRAINT plan_clinica_modulos_check
  CHECK (modulos <@ ARRAY[
    'reportes',
    'multi_calendario',
    'notificaciones_avanzadas',
    'agendamiento_ia',
    'analitica_financiera',
    'lista_espera_vip',
    'reactivacion_dormidos'
  ]::TEXT[]);

ALTER TABLE plan_pruebas ADD CONSTRAINT plan_pruebas_modulo_check
  CHECK (modulo IN (
    'reportes',
    'multi_calendario',
    'notificaciones_avanzadas',
    'agendamiento_ia',
    'analitica_financiera',
    'lista_espera_vip',
    'reactivacion_dormidos'
  ));

COMMIT;

-- Verificación (ambos CHECK deben listar los 7 módulos):
-- SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname IN ('plan_clinica_modulos_check', 'plan_pruebas_modulo_check');