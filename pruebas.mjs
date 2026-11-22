// Comprobaciones mínimas de la práctica con fetch (sin framework de pruebas).
// 1. Arranca antes el servidor: npm start
// 2. En otra terminal: npm run pruebas
// ¡Reinicia los datos con init.sql al empezar, para partir siempre del mismo estado!
// Además de mirar el código HTTP, consulta las tablas para ver el estado real.
import { readFile } from 'node:fs/promises';
import { pool } from './src/db.mjs';

const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const resultados = [];

function anotar(caso, peticion, esperado, obtenido, correcto) {
  resultados.push({ caso, peticion, esperado, obtenido, ok: correcto ? 'OK' : 'FALLO' });
}

async function enviar(metodo, ruta, datos) {
  const opciones = { method: metodo };
  if (datos !== undefined) {
    opciones.headers = { 'Content-Type': 'application/json' };
    opciones.body = typeof datos === 'string' ? datos : JSON.stringify(datos);
  }
  const r = await fetch(base + ruta, opciones);
  const texto = await r.text(); // 204 no tiene cuerpo
  let cuerpo = texto;
  try { cuerpo = JSON.parse(texto); } catch { /* no era JSON */ }
  return { estado: r.status, cuerpo, location: r.headers.get('location') };
}

// Número de filas de la tabla HTML del listado (cada equipo es un enlace /equipos/id)
const contarFilas = html => (html.match(/<a href="\/equipos\/\d+">/g) ?? []).length;

async function estadoEquipo(id) {
  const e = await pool.query(
    'SELECT disponible FROM practica_prestamos.equipos WHERE id = $1', [id]);
  const p = await pool.query(
    `SELECT id, fecha_devolucion FROM practica_prestamos.prestamos
     WHERE equipo_id = $1 ORDER BY id`, [id]);
  const activos = p.rows.filter(f => f.fecha_devolucion === null).length;
  return { disponible: e.rows[0]?.disponible, prestamos: p.rowCount, activos };
}

try {
  // Estado inicial conocido
  await pool.query(await readFile(new URL('./init.sql', import.meta.url), 'utf8'));

  // ---------- Alta y modificación ----------
  const alta = await enviar('POST', '/api/equipos',
    { codigo: 'PORT-04', nombre: 'Portátil Asus', categoria: 'portatil' });
  anotar('Alta', 'POST /api/equipos PORT-04', '201 + Location',
    `${alta.estado} ${alta.location}`, alta.estado === 201 && alta.location === `/equipos/${alta.cuerpo.id}`);
  const nuevoId = alta.cuerpo.id;

  const cambio = await enviar('PUT', `/api/equipos/${nuevoId}`,
    { codigo: 'PORT-04', nombre: 'Portátil Asus Vivobook', categoria: 'portatil' });
  anotar('Modificación', `PUT /api/equipos/${nuevoId}`, '200 con el nombre nuevo',
    `${cambio.estado} ${cambio.cuerpo.nombre}`, cambio.estado === 200 && cambio.cuerpo.nombre === 'Portátil Asus Vivobook');

  const repetido = await enviar('POST', '/api/equipos',
    { codigo: 'PORT-01', nombre: 'Otro portátil', categoria: 'portatil' });
  anotar('Código repetido', 'POST /api/equipos PORT-01', '409',
    `${repetido.estado} ${repetido.cuerpo.error}`, repetido.estado === 409);

  const noExiste = await enviar('PUT', '/api/equipos/999',
    { codigo: 'X-1', nombre: 'Nada', categoria: 'otro' });
  anotar('Modificar inexistente', 'PUT /api/equipos/999', '404', String(noExiste.estado), noExiste.estado === 404);

  const invalido = await enviar('POST', '/api/equipos', { codigo: '', nombre: '   ', categoria: 'x' });
  anotar('Datos inválidos', 'POST /api/equipos codigo vacío', '400', String(invalido.estado), invalido.estado === 400);

  const jsonMal = await enviar('POST', '/api/equipos', '{"codigo": ');
  anotar('JSON mal formado', 'POST /api/equipos {"codigo": ', '400', `${jsonMal.estado} ${jsonMal.cuerpo.error}`, jsonMal.estado === 400);

  // ---------- Consulta y filtros ----------
  const buscar = await enviar('GET', '/equipos?q=LENOVO');
  anotar('Búsqueda ILIKE', 'GET /equipos?q=LENOVO', '1 fila (Lenovo)',
    `${buscar.estado}, ${contarFilas(buscar.cuerpo)} fila(s)`, contarFilas(buscar.cuerpo) === 1 && buscar.cuerpo.includes('Lenovo'));

  const cat = await enviar('GET', '/equipos?categoria=proyector');
  anotar('Filtro categoría', 'GET /equipos?categoria=proyector', '2 filas',
    `${contarFilas(cat.cuerpo)} fila(s)`, contarFilas(cat.cuerpo) === 2);

  const prestados = await enviar('GET', '/equipos?disponible=no');
  anotar('Filtro disponibilidad', 'GET /equipos?disponible=no', '1 fila (PORT-02)',
    `${contarFilas(prestados.cuerpo)} fila(s)`, contarFilas(prestados.cuerpo) === 1 && prestados.cuerpo.includes('PORT-02'));

  const combinados = await enviar('GET', '/equipos?q=port&categoria=portatil&disponible=si');
  anotar('Filtros combinados', 'GET /equipos?q=port&categoria=portatil&disponible=si', '3 filas (PORT-01, 03, 04)',
    `${contarFilas(combinados.cuerpo)} fila(s)`, contarFilas(combinados.cuerpo) === 3);

  const pag2 = await enviar('GET', '/equipos?orden=nombre&pagina=2');
  anotar('Orden y 2.ª página', 'GET /equipos?orden=nombre&pagina=2', '5 filas, enlaces Anterior y Siguiente',
    `${contarFilas(pag2.cuerpo)} fila(s)`, contarFilas(pag2.cuerpo) === 5 && pag2.cuerpo.includes('Anterior') && pag2.cuerpo.includes('Siguiente'));

  const filtrosEnlace = await enviar('GET', '/equipos?categoria=accesorio&orden=nombre');
  anotar('Sin página siguiente', 'GET /equipos?categoria=accesorio', '3 filas y sin enlace Siguiente',
    `${contarFilas(filtrosEnlace.cuerpo)} fila(s)`, contarFilas(filtrosEnlace.cuerpo) === 3 && !filtrosEnlace.cuerpo.includes('Siguiente'));

  const vacio = await enviar('GET', '/equipos?q=zzzz');
  anotar('Sin resultados', 'GET /equipos?q=zzzz', '200 y mensaje claro',
    String(vacio.estado), vacio.estado === 200 && vacio.cuerpo.includes('No hay equipos'));

  const malOrden = await enviar('GET', '/equipos?orden=id;DROP');
  anotar('Orden no permitido', 'GET /equipos?orden=id;DROP', '400', String(malOrden.estado), malOrden.estado === 400);

  // ---------- Detalle ----------
  const detalle = await enviar('GET', '/equipos/2');
  anotar('Detalle prestado', 'GET /equipos/2', '200, prestado a Ana García',
    String(detalle.estado), detalle.estado === 200 && detalle.cuerpo.includes('Ana García'));
  const detalleAbc = await enviar('GET', '/equipos/abc');
  const detalle999 = await enviar('GET', '/equipos/999');
  anotar('Detalle id mal / inexistente', 'GET /equipos/abc y /equipos/999', '400 y 404',
    `${detalleAbc.estado} y ${detalle999.estado}`, detalleAbc.estado === 400 && detalle999.estado === 404);

  // ---------- Borrado ----------
  const borrar = await enviar('DELETE', `/api/equipos/${nuevoId}`);
  anotar('Borrado sin historial', `DELETE /api/equipos/${nuevoId}`, '204', String(borrar.estado), borrar.estado === 204);
  const borrar999 = await enviar('DELETE', '/api/equipos/999');
  anotar('Borrado inexistente', 'DELETE /api/equipos/999', '404', String(borrar999.estado), borrar999.estado === 404);
  const borrarConHistorial = await enviar('DELETE', '/api/equipos/6');
  const sigue6 = await estadoEquipo(6);
  anotar('Borrado con préstamos', 'DELETE /api/equipos/6 (préstamo ya devuelto)', '409 y el equipo sigue',
    `${borrarConHistorial.estado}, préstamos=${sigue6.prestamos}`, borrarConHistorial.estado === 409 && sigue6.prestamos === 1);

  // ---------- Préstamo correcto ----------
  const prestamo = await enviar('POST', '/api/prestamos', { equipoId: 1, usuarioId: 1 });
  const tras1 = await estadoEquipo(1);
  anotar('Préstamo correcto', 'POST /api/prestamos {equipoId:1, usuarioId:1}', '201, 1 activo, disponible=false',
    `${prestamo.estado}, activos=${tras1.activos}, disponible=${tras1.disponible}`,
    prestamo.estado === 201 && tras1.activos === 1 && tras1.disponible === false);

  // ---------- Préstamo duplicado ----------
  const duplicado = await enviar('POST', '/api/prestamos', { equipoId: 1, usuarioId: 2 });
  const tras2 = await estadoEquipo(1);
  anotar('Préstamo duplicado', 'POST /api/prestamos {equipoId:1, usuarioId:2}', '409 y sigue 1 préstamo',
    `${duplicado.estado} ${duplicado.cuerpo.error}, préstamos=${tras2.prestamos}`, duplicado.estado === 409 && tras2.prestamos === 1);

  // ---------- Rollback ----------
  const rollback = await enviar('POST', '/api/prestamos', { equipoId: 3, usuarioId: 999 });
  const tras3 = await estadoEquipo(3);
  anotar('Rollback', 'POST /api/prestamos {equipoId:3, usuarioId:999}', '400, disponible=true, 0 préstamos',
    `${rollback.estado}, disponible=${tras3.disponible}, préstamos=${tras3.prestamos}`,
    rollback.estado === 400 && tras3.disponible === true && tras3.prestamos === 0);

  // ---------- Devolución ----------
  const devolucion = await enviar('POST', `/api/prestamos/${prestamo.cuerpo.id}/devolucion`);
  const tras4 = await estadoEquipo(1);
  anotar('Devolución', `POST /api/prestamos/${prestamo.cuerpo.id}/devolucion`, '200, fecha_devolucion y disponible=true',
    `${devolucion.estado}, fecha=${devolucion.cuerpo.fecha_devolucion ? 'sí' : 'no'}, disponible=${tras4.disponible}`,
    devolucion.estado === 200 && devolucion.cuerpo.fecha_devolucion && tras4.disponible === true);

  const fechaAntes = (await pool.query(
    'SELECT fecha_devolucion FROM practica_prestamos.prestamos WHERE id = $1', [prestamo.cuerpo.id])).rows[0].fecha_devolucion;
  const segunda = await enviar('POST', `/api/prestamos/${prestamo.cuerpo.id}/devolucion`);
  const fechaDespues = (await pool.query(
    'SELECT fecha_devolucion FROM practica_prestamos.prestamos WHERE id = $1', [prestamo.cuerpo.id])).rows[0].fecha_devolucion;
  anotar('Segunda devolución', `POST /api/prestamos/${prestamo.cuerpo.id}/devolucion otra vez`, '409 y no cambia nada',
    `${segunda.estado} ${segunda.cuerpo.error}, fecha igual=${fechaAntes.getTime() === fechaDespues.getTime()}`,
    segunda.estado === 409 && fechaAntes.getTime() === fechaDespues.getTime());

  const devolver999 = await enviar('POST', '/api/prestamos/999/devolucion');
  anotar('Devolver inexistente', 'POST /api/prestamos/999/devolucion', '404', String(devolver999.estado), devolver999.estado === 404);

  // ---------- Simultaneidad ----------
  const simultaneas = await Promise.all([
    enviar('POST', '/api/prestamos', { equipoId: 4, usuarioId: 1 }),
    enviar('POST', '/api/prestamos', { equipoId: 4, usuarioId: 2 })
  ]);
  const estados = simultaneas.map(r => r.estado).sort();
  const tras5 = await estadoEquipo(4);
  anotar('Simultaneidad', '2 × POST /api/prestamos {equipoId:4} con Promise.all', '201 y 409; 1 préstamo',
    `${estados.join(' y ')}; préstamos=${tras5.prestamos}`,
    estados[0] === 201 && estados[1] === 409 && tras5.prestamos === 1);

  console.table(resultados);
} catch {
  console.error('No se pudieron ejecutar las pruebas (¿está arrancado el servidor?)');
  process.exitCode = 1;
} finally {
  await pool.end();
}
