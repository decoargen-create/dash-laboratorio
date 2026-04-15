// Genera el hash PBKDF2-SHA256 de una contraseña para usar en AUTH_USERS.
// Uso:
//   node scripts/hash-password.mjs <password>
// Output: un string del tipo "saltHex$hashHex" que pegás en el campo "h"
// del objeto de usuario dentro de AUTH_USERS.
//
// Ejemplo de AUTH_USERS (en .env o en Vercel → Environment Variables):
//   AUTH_USERS=[{"u":"admin","n":"Admin","r":"admin","h":"..."},{"u":"sofia","n":"Sofia","r":"mentor","h":"..."}]
//
// Importante: el JSON de AUTH_USERS va en UNA sola línea sin saltos.
import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/hash-password.mjs <password>');
  console.error('Ejemplo: node scripts/hash-password.mjs miPasswordSegura123');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const out = salt.toString('hex') + '$' + hash.toString('hex');

console.log(out);
