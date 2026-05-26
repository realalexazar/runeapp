import crypto from "crypto";

let cachedKey: Buffer | null = null

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey

  const rawKey = process.env.ENCRYPTION_KEY
  if (!rawKey) {
    throw new Error("Missing ENCRYPTION_KEY")
  }

  cachedKey = Buffer.from(rawKey, "base64")
  return cachedKey
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12); // GCM nonce
  const key = getEncryptionKey()
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey()
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
