import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import { canonicalJson } from '../canonical.js';
import type { Dossier } from '../model.js';
import { dossierDigest } from '../analyze.js';
import { PREDICATE_TYPE } from '../version.js';

export const PAYLOAD_TYPE = 'application/vnd.in-toto+json';
export const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';

export type AttestationLevel = 'SELF_ATTESTED' | 'PLATFORM_ATTESTED';

export interface DsseEnvelope {
  payloadType: string;
  payload: string;
  signatures: Array<{ keyid: string; sig: string }>;
}

export interface DossierStatement {
  _type: typeof STATEMENT_TYPE;
  subject: Array<{ name: string; digest: Record<string, string> }>;
  predicateType: string;
  predicate: {
    analyzer: Dossier['analyzer'];
    schema: string;
    dossierDigest: string;
    readiness: Dossier['readiness']['level'];
    options: Dossier['options'];
    enrichment: Dossier['coverage']['enrichment'];
    attestation: { level: AttestationLevel; producer: string; producedAt: string; note: string };
    artifacts: Array<{ name: string; sha256: string }>;
  };
}

export interface KeyPairPem {
  publicKey: string;
  privateKey: string;
  keyid: string;
}

export function generateSigningKey(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyid: keyIdOf(publicKey),
  };
}

export function keyIdOf(publicKey: KeyObject | string): string {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  const der = key.export({ type: 'spki', format: 'der' });
  return `ed25519:${createHash('sha256').update(der).digest('hex').slice(0, 32)}`;
}

/** DSSE pre-authentication encoding. */
export function pae(payloadType: string, payload: Buffer): Buffer {
  const t = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([Buffer.from(`DSSEv1 ${t.length} `), t, Buffer.from(` ${payload.length} `), payload]);
}

export function buildStatement(
  dossier: Dossier,
  opts: { level: AttestationLevel; producer: string; producedAt?: string; artifacts?: Array<{ name: string; sha256: string }> },
): DossierStatement {
  const digest = dossierDigest(dossier);
  const subject: DossierStatement['subject'] = dossier.subjects.map((s) => ({
    name: s.name,
    digest: { ...(s.headCommit ? { gitCommit: s.headCommit } : {}), sha256: s.contentDigest },
  }));
  subject.push({ name: 'dossier.json', digest: { sha256: digest } });
  return {
    _type: STATEMENT_TYPE,
    subject,
    predicateType: PREDICATE_TYPE,
    predicate: {
      analyzer: dossier.analyzer,
      schema: dossier.schema,
      dossierDigest: digest,
      readiness: dossier.readiness.level,
      options: dossier.options,
      enrichment: dossier.coverage.enrichment,
      attestation: {
        level: opts.level,
        producer: opts.producer,
        producedAt: opts.producedAt ?? new Date().toISOString(),
        note:
          opts.level === 'PLATFORM_ATTESTED'
            ? 'The analyzer fetched the repository directly from the forge; the signer attests it ran the stated analyzer on those commits.'
            : 'Produced where the code lives. The signature binds the signer to this dossier; anyone with access to the same commits can re-run the analyzer and must obtain the same dossier digest.',
      },
      artifacts: opts.artifacts ?? [],
    },
  };
}

export function signStatement(statement: DossierStatement, privateKeyPem: string): DsseEnvelope {
  const key = createPrivateKey(privateKeyPem);
  const payload = Buffer.from(canonicalJson(statement), 'utf8');
  const sig = edSign(null, pae(PAYLOAD_TYPE, payload), key);
  return {
    payloadType: PAYLOAD_TYPE,
    payload: payload.toString('base64'),
    signatures: [{ keyid: keyIdOf(createPublicKey(key)), sig: sig.toString('base64') }],
  };
}

export interface VerifyResult {
  signatureValid: boolean;
  keyid: string | null;
  statement: DossierStatement | null;
  dossierMatches: boolean | null;
  problems: string[];
}

/**
 * Verify a DSSE envelope with trusted public keys and, when a dossier is given,
 * that the dossier's canonical digest is the one that was signed.
 */
export function verifyEnvelope(envelope: DsseEnvelope, trustedKeysPem: string[], dossier?: Dossier): VerifyResult {
  const problems: string[] = [];
  if (envelope.payloadType !== PAYLOAD_TYPE) problems.push(`unexpected payloadType ${envelope.payloadType}`);
  let payload: Buffer;
  try {
    payload = Buffer.from(envelope.payload, 'base64');
  } catch {
    return { signatureValid: false, keyid: null, statement: null, dossierMatches: null, problems: ['payload is not base64'] };
  }
  let valid = false;
  let keyid: string | null = null;
  for (const pem of trustedKeysPem) {
    let pub: KeyObject;
    try {
      pub = createPublicKey(pem);
    } catch {
      problems.push('a trusted key could not be parsed');
      continue;
    }
    const id = keyIdOf(pub);
    for (const s of envelope.signatures ?? []) {
      if (s.keyid && s.keyid !== id) continue;
      try {
        if (edVerify(null, pae(envelope.payloadType, payload), pub, Buffer.from(s.sig, 'base64'))) {
          valid = true;
          keyid = id;
        }
      } catch {
        problems.push('signature could not be checked');
      }
    }
  }
  if (!valid) problems.push('no signature verifies against the trusted keys');
  let statement: DossierStatement | null = null;
  try {
    statement = JSON.parse(payload.toString('utf8')) as DossierStatement;
    if (statement._type !== STATEMENT_TYPE) problems.push('payload is not an in-toto v1 statement');
    if (statement.predicateType !== PREDICATE_TYPE) problems.push('unexpected predicate type');
  } catch {
    problems.push('payload is not JSON');
  }
  let dossierMatches: boolean | null = null;
  if (dossier && statement) {
    const digest = dossierDigest(dossier);
    dossierMatches = digest === statement.predicate?.dossierDigest && statement.subject.some((s) => s.name === 'dossier.json' && s.digest.sha256 === digest);
    if (!dossierMatches) problems.push('the dossier does not match the signed digest (it was modified, or produced by a different analysis)');
    for (const subj of dossier.subjects) {
      const signed = statement.subject.find((s) => s.name === subj.name);
      if (!signed || (subj.headCommit && signed.digest.gitCommit !== subj.headCommit) || signed.digest.sha256 !== subj.contentDigest) {
        problems.push(`subject ${subj.name} does not match the signed statement`);
        dossierMatches = false;
      }
    }
  }
  return { signatureValid: valid, keyid, statement, dossierMatches, problems };
}
