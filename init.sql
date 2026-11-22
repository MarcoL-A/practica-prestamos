-- Práctica: gestión de préstamos de material informático
-- Crea el esquema, las tablas con sus restricciones y los datos de ejemplo.
-- Se ejecuta como dwes_app. Al repetirlo se reinician SOLO las tablas de este esquema.

CREATE SCHEMA IF NOT EXISTS practica_prestamos;

CREATE TABLE IF NOT EXISTS practica_prestamos.equipos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL UNIQUE CHECK (char_length(codigo) BETWEEN 1 AND 20),
  nombre text NOT NULL CHECK (char_length(trim(nombre)) BETWEEN 1 AND 80),
  categoria text NOT NULL CHECK (char_length(trim(categoria)) BETWEEN 1 AND 40),
  disponible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS practica_prestamos.usuarios (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre text NOT NULL CHECK (char_length(trim(nombre)) BETWEEN 1 AND 80)
);

-- Claves foráneas SIN borrado en cascada: no se puede borrar un equipo
-- (ni un usuario) que tenga préstamos, aunque ya estén devueltos.
CREATE TABLE IF NOT EXISTS practica_prestamos.prestamos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id integer NOT NULL REFERENCES practica_prestamos.equipos(id),
  usuario_id integer NOT NULL REFERENCES practica_prestamos.usuarios(id),
  fecha_prestamo timestamptz NOT NULL DEFAULT now(),
  fecha_devolucion timestamptz,
  CHECK (fecha_devolucion IS NULL OR fecha_devolucion >= fecha_prestamo)
);

-- Índice UNIQUE parcial: solo un préstamo activo (sin devolver) por equipo.
-- Los préstamos ya devueltos no cuentan, así se conserva el historial.
CREATE UNIQUE INDEX IF NOT EXISTS un_prestamo_activo_por_equipo
ON practica_prestamos.prestamos(equipo_id)
WHERE fecha_devolucion IS NULL;

-- Reinicio de datos (solo de este esquema) para empezar siempre igual
TRUNCATE practica_prestamos.prestamos,
  practica_prestamos.equipos, practica_prestamos.usuarios
RESTART IDENTITY;

-- Usuarios de prueba (ids 1, 2 y 3)
INSERT INTO practica_prestamos.usuarios(nombre) VALUES
  ('Ana García'), ('Luis Pérez'), ('Marta Ruiz');

-- 12 equipos de 5 categorías (ids 1 a 12)
INSERT INTO practica_prestamos.equipos(codigo, nombre, categoria) VALUES
  ('PORT-01', 'Portátil Lenovo ThinkPad', 'portatil'),
  ('PORT-02', 'Portátil HP ProBook', 'portatil'),
  ('PORT-03', 'Portátil Dell Latitude', 'portatil'),
  ('TAB-01', 'Tableta Samsung Galaxy Tab', 'tableta'),
  ('TAB-02', 'Tableta iPad 10', 'tableta'),
  ('PROY-01', 'Proyector Epson', 'proyector'),
  ('PROY-02', 'Proyector BenQ', 'proyector'),
  ('CAM-01', 'Cámara web Logitech', 'camara'),
  ('CAM-02', 'Cámara de documentos', 'camara'),
  ('ACC-01', 'Ratón inalámbrico', 'accesorio'),
  ('ACC-02', 'Teclado USB', 'accesorio'),
  ('ACC-03', 'Adaptador HDMI', 'accesorio');

-- Historial de ejemplo:
--   PORT-02 (id 2) prestado ahora mismo a Ana  -> disponible = false
--   PROY-01 (id 6) tuvo un préstamo ya devuelto -> sigue disponible
INSERT INTO practica_prestamos.prestamos(equipo_id, usuario_id, fecha_prestamo, fecha_devolucion) VALUES
  (6, 2, now() - interval '10 days', now() - interval '8 days'),
  (2, 1, now() - interval '1 day', NULL);

UPDATE practica_prestamos.equipos SET disponible = false WHERE id = 2;
