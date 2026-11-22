// Repositorio de equipos: todo el SQL de consultas y del inventario.
// Recibe el pool; no conoce Express, req, res ni códigos HTTP.
import { fallo } from './errores.mjs';

export const TAMANO_PAGINA = 5;

// Ordenaciones permitidas -> fragmento SQL FIJO escrito por el programador.
// Nunca se concatena un nombre de columna recibido en la petición.
// El id final desempata para que el orden sea estable al paginar.
const ORDENES = {
  codigo: 'codigo, id',
  nombre: 'nombre, id'
};

export function crearRepositorioEquipos(pool) {
  return {
    // Listado con búsqueda, filtros, orden y paginación.
    // filtros: { q, categoria, disponible ('' | 'si' | 'no'), orden, pagina }
    async listar(filtros) {
      const condiciones = [];
      const valores = [];

      // Cada filtro añade una condición fija con su marcador $n.
      // El valor del cliente va SIEMPRE en el array de parámetros.
      if (filtros.q !== '') {
        valores.push(`%${filtros.q}%`);
        condiciones.push(`nombre ILIKE $${valores.length}`);
      }
      if (filtros.categoria !== '') {
        valores.push(filtros.categoria);
        condiciones.push(`categoria = $${valores.length}`);
      }
      if (filtros.disponible !== '') {
        valores.push(filtros.disponible === 'si');
        condiciones.push(`disponible = $${valores.length}`);
      }
      const where = condiciones.length > 0 ? 'WHERE ' + condiciones.join(' AND ') : '';

      // Se pide una fila más del tamaño de página para saber si hay página siguiente
      valores.push(TAMANO_PAGINA + 1);
      const posLimit = valores.length;
      valores.push((filtros.pagina - 1) * TAMANO_PAGINA);
      const posOffset = valores.length;

      const r = await pool.query(
        `SELECT id, codigo, nombre, categoria, disponible
         FROM practica_prestamos.equipos
         ${where}
         ORDER BY ${ORDENES[filtros.orden]}
         LIMIT $${posLimit} OFFSET $${posOffset}`,
        valores
      );
      return r.rows;
    },

    // Categorías existentes, para el desplegable del filtro
    async categorias() {
      const r = await pool.query(
        `SELECT DISTINCT categoria FROM practica_prestamos.equipos ORDER BY categoria`
      );
      return r.rows.map(fila => fila.categoria);
    },

    // Equipo + usuario que lo tiene ahora (si lo hay).
    // LEFT JOIN: el equipo aparece aunque no tenga préstamo activo (usuario = NULL).
    async buscarDetalle(id) {
      const r = await pool.query(
        `SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible,
                u.nombre AS usuario_actual, p.fecha_prestamo AS prestado_desde
         FROM practica_prestamos.equipos AS e
         LEFT JOIN practica_prestamos.prestamos AS p
           ON p.equipo_id = e.id AND p.fecha_devolucion IS NULL
         LEFT JOIN practica_prestamos.usuarios AS u ON u.id = p.usuario_id
         WHERE e.id = $1`,
        [id]
      );
      return r.rows[0] ?? null;
    },

    // Historial de préstamos del equipo con el nombre del usuario (JOIN)
    async historial(id) {
      const r = await pool.query(
        `SELECT p.id, u.nombre AS usuario, p.fecha_prestamo, p.fecha_devolucion
         FROM practica_prestamos.prestamos AS p
         INNER JOIN practica_prestamos.usuarios AS u ON u.id = p.usuario_id
         WHERE p.equipo_id = $1
         ORDER BY p.fecha_prestamo DESC, p.id DESC`,
        [id]
      );
      return r.rows;
    },

    // INSERT ... RETURNING: devuelve el equipo creado sin otra consulta
    async crear({ codigo, nombre, categoria }) {
      const r = await pool.query(
        `INSERT INTO practica_prestamos.equipos(codigo, nombre, categoria)
         VALUES ($1, $2, $3)
         RETURNING id, codigo, nombre, categoria, disponible`,
        [codigo, nombre, categoria]
      );
      return r.rows[0];
    },

    // UPDATE ... WHERE id=$4. No toca "disponible": solo cambia al prestar o devolver.
    // Devuelve null si rowCount es 0 (no existe ese id).
    async actualizar(id, { codigo, nombre, categoria }) {
      const r = await pool.query(
        `UPDATE practica_prestamos.equipos
         SET codigo = $1, nombre = $2, categoria = $3
         WHERE id = $4
         RETURNING id, codigo, nombre, categoria, disponible`,
        [codigo, nombre, categoria, id]
      );
      if (r.rowCount === 0) return null;
      return r.rows[0];
    },

    // DELETE ... WHERE id=$1. Devuelve false si no existía.
    // Si tiene préstamos, la clave foránea lo impide (SQLSTATE 23503).
    async eliminar(id) {
      try {
        const r = await pool.query(
          'DELETE FROM practica_prestamos.equipos WHERE id = $1', [id]);
        return r.rowCount > 0;
      } catch (error) {
        if (error.code === '23503') throw fallo('CON_PRESTAMOS');
        throw error;
      }
    }
  };
}
