import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENCRYPTION_OVERHEAD, decryptBytes, encryptBytes } from '../public/src/crypto.js';
import { encodeMessage } from '../public/src/modem.js';
import { bytes, decodeSamples, messages, text } from './helpers.js';

test('şifrele → çöz; yanlış parola reddedilir', async () => {
  const plain = bytes('gizli toplantı saat 15:00');
  const sealed = await encryptBytes(plain, 'doğru parola');
  assert.equal(sealed.length, plain.length + ENCRYPTION_OVERHEAD);
  assert.deepEqual(await decryptBytes(sealed, 'doğru parola'), plain);
  await assert.rejects(decryptBytes(sealed, 'yanlış parola'));
  sealed[sealed.length - 1] ^= 1;
  await assert.rejects(decryptBytes(sealed, 'doğru parola'));
});

test('şifreli paket sesle taşınır, bayrak alıcıya ulaşır', async () => {
  const sealed = await encryptBytes(bytes('ses üstünden şifreli 🔒'), 'p@rola');
  const { samples } = encodeMessage(sealed, 'normal', 48000, { encrypted: true });
  const [msg] = messages(decodeSamples(samples, 48000));
  assert.equal(msg.encrypted, true);
  assert.equal(text(await decryptBytes(msg.bytes, 'p@rola')), 'ses üstünden şifreli 🔒');
});
