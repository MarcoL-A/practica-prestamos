// Inicializa (o reinicia) la base: lee init.sql y lo ejecuta como dwes_app.
// ¡Borra los datos del esquema practica_prestamos y vuelve a los de ejemplo!
import { readFile } from 'node:fs/promises';
import { pool } from './db.mjs';

try {
  const sql = await readFile(new URL('../init.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Esquema practica_prestamos creado con los datos de ejemplo');
} catch {
  console.error('No se pudo inicializar la base de datos');
  process.exitCode = 1;
} finally {
  await pool.end();
}
