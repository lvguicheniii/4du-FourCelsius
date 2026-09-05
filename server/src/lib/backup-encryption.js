const crypto = require('node:crypto');

const MAGIC = Buffer.from('SIDUBKP1', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function backupEncryptionKey({ required = false } = {}) {
  const encoded = String(process.env.SIDU_BACKUP_ENCRYPTION_KEY || '').trim();
  if (!encoded) {
    if (required) throw new Error('SIDU_BACKUP_ENCRYPTION_KEY is required');
    return null;
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new Error('SIDU_BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

function encryptBackup(plaintext, key = backupEncryptionKey({ required: true })) {
  if (!Buffer.isBuffer(plaintext)) throw new TypeError('Backup plaintext must be a Buffer');
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

function isEncryptedBackup(payload) {
  return Buffer.isBuffer(payload)
    && payload.length >= MAGIC.length + NONCE_BYTES + TAG_BYTES
    && payload.subarray(0, MAGIC.length).equals(MAGIC);
}

function decryptBackup(payload, key = backupEncryptionKey({ required: true })) {
  if (!isEncryptedBackup(payload)) throw new Error('Backup is not in the SIDUBKP1 encrypted format');
  const nonceStart = MAGIC.length;
  const tagStart = nonceStart + NONCE_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const nonce = payload.subarray(nonceStart, tagStart);
  const tag = payload.subarray(tagStart, ciphertextStart);
  const ciphertext = payload.subarray(ciphertextStart);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Encrypted backup authentication failed');
  }
}

function selectLatestBackup(contents) {
  return [...(contents || [])]
    .filter(object => /\/sidu-[^/]+\.db(?:\.enc)?$/.test(String(object.Key || '')))
    .sort((left, right) => String(right.LastModified).localeCompare(String(left.LastModified)))[0] || null;
}

function decodeBackupObject(object, key) {
  if (!Buffer.isBuffer(object?.Body) || object.Body.length === 0) throw new Error('Downloaded backup is empty');
  const encrypted = String(object.Key || '').endsWith('.enc') || isEncryptedBackup(object.Body);
  return encrypted ? decryptBackup(object.Body, key || backupEncryptionKey({ required: true })) : object.Body;
}

module.exports = {
  backupEncryptionKey,
  decodeBackupObject,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  selectLatestBackup,
};
