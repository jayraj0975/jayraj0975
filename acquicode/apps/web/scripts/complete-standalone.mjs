// Next.js standalone output omits static assets and public/; the server needs both
// next to it. Copy them so `node .next/standalone/apps/web/server.js` serves a complete site.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const web = new URL('..', import.meta.url).pathname;
const target = join(web, '.next/standalone/apps/web');
if (!existsSync(join(target, 'server.js'))) {
  console.error('standalone output not found; run `next build` first');
  process.exit(1);
}
rmSync(join(target, '.next/static'), { recursive: true, force: true });
cpSync(join(web, '.next/static'), join(target, '.next/static'), { recursive: true });
if (existsSync(join(web, 'public'))) cpSync(join(web, 'public'), join(target, 'public'), { recursive: true });
console.log('standalone output completed with static assets');
