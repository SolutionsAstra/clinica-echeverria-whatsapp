/**
 * Convierte un template literal en una consulta parametrizada de node-postgres.
 *
 *   buildQuery`SELECT * FROM citas WHERE id = ${id}`
 *   → { text: "SELECT * FROM citas WHERE id = $1", values: [id] }
 *
 * Los valores NUNCA se concatenan al texto: siempre viajan como parámetros,
 * así que no hay riesgo de inyección SQL.
 */
export interface BuiltQuery {
  text: string;
  values: unknown[];
}

export function buildQuery(strings: readonly string[], values: readonly unknown[]): BuiltQuery {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}${strings[i + 1]}`;
  }
  return { text, values: [...values] };
}
