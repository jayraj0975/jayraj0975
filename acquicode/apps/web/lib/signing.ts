import { createPrivateKey, createPublicKey } from 'node:crypto';
import { keyIdOf } from '@acquicode/engine';
import { config } from './config';

/**
 * The platform key signs dossiers produced by the hosted runner
 * (PLATFORM_ATTESTED). Its public half is published at
 * /.well-known/acquicode-signing-key.pem so anyone can verify.
 */
export function platformKey(): { privateKeyPem: string; publicKeyPem: string; keyid: string } | null {
  const raw = config().PLATFORM_SIGNING_KEY;
  if (!raw) return null;
  const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  const priv = createPrivateKey(pem);
  if (priv.asymmetricKeyType !== 'ed25519') throw new Error('PLATFORM_SIGNING_KEY must be an Ed25519 private key');
  const pub = createPublicKey(priv);
  return { privateKeyPem: pem, publicKeyPem: pub.export({ type: 'spki', format: 'pem' }).toString(), keyid: keyIdOf(pub) };
}
