// Error de dominio con un código propio (codigo), distinto del code de PostgreSQL.
// El servicio y el repositorio no conocen HTTP: server.mjs traduce el codigo a un estado.
export function fallo(codigo) {
  return Object.assign(new Error(codigo), { codigo });
}
