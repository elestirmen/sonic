// İsteğe bağlı parolayla şifreleme: PBKDF2-SHA256 → AES-256-GCM (Web Crypto).
// Paket içeriği: tuz (8) | IV (12) | şifreli metin + etiket (16).
// Tuz, havada geçen süreyi kısa tutmak için 8 bayt; ön hesaplamalı saldırıları
// engellemeye yeter. Kayda alınan ses çevrimdışı denenebileceği için parola güçlü olmalı.

const SALT = 8;
const IV = 12;
const TAG = 16;
const ITERATIONS = 150000;

export const ENCRYPTION_OVERHEAD = SALT + IV + TAG;

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBytes(plain, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT));
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(SALT + IV + ct.length);
  out.set(salt);
  out.set(iv, SALT);
  out.set(ct, SALT + IV);
  return out;
}

/** Parola yanlışsa ya da veri bozuksa hata fırlatır. */
export async function decryptBytes(data, password) {
  if (data.length < ENCRYPTION_OVERHEAD) throw new Error('şifreli veri çok kısa');
  const key = await deriveKey(password, data.subarray(0, SALT));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(SALT, SALT + IV) },
    key,
    data.subarray(SALT + IV),
  );
  return new Uint8Array(plain);
}
