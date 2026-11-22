# Gestión de préstamos de material informático

Práctica de DWES (2.º DAW). Aplicación web que mantiene el inventario de equipos que un centro presta (portátiles, tabletas, proyectores…) y registra préstamos y devoluciones sin perder la coherencia de los datos. Usa SQL directo con `pg`, consultas parametrizadas, restricciones de PostgreSQL y transacciones.

## Requisitos

- Node.js 24
- Docker con Docker Compose
- PostgreSQL 18 (imagen `postgres:18`, se ejecuta en Docker)
- Dependencias: Express 5, pg 8 y EJS 3 (se instalan con `npm install`)

## Estructura

```
practica-prestamos/
├── infra-postgres/
│   ├── compose.yaml          PostgreSQL 18 en Docker con volumen persistente
│   └── .env.example          Clave del administrador (copiar como .env)
├── init.sql                  Esquema, tablas, restricciones y datos de ejemplo
├── .env.example              Conexión de Node (copiar como .env)
├── .gitignore
├── package.json
├── package-lock.json
├── pruebas.mjs               Comprobaciones con fetch
├── src/
│   ├── server.mjs            Arranque de Express, rutas, validación y errores HTTP
│   ├── db.mjs                Configuración y creación del pool
│   ├── equipos.repo.mjs      SQL del listado, detalle y CRUD de equipos
│   ├── prestamos.service.mjs Transacciones de préstamo y devolución
│   ├── errores.mjs           Errores de dominio con código propio
│   └── init-db.mjs           Ejecuta init.sql desde Node
└── views/
    ├── equipos.ejs           Listado con filtros y paginación
    └── equipo.ejs            Detalle e historial
```

Reparto de responsabilidades:

- `server.mjs` recibe la petición, valida y decide la respuesta HTTP.
- `equipos.repo.mjs` y `prestamos.service.mjs` contienen todo el SQL. Reciben el pool, no conocen `req`, `res` ni códigos HTTP, y señalan los casos de negocio con errores de dominio (`codigo`).
- Las plantillas solo reciben datos ya preparados.

## Instalación y arranque

### 1. Instalar dependencias

```bash
npm install
```

### 2. Arrancar PostgreSQL en Docker

Si ya tienes en marcha el `infra-postgres` de clase (puerto 15432, base `dwes` y usuario `dwes_app`), puedes saltarte este paso y el siguiente.

```bash
cd infra-postgres
cp .env.example .env        # y poner una clave de administrador propia
docker compose up -d
docker compose ps           # esperar a que aparezca "healthy"
```

### 3. Crear el usuario de la aplicación (solo la primera vez)

La aplicación no usa el usuario `postgres`, sino `dwes_app`, que no tiene privilegios de administrador:

```bash
docker compose exec db psql -U postgres -d dwes
```

```sql
CREATE ROLE dwes_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password dwes_app
GRANT CONNECT, CREATE ON DATABASE dwes TO dwes_app;
\q
```

### 4. Configurar la conexión de Node

En la raíz del proyecto:

```bash
cp .env.example .env        # y poner la clave real de dwes_app en PGPASSWORD
```

`.env` no se entrega: está en `.gitignore`. Solo se entrega `.env.example`, sin credenciales reales.

### 5. Inicializar la base

Crea el esquema `practica_prestamos` con sus tablas y datos de ejemplo. Funciona desde una base vacía. Hay dos formas:

```bash
npm run init-db
```

O bien pegar el contenido de `init.sql` en psql como `dwes_app`:

```bash
cd infra-postgres
docker compose exec db psql -h 127.0.0.1 -U dwes_app -d dwes -W
```

**Atención:** repetirlo reinicia los datos del esquema (`TRUNCATE ... RESTART IDENTITY`).

### 6. Arrancar Node

```bash
npm start
```

Abrir http://127.0.0.1:3000/equipos. Antes de abrir el puerto se ejecuta un `SELECT 1` para comprobar la conexión. Con Ctrl+C se cierra el servidor y el pool.

## Modelo de datos

| Tabla | Campos | Restricciones |
|---|---|---|
| `equipos` | id, codigo, nombre, categoria, disponible | `id` identidad autogenerada y PRIMARY KEY; `codigo` NOT NULL, UNIQUE y CHECK de 1 a 20 caracteres; `nombre` (1 a 80) y `categoria` (1 a 40) NOT NULL con CHECK sobre `trim`, para que no se guarden textos vacíos; `disponible` booleano NOT NULL DEFAULT true |
| `usuarios` | id, nombre | PRIMARY KEY; nombre NOT NULL y no vacío |
| `prestamos` | id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion | FOREIGN KEY a `equipos` y `usuarios` **sin** `ON DELETE CASCADE`; `fecha_prestamo` DEFAULT now(); `fecha_devolucion` NULL mientras el préstamo esté activo; CHECK de que la devolución no sea anterior al préstamo |

Además, el índice **UNIQUE parcial** `un_prestamo_activo_por_equipo` sobre `equipo_id WHERE fecha_devolucion IS NULL` impide dos préstamos activos del mismo equipo y conserva el historial de los préstamos ya devueltos.

## Datos iniciales

- **Usuarios:** 1 Ana García, 2 Luis Pérez y 3 Marta Ruiz.
- **12 equipos de 5 categorías:**
  - `portatil`: PORT-01, PORT-02 y PORT-03
  - `tableta`: TAB-01 y TAB-02
  - `proyector`: PROY-01 y PROY-02
  - `camara`: CAM-01 y CAM-02
  - `accesorio`: ACC-01, ACC-02 y ACC-03
- **Préstamos de ejemplo:**
  - PORT-02 (id 2) está prestado ahora a Ana, así que `disponible = false`.
  - PROY-01 (id 6) tuvo un préstamo que ya se devolvió. Sirve para probar que no se puede borrar un equipo con historial.

## Rutas

### Vistas HTML

| Ruta | Descripción |
|---|---|
| `GET /equipos` | Tabla con código, nombre, categoría y estado. Parámetros GET: `q` (búsqueda parcial por nombre con `ILIKE`), `categoria`, `disponible` (`si` / `no`), `orden` (`codigo` / `nombre`) y `pagina`. Muestra 5 por página con `ORDER BY`, `LIMIT` y `OFFSET`. Los enlaces Anterior y Siguiente conservan los filtros (`URLSearchParams`). Si no hay resultados muestra un mensaje. Con filtros no válidos responde 400 |
| `GET /equipos/:id` | Datos del equipo, usuario que lo tiene ahora (`LEFT JOIN`, para que salga aunque no esté prestado) e historial de préstamos con usuario y fechas (`JOIN`). Responde 400 si el id está mal formado y 404 si no existe |

La ordenación nunca concatena lo que envía el usuario: `orden` solo puede ser `codigo` o `nombre`, y se traduce a un fragmento SQL fijo (`ORDENES` en `equipos.repo.mjs`). Los filtros añaden condiciones fijas con su marcador `$n`, y el valor va siempre en el array de parámetros.

### API JSON

| Método y ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /api/equipos` | `{ codigo, nombre, categoria }` | 201 con el equipo y cabecera `Location`; 400 si los datos no son válidos; 409 si el código está repetido |
| `PUT /api/equipos/:id` | `{ codigo, nombre, categoria }` | 200 con el equipo actualizado; 404 si no existe; 409 si el código está repetido. **No** modifica `disponible` |
| `DELETE /api/equipos/:id` | — | 204 sin cuerpo; 404 si no existe; 409 si tiene préstamos |
| `POST /api/prestamos` | `{ equipoId, usuarioId }` | 201 con el préstamo; 404 si el equipo no existe; 409 si está prestado; 400 si el usuario no existe (se hace rollback) |
| `POST /api/prestamos/:id/devolucion` | — | 200 con el préstamo devuelto; 404 si no existe; 409 si ya estaba devuelto |

**Validación:**
- Cuerpo JSON válido y que sea un objeto.
- `codigo` con mayúsculas, números o guiones, de 1 a 20 caracteres.
- `nombre` de 1 a 80 caracteres y `categoria` de 1 a 40 caracteres tras `trim`.
- Los ids deben ser enteros positivos dentro del rango `integer`.
- Un JSON mal formado devuelve 400.

**Errores:**
- Los de PostgreSQL se tratan por su código SQLSTATE: 23505 (UNIQUE) da 409, 23503 (FOREIGN KEY) da 400 y 23502 o 23514 dan 400.
- Al navegador nunca se envían mensajes técnicos ni datos de conexión. Un fallo inesperado devuelve 500 con un mensaje genérico.
- Una consulta sin filas no es un error: el listado vacío responde 200 con su mensaje.

## Transacciones

Las dos operaciones usan el ayudante `transaccion` de `prestamos.service.mjs`. Obtiene **un único cliente** con `pool.connect()`, ejecuta `BEGIN` … `COMMIT`, hace `ROLLBACK` ante cualquier error y libera siempre el cliente en `finally` con `cliente.release()`.

**Préstamo:**
1. `UPDATE ... SET disponible=false WHERE id=$1 AND disponible=true`: solo lo consigue quien encuentra el equipo libre.
2. Si `rowCount` es 0, no se crea el préstamo y se responde con un error controlado (404 si el equipo no existe, 409 si está ocupado).
3. Se hace el `INSERT` en `prestamos`. Si el usuario no existe falla la clave foránea y el `ROLLBACK` deshace también el paso 1.
4. `COMMIT` solo si las dos escrituras han ido bien.

**Devolución:**
1. `UPDATE prestamos SET fecha_devolucion=now() WHERE id=$1 AND fecha_devolucion IS NULL RETURNING equipo_id`.
2. Si no ha afectado a ninguna fila (no existe o ya estaba devuelto), no se toca ningún equipo.
3. En la misma transacción el equipo vuelve a `disponible=true`.

**Simultaneidad:** con el aislamiento por defecto (Read Committed), la segunda actualización del mismo equipo espera a la primera y vuelve a comprobar `disponible=true`, así que afecta a 0 filas. El índice único parcial es una segunda protección dentro de la base de datos.

## Pruebas realizadas

Con el servidor arrancado (`npm start`), en otra terminal:

```bash
npm run pruebas
```

`pruebas.mjs` reinicia los datos con `init.sql`, lanza las peticiones con `fetch` y, además del código HTTP, **consulta las tablas** para comprobar el estado real: disponibilidad y número de préstamos. Resultados obtenidos:

| Caso | Petición | Resultado esperado | Resultado obtenido |
|---|---|---|---|
| Alta | `POST /api/equipos` PORT-04 | 201 + Location | 201, `Location: /equipos/13` ✔ |
| Modificación | `PUT /api/equipos/13` | 200 con el nombre nuevo | 200 «Portátil Asus Vivobook» ✔ |
| Código repetido | `POST /api/equipos` PORT-01 | 409 | 409 DUPLICADO ✔ |
| Modificar inexistente | `PUT /api/equipos/999` | 404 | 404 ✔ |
| Datos inválidos | `POST /api/equipos` con código vacío | 400 | 400 ✔ |
| JSON mal formado | `POST /api/equipos` con `{"codigo": ` | 400 | 400 JSON_INVALIDO ✔ |
| Búsqueda ILIKE | `GET /equipos?q=LENOVO` | 1 fila (Lenovo) | 1 fila ✔ |
| Filtro categoría | `GET /equipos?categoria=proyector` | 2 filas | 2 filas ✔ |
| Filtro disponibilidad | `GET /equipos?disponible=no` | 1 fila (PORT-02) | 1 fila ✔ |
| Filtros combinados | `GET /equipos?q=port&categoria=portatil&disponible=si` | 3 filas | 3 filas ✔ |
| Orden y 2.ª página | `GET /equipos?orden=nombre&pagina=2` | 5 filas con Anterior y Siguiente | 5 filas ✔ |
| Última página | `GET /equipos?categoria=accesorio` | 3 filas, sin Siguiente | 3 filas ✔ |
| Sin resultados | `GET /equipos?q=zzzz` | 200 y mensaje | 200 con mensaje ✔ |
| Orden no permitido | `GET /equipos?orden=id;DROP` | 400 | 400 ✔ |
| Detalle | `GET /equipos/2` | 200, prestado a Ana García | 200 ✔ |
| Detalle con id incorrecto | `GET /equipos/abc` y `GET /equipos/999` | 400 y 404 | 400 y 404 ✔ |
| Borrado sin historial | `DELETE /api/equipos/13` | 204 | 204 ✔ |
| Borrado inexistente | `DELETE /api/equipos/999` | 404 | 404 ✔ |
| Borrado con préstamos | `DELETE /api/equipos/6` (préstamo ya devuelto) | 409 y el equipo sigue | 409, sigue con su préstamo ✔ |
| Préstamo correcto | `POST /api/prestamos {equipoId:1, usuarioId:1}` | 201, 1 activo, no disponible | 201, 1 activo, `disponible=false` ✔ |
| Préstamo duplicado | `POST /api/prestamos {equipoId:1, usuarioId:2}` | 409 sin duplicar filas | 409 NO_DISPONIBLE, 1 préstamo ✔ |
| Rollback | `POST /api/prestamos {equipoId:3, usuarioId:999}` | Error, sigue disponible, 0 préstamos | 400, `disponible=true`, 0 préstamos ✔ |
| Devolución | `POST /api/prestamos/3/devolucion` | 200, fecha registrada, disponible | 200, `fecha_devolucion` registrada, `disponible=true` ✔ |
| Segunda devolución | La misma petición otra vez | Error y no cambia nada | 409 YA_DEVUELTO, misma fecha ✔ |
| Devolver inexistente | `POST /api/prestamos/999/devolucion` | 404 | 404 ✔ |
| Simultaneidad | 2 × `POST /api/prestamos {equipoId:4}` con `Promise.all` | Solo se confirma uno | 201 y 409, 1 préstamo ✔ |

También se ha comprobado que un nombre con `<script>` se muestra como texto en la vista, porque `<%= %>` escapa los valores, y que un parámetro repetido (`?q=a&q=b`) devuelve 400.

## Limitaciones conocidas

- No hay autenticación ni permisos. `usuarioId` llega en el cuerpo para poder probar con los usuarios de ejemplo; en una aplicación real saldría de la identidad autenticada.
- No hay endpoints para gestionar usuarios: se crean en `init.sql`.
- Altas, modificaciones, borrados, préstamos y devoluciones se hacen por la API, con `pruebas.mjs` o con un cliente HTTP. La interfaz HTML solo sirve para consultar.
- La búsqueda trata `%` y `_` como comodines de `ILIKE`; no se escapan.
- La paginación usa `OFFSET`. Si se insertan o borran equipos entre dos peticiones, las páginas pueden desplazarse.
- `disponible` es un dato redundante con los préstamos activos. Se mantiene coherente porque solo cambia dentro de las transacciones de préstamo y devolución, nunca desde `PUT`.
- Las fechas se muestran con la zona horaria `Europe/Madrid`.
