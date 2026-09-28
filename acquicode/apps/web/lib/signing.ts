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

export interface PublishedKey {
  keyid: string;
  publicKeyPem: string;
  status: 'current' | 'retired';
}

/** Every public key this deployment has signed platform dossiers with: the current one first, then retired ones. */
export function platformPublicKeys(): PublishedKey[] {
  const out: PublishedKey[] = [];
  const current = platformKey();
  if (current) out.push({ keyid: current.keyid, publicKeyPem: current.publicKeyPem, status: 'current' });
  const raw = config().PLATFORM_RETIRED_PUBLIC_KEYS;
  if (raw) {
    const text = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
    for (const m of text.matchAll(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g)) {
      const pub = createPublicKey(m[0]);
      if (pub.asymmetricKeyType !== 'ed25519') throw new Error('PLATFORM_RETIRED_PUBLIC_KEYS must contain Ed25519 public keys');
      const pem = pub.export({ type: 'spki', format: 'pem' }).toString();
      const keyid = keyIdOf(pub);
      if (!out.some((k) => k.keyid === keyid)) out.push({ keyid, publicKeyPem: pem, status: 'retired' });
    }
  }
  return out;
}
