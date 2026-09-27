import { renderDossierHtml, toCycloneDx, type Dossier, type DsseEnvelope } from '@acquicode/engine';
import { HttpError } from './errors';

export type DownloadKind = 'json' | 'html' | 'sbom' | 'envelope';

export function downloadResponse(kind: string, d: Dossier, envelope: object | null, opts: { banner?: string; filename: string }): Response {
  const safe = opts.filename.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'dossier';
  const headers = (type: string, ext: string) => ({
    'content-type': type,
    'content-disposition': `attachment; filename="${safe}.${ext}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  switch (kind) {
    case 'json':
      return new Response(JSON.stringify(d, null, 2), { headers: headers('application/json; charset=utf-8', 'dossier.json') });
    case 'html':
      return new Response(renderDossierHtml(d, { envelope: (envelope as DsseEnvelope | null) ?? null, ...(opts.banner ? { banner: opts.banner } : {}) }), {
        headers: { ...headers('text/html; charset=utf-8', 'dossier.html'), 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" },
      });
    case 'sbom':
      return new Response(JSON.stringify(toCycloneDx(d), null, 2), { headers: headers('application/vnd.cyclonedx+json', 'sbom.cdx.json') });
    case 'envelope':
      if (!envelope) throw new HttpError(404, 'This dossier is not signed (no signing key was configured when it was produced)');
      return new Response(JSON.stringify(envelope, null, 2), { headers: headers('application/json; charset=utf-8', 'dossier.dsse.json') });
    default:
      throw new HttpError(404, 'Unknown download');
  }
}
