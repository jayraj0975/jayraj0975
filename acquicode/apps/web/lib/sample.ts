import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, GitSource, type Dossier } from '@acquicode/engine';
import { buildMeridian } from '@acquicode/engine/demo';

let cached: Promise<Dossier> | null = null;

/**
 * The public sample dossier: the real engine run against "Meridian Systems",
 * a synthetic company built by a script. Clearly labelled as demo data
 * wherever it is shown; never mixed with customer data.
 */
export function sampleDossier(): Promise<Dossier> {
  if (!cached) {
    cached = (async () => {
      const dir = await mkdtemp(join(tmpdir(), 'acq-sample-'));
      try {
        const b = buildMeridian(join(dir, 'meridian'));
        return await analyze([{ source: await GitSource.open(b.dir, { name: 'meridian-systems/meridian-platform' }) }], { title: 'Meridian Systems (synthetic demo company)' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
