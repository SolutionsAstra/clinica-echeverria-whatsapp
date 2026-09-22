-- schema.sql — Clínica Echeverría
-- Ejecutar una vez contra una base de datos vacía (ej. CREATE DATABASE ClinicaEcheverria; luego USE ClinicaEcheverria;)

CREATE TABLE doctores (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  nombre        NVARCHAR(120)  NOT NULL,
  email         NVARCHAR(150)  NOT NULL,
  telefono      NVARCHAR(30)   NULL,
  activo        BIT            NOT NULL DEFAULT 1
);

CREATE TABLE especialidades (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  codigo            NVARCHAR(30)  NOT NULL UNIQUE,   -- 'eeg' | 'estetica' | 'pediatria' | 'neurologia'
  nombre            NVARCHAR(120) NOT NULL,
  duracion_min      INT           NOT NULL,
  requiere_recurso  BIT           NOT NULL DEFAULT 0
);

CREATE TABLE doctor_especialidad (
  doctor_id       INT NOT NULL REFERENCES doctores(id),
  especialidad_id INT NOT NULL REFERENCES especialidades(id),
  PRIMARY KEY (doctor_id, especialidad_id)
);

CREATE TABLE recursos (
  id      INT IDENTITY(1,1) PRIMARY KEY,
  nombre  NVARCHAR(100) NOT NULL,
  tipo    NVARCHAR(50)  NOT NULL      -- ej. 'equipo_eeg'
);

CREATE TABLE horarios_disponibilidad (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  doctor_id    INT NOT NULL REFERENCES doctores(id),
  dias         NVARCHAR(20)  NOT NULL,   -- CSV de días 0-6 (0=domingo), ej. '1,2,3,4,5'
  hora_inicio  CHAR(5)       NOT NULL,   -- 'HH:MM'
  hora_fin     CHAR(5)       NOT NULL
);

CREATE TABLE pacientes (
  id                  INT IDENTITY(1,1) PRIMARY KEY,
  telefono            NVARCHAR(30)  NOT NULL UNIQUE,
  nombre              NVARCHAR(150) NOT NULL,
  fecha_nacimiento    DATE          NULL,
  es_menor            BIT           NOT NULL DEFAULT 0,
  nombre_acudiente    NVARCHAR(150) NULL,
  telefono_acudiente  NVARCHAR(30)  NULL
);

CREATE TABLE citas (
  id                        INT IDENTITY(1,1) PRIMARY KEY,
  paciente_id               INT NOT NULL REFERENCES pacientes(id),
  doctor_id                 INT NOT NULL REFERENCES doctores(id),
  especialidad_id           INT NOT NULL REFERENCES especialidades(id),
  recurso_id                INT NULL REFERENCES recursos(id),
  fecha_hora_inicio         DATETIME2 NOT NULL,
  fecha_hora_fin            DATETIME2 NOT NULL,
  estado                    NVARCHAR(20) NOT NULL DEFAULT 'confirmada', -- confirmada|cancelada|completada|no_show
  notas                     NVARCHAR(400) NULL,
  cita_relacionada_id       INT NULL REFERENCES citas(id),
  recordatorio_24h_enviado  BIT NOT NULL DEFAULT 0,
  recordatorio_2h_enviado   BIT NOT NULL DEFAULT 0,
  creado_en                 DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_citas_doctor_fecha ON citas(doctor_id, fecha_hora_inicio);
CREATE INDEX ix_citas_recurso_fecha ON citas(recurso_id, fecha_hora_inicio);
CREATE INDEX ix_citas_estado ON citas(estado);

CREATE TABLE instrucciones_previas (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  especialidad_id  INT NOT NULL REFERENCES especialidades(id),
  texto            NVARCHAR(600) NOT NULL
);

CREATE TABLE reportes_enviados (
  id                 INT IDENTITY(1,1) PRIMARY KEY,
  doctor_id          INT NOT NULL REFERENCES doctores(id),
  fecha_generacion   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  periodo_cubierto   NVARCHAR(50) NULL,
  estado_envio       NVARCHAR(20) NOT NULL  -- enviado|fallido
);

CREATE TABLE configuracion_reportes (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  frecuencia  NVARCHAR(20) NOT NULL DEFAULT 'diario', -- diario|semanal
  hora_envio  CHAR(5) NOT NULL DEFAULT '18:00',
  activo      BIT NOT NULL DEFAULT 1
);

CREATE TABLE conversaciones_escaladas (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  telefono     NVARCHAR(30) NOT NULL,
  motivo       NVARCHAR(300) NOT NULL,
  fecha        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  atendido_por NVARCHAR(120) NULL
);

CREATE TABLE usuarios (
  id             INT IDENTITY(1,1) PRIMARY KEY,
  nombre         NVARCHAR(120) NOT NULL,
  email          NVARCHAR(160) NOT NULL UNIQUE,
  password_hash  NVARCHAR(200) NOT NULL,
  rol            NVARCHAR(20) NOT NULL,        -- 'recepcion' | 'doctor' | 'direccion'
  doctor_id      INT NULL REFERENCES doctores(id), -- solo aplica cuando rol = 'doctor'
  activo         BIT NOT NULL DEFAULT 1
);
