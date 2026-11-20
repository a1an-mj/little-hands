// Backup files: the database, compressed, then encrypted with AES-256-GCM using a key made from the
// owner's backup password with scrypt. Without the password a backup can't be read; any change to
// the file (or the wrong password) makes decryption fail instead of giving wrong data.
//
// Layout:  "LHBK" | version (1 byte) | header length (4 bytes, big-endian) | header JSON | ciphertext | GCM tag (16 bytes)
// The header (format version, date, app version, salt, scrypt settings, IV) is not secret, but it
// is authenticated (used as GCM "additional data"), so it can't be altered either.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

const MAGIC = Buffer.from('LHBK')
const VERSION = 1
const TAG_BYTES = 16

/** scrypt settings: about 0.1 s on a laptop, 32 MB of memory. Stored in each file, so they can change later. */
export const KDF = { N: 2 ** 15, r: 8, p: 1 } as const
export type KdfParams = { N: number; r: number; p: number }

export interface BackupHeader {
  v: number
  /** When the backup was made (ISO). */
  createdAt: string
  appVersion: string
  kdf: KdfParams & { salt: string }
  iv: string
}

export class WrongPasswordError extends Error {
  constructor() {
    super('That password does not open this backup. Check it and try again.')
  }
}

export class NotABackupError extends Error {
  constructor() {
    super('This file is not a Little Hands backup.')
  }
}

export function deriveKey(password: string, salt: Buffer, kdf: KdfParams = KDF): Buffer {
  return scryptSync(password.normalize('NFC'), salt, 32, { ...kdf, maxmem: 128 * kdf.N * kdf.r * 2 })
}

export const newSalt = () => randomBytes(16)

/** Encrypts the database bytes with an already-derived key (daily backups don't ask for the password). */
export function encryptBackup(db: Buffer, key: Buffer, salt: Buffer, meta: { createdAt: string; appVersion: string }, kdf: KdfParams = KDF): Buffer {
  const iv = randomBytes(12)
  const header: BackupHeader = { v: VERSION, createdAt: meta.createdAt, appVersion: meta.appVersion, kdf: { ...kdf, salt: salt.toString('base64') }, iv: iv.toString('base64') }
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(headerBytes)
  const body = Buffer.concat([cipher.update(gzipSync(db)), cipher.final()])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(headerBytes.length)
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), len, headerBytes, body, cipher.getAuthTag()])
}

/** Reads the (unencrypted) header without the password. */
export function readHeader(file: Buffer): { header: BackupHeader; headerBytes: Buffer; body: Buffer } {
  if (file.length < 9 + TAG_BYTES || !file.subarray(0, 4).equals(MAGIC)) throw new NotABackupError()
  if (file[4] !== VERSION) throw new Error('This backup was made by a newer version of Little Hands. Please update the app.')
  const len = file.readUInt32BE(5)
  if (9 + len + TAG_BYTES > file.length) throw new NotABackupError()
  const headerBytes = file.subarray(9, 9 + len)
  let header: BackupHeader
  try {
    header = JSON.parse(headerBytes.toString('utf8')) as BackupHeader
  } catch {
    throw new NotABackupError()
  }
  return { header, headerBytes, body: file.subarray(9 + len) }
}

/** Decrypts a backup with the password. Throws WrongPasswordError for a wrong password or a damaged file. */
export function decryptBackup(file: Buffer, password: string): { db: Buffer; header: BackupHeader } {
  const { header, headerBytes, body } = readHeader(file)
  const key = deriveKey(password, Buffer.from(header.kdf.salt, 'base64'), header.kdf)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'))
  decipher.setAAD(headerBytes)
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES))
  let plain: Buffer
  try {
    plain = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()])
  } catch {
    throw new WrongPasswordError()
  }
  return { db: gunzipSync(plain), header }
}
