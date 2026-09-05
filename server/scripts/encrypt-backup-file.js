const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: process.env.SIDU_ENV_PATH || '/opt/sidu/.env' });

const { backupEncryptionKey, decryptBackup, encryptBackup } = require('../src/lib/backup-encryption');

function main() {
  const [sourcePath, destinationPath] = process.argv.slice(2);
  if (!sourcePath || !destinationPath) {
    throw new Error('Usage: node scripts/encrypt-backup-file.js <source.db> <destination.db.enc>');
  }
  const plaintext = fs.readFileSync(sourcePath);
  const key = backupEncryptionKey({ required: true });
  const encrypted = encryptBackup(plaintext, key);
  const verified = decryptBackup(encrypted, key);
  if (!verified.equals(plaintext)) throw new Error('Encrypted backup verification mismatch');
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, encrypted, { flag: 'wx', mode: 0o600 });
  console.log(`[backup-encryption] encrypted bytes=${plaintext.length} output=${path.basename(destinationPath)}`);
}

try {
  main();
} catch (error) {
  console.error('[backup-encryption] failed:', error.message);
  process.exitCode = 1;
}
