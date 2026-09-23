import sql, { type ConnectionPool } from "mssql";
import type { BusyAgenda } from "../../application/ports";
import type { Interval } from "../../domain/slots";
import type { Specialty } from "../../domain/specialty";

/**
 * Adaptador MSSQL de BusyAgenda.
 * PENDIENTE: ajustar nombres de schema/tabla/columnas a los esquemas reales del repo.
 * Supone columnas DATETIMEOFFSET para no depender del huso del servidor SQL.
 */
const QUERY = `
  SELECT c.FechaHoraInicio AS inicio, c.FechaHoraFin AS fin
  FROM   agenda.Citas c
  WHERE  c.EspecialidadCodigo = @especialidad
    AND  c.Estado <> 'CANCELADA'
    AND  c.FechaHoraInicio < @hasta
    AND  c.FechaHoraFin    > @desde
`;

export function mssqlBusyAgenda(pool: ConnectionPool): BusyAgenda {
  return {
    async busyBetween(specialty: Specialty, from: Date, to: Date): Promise<Interval[]> {
      const result = await pool
        .request()
        .input("especialidad", sql.VarChar(32), specialty)
        .input("desde", sql.DateTimeOffset, from)
        .input("hasta", sql.DateTimeOffset, to)
        .query<{ inicio: Date; fin: Date }>(QUERY);
      return result.recordset.map((r) => ({ start: r.inicio, end: r.fin }));
    },
  };
}
