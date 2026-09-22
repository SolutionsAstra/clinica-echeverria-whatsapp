-- seed.sql — datos iniciales, ejecutar después de schema.sql

INSERT INTO doctores (nombre, email) VALUES
  (N'Dr. Rojas', 'rojas@clinicaecheverria.com'),
  (N'Dra. Salas', 'salas@clinicaecheverria.com'),
  (N'Dr. Núñez', 'nunez@clinicaecheverria.com');

INSERT INTO especialidades (codigo, nombre, duracion_min, requiere_recurso) VALUES
  ('eeg', N'Electroencefalografía', 60, 1),
  ('estetica', N'Medicina estética', 30, 0),
  ('pediatria', N'Pediatría', 25, 0),
  ('neurologia', N'Neurología', 40, 0);

INSERT INTO recursos (nombre, tipo) VALUES (N'Sala EEG', 'equipo_eeg');

-- doctor_especialidad: Rojas->neurologia,eeg | Salas->pediatria,estetica | Núñez->estetica,neurologia
INSERT INTO doctor_especialidad (doctor_id, especialidad_id)
SELECT d.id, e.id FROM doctores d, especialidades e
WHERE (d.nombre = N'Dr. Rojas'  AND e.codigo IN ('neurologia','eeg'))
   OR (d.nombre = N'Dra. Salas' AND e.codigo IN ('pediatria','estetica'))
   OR (d.nombre = N'Dr. Núñez'  AND e.codigo IN ('estetica','neurologia'));

-- Horarios: 1=Lunes ... 5=Viernes (0=Domingo, 6=Sábado)
INSERT INTO horarios_disponibilidad (doctor_id, dias, hora_inicio, hora_fin)
SELECT id, '1,2,3,4,5', '08:00', '16:00' FROM doctores WHERE nombre = N'Dr. Rojas';
INSERT INTO horarios_disponibilidad (doctor_id, dias, hora_inicio, hora_fin)
SELECT id, '1,2,3,4', '09:00', '17:00' FROM doctores WHERE nombre = N'Dra. Salas';
INSERT INTO horarios_disponibilidad (doctor_id, dias, hora_inicio, hora_fin)
SELECT id, '1,3,5', '08:00', '14:00' FROM doctores WHERE nombre = N'Dr. Núñez';

INSERT INTO instrucciones_previas (especialidad_id, texto)
SELECT id, N'Dormir pocas horas la noche anterior; evitar cafeína 12h antes; cabello limpio, sin productos.'
FROM especialidades WHERE codigo = 'eeg';

INSERT INTO configuracion_reportes (frecuencia, hora_envio, activo) VALUES ('diario', '18:00', 1);

-- Usuarios del panel administrativo. Contraseñas de ejemplo (CÁMBIALAS antes de producción):
--   recepcion@clinicaecheverria.com  / recepcion123
--   direccion@clinicaecheverria.com  / direccion123
--   rojas@clinicaecheverria.com      / doctor123   (rol doctor, ligado al Dr. Rojas)
-- Los hashes ya están generados con bcrypt, no son las contraseñas en texto plano.
INSERT INTO usuarios (nombre, email, password_hash, rol, doctor_id) VALUES
  (N'Recepción', 'recepcion@clinicaecheverria.com', '$2a$10$oE3GkPi4eRGsllOesG.mOOTkZw1woavxTkCMCAsJ3HeO6.KDXsP7.', 'recepcion', NULL),
  (N'Dirección', 'direccion@clinicaecheverria.com', '$2a$10$nSHD3Ec42lFJbtP5caDlPuwNVh0URnKPgkbpm4hxLUgSj9cSrpgZO', 'direccion', NULL);

INSERT INTO usuarios (nombre, email, password_hash, rol, doctor_id)
SELECT N'Dr. Rojas', 'rojas@clinicaecheverria.com', '$2a$10$sMLJPkEp5rFX1bOhfVvnrOtvvvSLI1v4QoSCa8cU0d/G9LttqphYi', 'doctor', id
FROM doctores WHERE nombre = N'Dr. Rojas';
