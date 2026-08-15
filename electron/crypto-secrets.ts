import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { safeStorage } from 'electron'

const PREFIX = 'enc:v1:'
const EXPORT_PREFIX = 'customssh-backup'

export type SecretsBackend = 'safeStorage' | 'fallback'

export function secretsBackend(): SecretsBackend {
  try {
    if (safeStorage.isEncryptionAvailable()) return 'safeStorage'
  } catch {
    // ignore
  }
  return 'fallback'
}

function fallbackKey(): Buffer {
  // Device-local key material (not portable across machines — intentional for at-rest).
  const material = [
    process.platform,
    process.arch,
    process.env.USERNAME || process.env.USER || 'user',
    'customssh-secrets-v1',
  ].join('|')
  return createHash('sha256').update(material).digest()
}

function encryptBuffer(plain: Buffer): Buffer {
  if (secretsBackend() === 'safeStorage') {
    return safeStorage.encryptString(plain.toString('utf8'))
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', fallbackKey(), iv)
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([1]), iv, tag, enc])
}

function decryptBuffer(blob: Buffer): string {
  if (secretsBackend() === 'safeStorage') {
    return safeStorage.decryptString(blob)
  }
  if (blob.length < 1 + 12 + 16 || blob[0] !== 1) {
    throw new Error('Invalid encrypted secret')
  }
  const iv = blob.subarray(1, 13)
  const tag = blob.subarray(13, 29)
  const data = blob.subarray(29)
  const decipher = createDecipheriv('aes-256-gcm', fallbackKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function isEncryptedSecret(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/** Encrypt a secret for connections.json. Plain empty stays empty. */
export function encryptSecret(value: string | undefined): string | undefined {
  if (value == null || value === '') return value
  if (isEncryptedSecret(value)) return value
  const blob = encryptBuffer(Buffer.from(value, 'utf8'))
  return PREFIX + blob.toString('base64')
}

/** Decrypt a secret from disk. Plaintext legacy values pass through. */
export function decryptSecret(value: string | undefined): string | undefined {
  if (value == null || value === '') return value
  if (!isEncryptedSecret(value)) return value
  try {
    const blob = Buffer.from(value.slice(PREFIX.length), 'base64')
    return decryptBuffer(blob)
  } catch {
    return undefined
  }
}

export type PassphraseExportEnvelope = {
  format: typeof EXPORT_PREFIX
  version: 1
  exportedAt: string
  encrypted: true
  kdf: 'pbkdf2-sha256'
  iterations: number
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export type PlainExportEnvelope = {
  format: typeof EXPORT_PREFIX
  version: 1
  exportedAt: string
  encrypted: false
  workspace: unknown
}

export function isCustomSshBackup(raw: unknown): raw is PassphraseExportEnvelope | PlainExportEnvelope {
  if (!raw || typeof raw !== 'object') return false
  const obj = raw as Record<string, unknown>
  return obj.format === EXPORT_PREFIX && obj.version === 1
}

export function encryptWorkspaceExport(
  workspaceJson: string,
  passphrase: string,
): PassphraseExportEnvelope {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const iterations = 210_000
  const key = pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([
    cipher.update(Buffer.from(workspaceJson, 'utf8')),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return {
    format: EXPORT_PREFIX,
    version: 1,
    exportedAt: new Date().toISOString(),
    encrypted: true,
    kdf: 'pbkdf2-sha256',
    iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64'),
  }
}

export function decryptWorkspaceExport(
  envelope: PassphraseExportEnvelope,
  passphrase: string,
): string {
  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const data = Buffer.from(envelope.ciphertext, 'base64')
  const key = pbkdf2Sync(passphrase, salt, envelope.iterations, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
