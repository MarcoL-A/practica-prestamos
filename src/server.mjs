// Arranque de Express: rutas, validación de entradas y traducción de errores a HTTP.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { crearRepositorioEquipos, TAMANO_PAGINA } from './equipos.repo.mjs';
import { crearServicioPrestamos } from './prestamos.service.mjs';

const app = express();
const equipos = crearRepositorioEquipos(pool);
const prestamos = crearServicioPrestamos(pool);

app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('../views/', import.meta.url)));
app.use(express.json({ limit: '10kb' }));

// ---------- Utilidades ----------

const MAX_INTEGER = 2147483647; // integer positivo máximo de PostgreSQL

// Las rutas /api responden JSON; las páginas, texto
function responderError(req, res, estado, error) {
  if (req.path.startsWith('/api/')) return res.status(estado).json({ error });
  return res.status(estado).send(error);
}

const idValido = x => Number.isInteger(x) && x > 0 && x <= MAX_INTEGER;
const esObjeto = x => typeof x === 'object' && x !== null && !Array.isArray(x);

// Valida el cuerpo de alta/modificación. Devuelve los datos limpios o null.
function datosEquipo(b) {
  if (!esObjeto(b)) return null;
  if (typeof b.codigo !== 'string' || typeof b.nombre !== 'string' ||
      typeof b.categoria !== 'string') return null;
  const nombre = b.nombre.trim();
  const categoria = b.categoria.trim().toLowerCase();
  if (!/^[A-Z0-9-]{1,20}$/.test(b.codigo)) return null;
  if (nombre.length < 1 || nombre.length > 80) return null;
  if (categoria.length < 1 || categoria.length > 40) return null;
  return { codigo: b.codigo, nombre, categoria };
}

const formatearFecha = fecha =>
  fecha ? fecha.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) : null;

// Modelos de vista: solo los campos que necesita la plantilla
const aVistaEquipo = fila => ({
  id: fila.id, codigo: fila.codigo, nombre: fila.nombre, categoria: fila.categoria,
  estado: fila.disponible ? 'Disponible' : 'Prestado'
});

// Id de la URL: solo dígitos, sin ceros a la izquierda y dentro de integer
app.param('id', (req, res, next, texto) => {
  const id = Number(texto);
  if (!/^[1-9]\d*$/.test(texto) || !Number.isSafeInteger(id) || id > MAX_INTEGER) {
    return responderError(req, res, 400, 'ID_NO_VALIDO');
  }
  req.idRecurso = id;
  next();
});

// ---------- Vistas HTML ----------

app.get('/', (req, res) => res.redirect('/equipos'));

// 4.1 Listado con búsqueda, filtros, orden y paginación
app.get('/equipos', async (req, res) => {
  const q = req.query.q ?? '';
  const categoria = req.query.categoria ?? '';
  const disponible = req.query.disponible ?? '';
  const orden = req.query.orden ?? 'codigo';
  const textoPagina = req.query.pagina ?? '1';

  // typeof rechaza parámetros repetidos, que Express convierte en arrays
  if (typeof q !== 'string' || q.length > 80 ||
      typeof categoria !== 'string' || categoria.length > 40 ||
      !['', 'si', 'no'].includes(disponible) ||
      !['codigo', 'nombre'].includes(orden) ||
      typeof textoPagina !== 'string' || !/^[1-9]\d{0,3}$/.test(textoPagina)) {
    return res.status(400).send('Filtros no válidos');
  }
  const pagina = Number(textoPagina);
  const filtros = { q, categoria, disponible, orden, pagina };

  const filas = await equipos.listar(filtros);
  const categorias = await equipos.categorias();

  // Enlaces que conservan los filtros al cambiar de página
  const enlace = n => '/equipos?' + new URLSearchParams({
    q, categoria, disponible, orden, pagina: String(n)
  });

  res.render('equipos', {
    equipos: filas.slice(0, TAMANO_PAGINA).map(aVistaEquipo), // la fila extra no se muestra
    categorias, filtros,
    anterior: pagina > 1 ? enlace(pagina - 1) : null,
    siguiente: filas.length > TAMANO_PAGINA ? enlace(pagina + 1) : null
  });
});

// 4.2 Detalle con préstamo actual e historial
app.get('/equipos/:id', async (req, res) => {
  const equipo = await equipos.buscarDetalle(req.idRecurso);
  if (!equipo) return res.status(404).send('Equipo inexistente');
  const historial = await equipos.historial(req.idRecurso);

  res.render('equipo', {
    equipo: {
      ...aVistaEquipo(equipo),
      usuarioActual: equipo.usuario_actual,
      prestadoDesde: formatearFecha(equipo.prestado_desde)
    },
    historial: historial.map(p => ({
      id: p.id, usuario: p.usuario,
      fechaPrestamo: formatearFecha(p.fecha_prestamo),
      fechaDevolucion: formatearFecha(p.fecha_devolucion) ?? 'Pendiente'
    }))
  });
});

// ---------- API JSON ----------

app.post('/api/equipos', async (req, res) => {
  const datos = datosEquipo(req.body);
  if (!datos) return res.status(400).json({ error: 'DATOS_INVALIDOS' });
  const equipo = await equipos.crear(datos);
  res.status(201).location(`/equipos/${equipo.id}`).json(equipo);
});

app.put('/api/equipos/:id', async (req, res) => {
  const datos = datosEquipo(req.body);
  if (!datos) return res.status(400).json({ error: 'DATOS_INVALIDOS' });
  const equipo = await equipos.actualizar(req.idRecurso, datos);
  if (!equipo) return res.status(404).json({ error: 'EQUIPO_NO_EXISTE' });
  res.json(equipo);
});

app.delete('/api/equipos/:id', async (req, res) => {
  const borrado = await equipos.eliminar(req.idRecurso);
  if (!borrado) return res.status(404).json({ error: 'EQUIPO_NO_EXISTE' });
  res.status(204).end();
});

app.post('/api/prestamos', async (req, res) => {
  if (!esObjeto(req.body)) return res.status(400).json({ error: 'DATOS_INVALIDOS' });
  const { equipoId, usuarioId } = req.body;
  if (!idValido(equipoId) || !idValido(usuarioId)) {
    return res.status(400).json({ error: 'DATOS_INVALIDOS' });
  }
  const prestamo = await prestamos.prestar(equipoId, usuarioId);
  res.status(201).json(prestamo);
});

app.post('/api/prestamos/:id/devolucion', async (req, res) => {
  res.json(await prestamos.devolver(req.idRecurso));
});

// ---------- Errores ----------
// Express 5 envía aquí los rechazos de las rutas async.
// Se usa el código estructurado (codigo propio o SQLSTATE), nunca el texto del error.
const ESTADOS_DOMINIO = {
  EQUIPO_NO_EXISTE: 404,
  PRESTAMO_NO_EXISTE: 404,
  NO_DISPONIBLE: 409,
  YA_DEVUELTO: 409,
  CON_PRESTAMOS: 409
};

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return responderError(req, res, 400, 'JSON_INVALIDO');
  if (err.type === 'entity.too.large') return responderError(req, res, 413, 'CUERPO_EXCESIVO');
  if (ESTADOS_DOMINIO[err.codigo]) {
    return responderError(req, res, ESTADOS_DOMINIO[err.codigo], err.codigo);
  }
  if (err.code === '23505') return responderError(req, res, 409, 'DUPLICADO');
  if (err.code === '23503') return responderError(req, res, 400, 'REFERENCIA_INVALIDA');
  if (['23502', '23514'].includes(err.code)) {
    return responderError(req, res, 400, 'DATOS_NO_ADMITIDOS');
  }
  console.error('Error en la aplicación de préstamos'); // sin detalles sensibles
  responderError(req, res, 500, 'ERROR_INTERNO');
});

// ---------- Arranque y cierre ----------
try {
  await pool.query('SELECT 1');
  const puerto = Number(process.env.PORT ?? 3000);
  const servidor = app.listen(puerto, '127.0.0.1',
    () => console.log(`Servidor en http://127.0.0.1:${puerto}/equipos`));
  const cerrar = () => servidor.close(async () => { await pool.end(); });
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
} catch {
  console.error('No se pudo conectar con PostgreSQL');
  await pool.end();
  process.exitCode = 1;
}
