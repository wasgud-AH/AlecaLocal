'use strict';
// Decrypts AlecaFrame's lastData.dat / deltas.dat (AES-128-CBC, PKCS7).
// The key and IV are not shipped with this repo: they're read from aleca-key.json (gitignored)
// or the ALECA_KEY / ALECA_IV environment variables. See aleca-key.example.json.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, '..', 'aleca-key.json');

// Accepts a 32-char hex string or an array of 16 byte values
function toBytes(v, label) {
  let buf = null;
  if (Array.isArray(v)) buf = Buffer.from(v);
  else if (typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v.trim())) buf = Buffer.from(v.trim(), 'hex');
  if (!buf || buf.length !== 16) throw new Error(`${label} must be 16 bytes (32 hex characters or an array of 16 numbers)`);
  return buf;
}

let cached = null;
function loadKey() {
  if (cached) return cached;
  let key = process.env.ALECA_KEY, iv = process.env.ALECA_IV;
  if (!key || !iv) {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    } catch (e) {
      throw new Error(`No decryption key: create ${path.basename(KEY_FILE)} (see aleca-key.example.json) or set ALECA_KEY and ALECA_IV`);
    }
    key = cfg.key; iv = cfg.iv;
  }
  cached = { key: toBytes(key, 'key'), iv: toBytes(iv, 'iv') };
  return cached;
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function decryptBuffer(buf) {
  // Plaintext fast path: AlecaFrame sometimes writes the JSON unencrypted.
  if (buf.length >= 2 && buf[0] === 0x7b && buf[buf.length - 1] === 0x7d) {
    return stripBom(buf.toString('utf8'));
  }
  const { key, iv } = loadKey();
  const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const out = Buffer.concat([d.update(buf), d.final()]);
  return stripBom(out.toString('utf8'));
}

function decryptFile(file) {
  return decryptBuffer(fs.readFileSync(file));
}

module.exports = { decryptBuffer, decryptFile };
