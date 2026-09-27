import sql, { type ConnectionPool, type Transaction } from "mssql";
import type { BusyBlock, NewAppointment, Provider, SchedulingRepository } from "../../application/ports";
import { parseHHMM, type WeeklyShift } from "../../domain/schedule";
import { VetError } from "../../domain/errors";

/**
 * Adaptador MSSQL sobre el esquema real del proyecto (sql/schema.sql).
 *
 * CONVENCIÓN DE FECHAS: `citas.fecha_hora_inicio/fin` son DATETIME2 en UTC,
 * igual que el resto del proyecto (SYSUTCDATETIME en db.js). El driver `mssql`
 * con `options.useUTC = true` (valor por defecto) escribe y lee los Date de JS
 * como UTC, así que el módulo nunca depende del huso del servidor Node ni del SQL.
 *
 * Estados que ocupan agenda: 'confirmada' y 'completada'.
 */
const ACTIVE_STATES = "('confirmada','completada')";
const LOCK_TIMEOUT_MS = 5000;

export interface MssqlRepositoryOptions {
  /** Schema SQL donde viven las tablas. Por defecto 'dbo'. */
  schema?: string;
}

export function createMssqlSchedulingRepository(
  getPool: () => Promise<ConnectionPool>,
  options: MssqlRepositoryOptions = {},
): SchedulingRepository {
  const s = quoteSchema(options.schema ?? "dbo");
  const t = (table: string) => `${s}.[${table}]`;

  return {
    async providersFor(specialty) {
      const pool = await getPool();
      const { recordset } = await pool
        .request()
        .input("codigo", sql.NVarChar(30), specialty)
        .query<{ doctor_id: number; doctor_nombre: string; dias: string | null; hora_inicio: string | null; hora_fin: string | null }>(`
          SELECT d.id AS doctor_id, d.nombre AS doctor_nombre, h.dias, h.hora_inicio, h.hora_fin
          FROM ${t("doctores")} d
          JOIN ${t("doctor_especialidad")} de ON de.doctor_id = d.id
          JOIN ${t("especialidades")} e      ON e.id = de.especialidad_id
          LEFT JOIN ${t("horarios_disponibilidad")} h ON h.doctor_id = d.id
          WHERE e.codigo = @codigo AND d.activo = 1
          ORDER BY d.id, h.id`);

      const byDoctor = new Map<number, Provider>();
      for (const row of recordset) {
        const provider = byDoctor.get(row.doctor_id) ?? { doctorId: row.doctor_id, doctorName: row.doctor_nombre, shifts: [] };
        if (row.dias && row.hora_inicio && row.hora_fin) provider.shifts.push(toShift(row.dias, row.hora_inicio, row.hora_fin));
        byDoctor.set(row.doctor_id, provider);
      }
      return [...byDoctor.values()];
    },

    async resourceIdFor(resourceType) {
      const pool = await getPool();
      const { recordset } = await pool
        .request()
        .input("tipo", sql.NVarChar(50), resourceType)
        .query<{ id: number }>(`SELECT TOP 1 id FROM ${t("recursos")} WHERE tipo = @tipo ORDER BY id`);
      return recordset[0]?.id ?? null;
    },

    async busyBetween({ doctorIds, resourceId, from, to }) {
      const pool = await getPool();
      const { recordset } = await pool
        .request()
        .input("doctores", sql.NVarChar(sql.MAX), JSON.stringify(doctorIds))
        .input("recurso", sql.Int, resourceId)
        .input("desde", sql.DateTime2, from)
        .input("hasta", sql.DateTime2, to)
        .query<{ doctor_id: number; recurso_id: number | null; inicio: Date; fin: Date }>(`
          SELECT c.doctor_id, c.recurso_id, c.fecha_hora_inicio AS inicio, c.fecha_hora_fin AS fin
          FROM ${t("citas")} c
          WHERE c.estado IN ${ACTIVE_STATES}
            AND c.fecha_hora_inicio < @hasta
            AND c.fecha_hora_fin    > @desde
            AND (
              c.doctor_id IN (SELECT CAST([value] AS INT) FROM OPENJSON(@doctores))
              OR (@recurso IS NOT NULL AND c.recurso_id = @recurso)
            )`);
      return recordset.map<BusyBlock>((r) => ({ doctorId: r.doctor_id, resourceId: r.recurso_id, start: r.inicio, end: r.fin }));
    },

    async insertIfFree(a: NewAppointment) {
      const pool = await getPool();
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
      try {
        // Candados de aplicación en orden fijo (doctor → recurso): serializan las
        // reservas que compiten por el mismo doctor o la misma sala sin bloquear la tabla,
        // y el orden fijo evita deadlocks entre reservas cruzadas.
        await appLock(tx, `vet:doctor:${a.doctorId}`);
        if (a.resourceId !== null) await appLock(tx, `vet:recurso:${a.resourceId}`);

        const conflict = await new sql.Request(tx)
          .input("doctor", sql.Int, a.doctorId)
          .input("recurso", sql.Int, a.resourceId)
          .input("inicio", sql.DateTime2, a.start)
          .input("fin", sql.DateTime2, a.end)
          .query<{ id: number }>(`
            SELECT TOP 1 c.id
            FROM ${t("citas")} c
            WHERE c.estado IN ${ACTIVE_STATES}
              AND c.fecha_hora_inicio < @fin
              AND c.fecha_hora_fin    > @inicio
              AND (c.doctor_id = @doctor OR (@recurso IS NOT NULL AND c.recurso_id = @recurso))`);
        if (conflict.recordset.length) {
          throw new VetError("SLOT_TAKEN", "Otro paciente acaba de reservar ese bloque");
        }

        const patientId = await upsertPatient(tx, a);

        const inserted = await new sql.Request(tx)
          .input("paciente", sql.Int, patientId)
          .input("doctor", sql.Int, a.doctorId)
          .input("codigo", sql.NVarChar(30), a.specialty)
          .input("recurso", sql.Int, a.resourceId)
          .input("inicio", sql.DateTime2, a.start)
          .input("fin", sql.DateTime2, a.end)
          .input("notas", sql.NVarChar(400), a.notes)
          .query<{ id: number }>(`
            INSERT INTO ${t("citas")}
              (paciente_id, doctor_id, especialidad_id, recurso_id, fecha_hora_inicio, fecha_hora_fin, notas, estado)
            OUTPUT INSERTED.id
            SELECT @paciente, @doctor, e.id, @recurso, @inicio, @fin, @notas, 'confirmada'
            FROM ${t("especialidades")} e
            WHERE e.codigo = @codigo`);
        if (!inserted.recordset.length) {
          throw new Error(`La especialidad '${a.specialty}' no existe en la tabla especialidades`);
        }

        await tx.commit();
        return { appointmentId: inserted.recordset[0].id, patientId };
      } catch (err) {
        await tx.rollback().catch(() => undefined); // puede estar ya abortada por SQL Server
        throw err;
      }
    },
  };

  async function upsertPatient(tx: Transaction, a: NewAppointment): Promise<number> {
    const p = a.patient;
    const { recordset } = await new sql.Request(tx)
      .input("telefono", sql.NVarChar(30), p.telefono)
      .input("nombre", sql.NVarChar(150), p.nombre)
      .input("es_menor", sql.Bit, p.esMenor ? 1 : 0)
      .input("nombre_acudiente", sql.NVarChar(150), p.nombreAcudiente ?? null)
      .input("telefono_acudiente", sql.NVarChar(30), p.telefonoAcudiente ?? null)
      .query<{ id: number }>(`
        UPDATE ${t("pacientes")} WITH (UPDLOCK, SERIALIZABLE)
        SET nombre = @nombre, es_menor = @es_menor,
            nombre_acudiente = @nombre_acudiente, telefono_acudiente = @telefono_acudiente
        WHERE telefono = @telefono;

        IF @@ROWCOUNT = 0
          INSERT INTO ${t("pacientes")} (telefono, nombre, es_menor, nombre_acudiente, telefono_acudiente)
          VALUES (@telefono, @nombre, @es_menor, @nombre_acudiente, @telefono_acudiente);

        SELECT id FROM ${t("pacientes")} WHERE telefono = @telefono;`);
    return recordset[0].id;
  }
}

async function appLock(tx: Transaction, resource: string): Promise<void> {
  const { recordset } = await new sql.Request(tx)
    .input("res", sql.NVarChar(255), resource)
    .input("timeout", sql.Int, LOCK_TIMEOUT_MS)
    .query<{ result: number }>(`
      DECLARE @r INT;
      EXEC @r = sp_getapplock @Resource = @res, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = @timeout;
      SELECT @r AS result;`);
  if (recordset[0].result < 0) {
    throw new VetError("BUSY_RETRY", "La agenda está siendo modificada, intenta de nuevo en unos segundos");
  }
}

function toShift(dias: string, horaInicio: string, horaFin: string): WeeklyShift {
  return {
    weekdays: dias
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    openMinute: parseHHMM(horaInicio),
    closeMinute: parseHHMM(horaFin),
  };
}

function quoteSchema(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(schema)) throw new Error(`Nombre de schema inválido: ${schema}`);
  return `[${schema}]`;
}
