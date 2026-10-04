-- 20261004_plan_licencias.sql  (Postgres / Supabase)
-- Plan comercial de Astra Health: módulos premium, pruebas de 3 días y tope de operadores.
-- Idempotente. Ejecutar con el search_path del esquema de la app (DB_SCHEMA, por defecto public):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/20261004_plan_licencias.sql

BEGIN;

-- Contrato vigente (una sola fila). Soluciones Astra habilita módulos o licencias con un UPDATE:
--   UPDATE plan_clinica SET modulos = array_append(modulos, 'reportes'), actualizado_en = now() WHERE id = 1;
--   UPDATE plan_clinica SET max_operadores = 4, actualizado_en = now() WHERE id = 1;
CREATE TABLE IF NOT EXISTS plan_clinica (
  id              SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_operadores  INT         NOT NULL DEFAULT 2 CHECK (max_operadores >= 1),
  modulos         TEXT[]      NOT NULL DEFAULT '{}'
                  CHECK (modulos <@ ARRAY['reportes','multi_calendario','notificaciones_avanzadas']::TEXT[]),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO plan_clinica (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Una prueba por módulo y por clínica, para siempre (la PK lo garantiza aun con dos clics simultáneos).
CREATE TABLE IF NOT EXISTS plan_pruebas (
  modulo        TEXT        PRIMARY KEY
                CHECK (modulo IN ('reportes','multi_calendario','notificaciones_avanzadas')),
  iniciada_en   TIMESTAMPTZ NOT NULL,
  expira_en     TIMESTAMPTZ NOT NULL,
  iniciada_por  INT         NULL REFERENCES usuarios(id),
  CHECK (expira_en > iniciada_en)
);

-- Tope ESTRICTO de operadores activos. Se evalúa al crear un usuario activo y al reactivar uno.
-- El advisory lock serializa altas concurrentes: sin él, dos INSERT simultáneos verían
-- ambos "1 activo" y dejarían 3. Con READ COMMITTED, el COUNT posterior al lock ve lo ya confirmado.
CREATE OR REPLACE FUNCTION exigir_limite_operadores() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  maximo  INT;
  activos INT;
BEGIN
  IF NOT NEW.activo THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.activo THEN
    RETURN NEW; -- editar nombre o rol de alguien ya activo no consume cupo
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('astra.usuarios.limite_operadores'));

  SELECT max_operadores INTO maximo FROM plan_clinica WHERE id = 1;
  maximo := COALESCE(maximo, 2);

  SELECT COUNT(*) INTO activos FROM usuarios WHERE activo AND id IS DISTINCT FROM NEW.id;

  IF activos >= maximo THEN
    RAISE EXCEPTION 'LIMITE_OPERADORES'
      USING ERRCODE = 'P0001',
            DETAIL  = format('%s operadores activos; el plan permite %s.', activos, maximo),
            HINT    = 'Consulte a Soluciones Astra para adquirir licencias de usuarios adicionales.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuarios_limite_operadores ON usuarios;
CREATE TRIGGER trg_usuarios_limite_operadores
  BEFORE INSERT OR UPDATE OF activo ON usuarios
  FOR EACH ROW EXECUTE FUNCTION exigir_limite_operadores();

-- Recordatorio de 24 h retirado (ver src/jobs/reminders.js). La columna se conserva por
-- historial; solo deja de consultarse.
COMMENT ON COLUMN citas.recordatorio_24h_enviado IS
  'Obsoleta desde 2026-10-04: el recordatorio automático de 24 h se retiró del producto.';

COMMIT;

-- Nota: los datos existentes NO se tocan. Si hoy hay más de 2 usuarios activos (el seed trae
-- recepción, doctor y dirección), el panel lo muestra como excedido y bloquea nuevas altas y
-- reactivaciones hasta que Dirección desactive cuentas o se amplíe el plan.
