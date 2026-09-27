-- 001_modulo_vet.sql — Módulo VET (ventanas de 3 días)
-- Idempotente: se puede ejecutar más de una vez sin efectos secundarios.
-- Ejecutar DESPUÉS de schema.sql y seed.sql sobre la base existente.

-- sqlcmd arranca con QUOTED_IDENTIFIER OFF; los índices filtrados lo exigen en ON.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- 1) Duraciones estrictas. El módulo VET usa su propia tabla (domain/specialty.ts)
--    como fuente de verdad; esto alinea la BD para el panel, reportes y código legado.
UPDATE especialidades SET duracion_min = 30,  requiere_recurso = 0 WHERE codigo = 'pediatria';
UPDATE especialidades SET duracion_min = 45,  requiere_recurso = 0 WHERE codigo = 'estetica';
UPDATE especialidades SET duracion_min = 60                        WHERE codigo = 'neurologia';
UPDATE especialidades SET duracion_min = 120, requiere_recurso = 1 WHERE codigo = 'eeg';
-- Nota: neurologia.requiere_recurso se deja en 0 a propósito: src/availability.js (legado)
-- busca siempre 'equipo_eeg' cuando ese flag es 1. Cuando se retire availability.js
-- puede ponerse en 1 sin impacto para el módulo VET.

-- 2) Recurso físico de Neurología (el EEG ya existe como 'equipo_eeg').
IF NOT EXISTS (SELECT 1 FROM recursos WHERE tipo = 'consultorio_neurologia')
  INSERT INTO recursos (nombre, tipo) VALUES (N'Consultorio de Neurología', 'consultorio_neurologia');

IF NOT EXISTS (SELECT 1 FROM recursos WHERE tipo = 'equipo_eeg')
  INSERT INTO recursos (nombre, tipo) VALUES (N'Sala EEG', 'equipo_eeg');

-- 3) Las citas de Neurología ya creadas pasan a bloquear el consultorio.
UPDATE c SET c.recurso_id = r.id
FROM citas c
JOIN especialidades e ON e.id = c.especialidad_id AND e.codigo = 'neurologia'
CROSS JOIN (SELECT TOP 1 id FROM recursos WHERE tipo = 'consultorio_neurologia' ORDER BY id) r
WHERE c.recurso_id IS NULL AND c.estado = 'confirmada' AND c.fecha_hora_inicio > SYSUTCDATETIME();

COMMIT TRANSACTION;
GO

-- 4) Integridad: una cita nunca puede terminar antes de empezar.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_citas_rango')
  ALTER TABLE citas ADD CONSTRAINT ck_citas_rango CHECK (fecha_hora_fin > fecha_hora_inicio);
GO

-- 5) Índices de cobertura para la consulta de solapamiento del módulo VET.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_citas_doctor_rango_activas')
  CREATE INDEX ix_citas_doctor_rango_activas
    ON citas (doctor_id, fecha_hora_inicio) INCLUDE (fecha_hora_fin, recurso_id)
    WHERE estado IN ('confirmada', 'completada');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_citas_recurso_rango_activas')
  CREATE INDEX ix_citas_recurso_rango_activas
    ON citas (recurso_id, fecha_hora_inicio) INCLUDE (fecha_hora_fin, doctor_id)
    WHERE estado IN ('confirmada', 'completada') AND recurso_id IS NOT NULL;
GO
