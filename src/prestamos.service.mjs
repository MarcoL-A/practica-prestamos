// Servicio de préstamos: operaciones con varias escrituras dentro de una transacción.
// Recibe el pool; no conoce Express, req, res ni códigos HTTP.
import { fallo } from './errores.mjs';

export function crearServicioPrestamos(pool) {
  // Ayudante: usa UN único cliente para BEGIN ... COMMIT/ROLLBACK
  // y lo libera siempre en finally.
  async function transaccion(trabajo) {
    const cliente = await pool.connect();
    let descartar = false;
    try {
      await cliente.query('BEGIN');
      const resultado = await trabajo(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      try { await cliente.query('ROLLBACK'); }
      catch { descartar = true; } // si falla el rollback, la conexión no vuelve al pool
      throw error;
    } finally {
      cliente.release(descartar);
    }
  }

  return {
    async prestar(equipoId, usuarioId) {
      return transaccion(async cliente => {
        // 1. Actualización condicional: solo pasa a no disponible si ahora lo está.
        //    Si dos peticiones llegan a la vez, solo una modifica la fila.
        const cambio = await cliente.query(
          `UPDATE practica_prestamos.equipos
           SET disponible = false
           WHERE id = $1 AND disponible = true`,
          [equipoId]
        );

        // 2. rowCount 0: o no existe o ya está prestado. No se crea el préstamo.
        if (cambio.rowCount === 0) {
          const existe = await cliente.query(
            'SELECT id FROM practica_prestamos.equipos WHERE id = $1', [equipoId]);
          throw fallo(existe.rowCount === 0 ? 'EQUIPO_NO_EXISTE' : 'NO_DISPONIBLE');
        }

        // 3. Se inserta el préstamo. Si el usuario no existe, la clave foránea
        //    falla (23503) y el ROLLBACK deshace también el UPDATE anterior.
        const r = await cliente.query(
          `INSERT INTO practica_prestamos.prestamos(equipo_id, usuario_id)
           VALUES ($1, $2)
           RETURNING id, equipo_id, usuario_id, fecha_prestamo`,
          [equipoId, usuarioId]
        );
        return r.rows[0];
      });
    },

    async devolver(prestamoId) {
      return transaccion(async cliente => {
        // 1. Solo se modifica si el préstamo sigue activo (fecha_devolucion IS NULL)
        const r = await cliente.query(
          `UPDATE practica_prestamos.prestamos
           SET fecha_devolucion = now()
           WHERE id = $1 AND fecha_devolucion IS NULL
           RETURNING id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion`,
          [prestamoId]
        );

        // Si no existe o ya estaba devuelto, no se toca ningún equipo
        if (r.rowCount === 0) {
          const existe = await cliente.query(
            'SELECT id FROM practica_prestamos.prestamos WHERE id = $1', [prestamoId]);
          throw fallo(existe.rowCount === 0 ? 'PRESTAMO_NO_EXISTE' : 'YA_DEVUELTO');
        }

        // 2. En la misma transacción, el equipo vuelve a estar disponible
        await cliente.query(
          'UPDATE practica_prestamos.equipos SET disponible = true WHERE id = $1',
          [r.rows[0].equipo_id]
        );
        return r.rows[0];
      });
    }
  };
}
