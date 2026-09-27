import { describe, expect, it } from 'vitest';
import { parseNpmrc, parsePackageJson, parsePackageLock, parsePnpmLock, parseYarnLock } from '../src/ecosystems/npm.js';
import {
  parseCargoLock,
  parseCargoToml,
  parseComposerJson,
  parseComposerLock,
  parseGemfileLock,
  parseGoMod,
  parsePipfileLock,
  parsePom,
  parsePyproject,
  parsePythonTomlLock,
  parseRequirements,
} from '../src/ecosystems/others.js';

describe('npm', () => {
  it('reads package.json scopes, license and workspaces', () => {
    const m = parsePackageJson('package.json', JSON.stringify({ name: 'x', license: { type: 'MIT' }, workspaces: { packages: ['pkgs/*'] }, dependencies: { a: '^1' }, devDependencies: { b: '2' }, peerDependencies: { a: '^1' } }))!;
    expect(m.direct.get('a')).toEqual({ requirement: '^1', scope: 'production' });
    expect(m.direct.get('b')?.scope).toBe('development');
    expect(m.license).toBe('MIT');
    expect(m.workspaces).toEqual(['pkgs/*']);
    expect(parsePackageJson('p', '{not json')).toBeNull();
  });
  it('reads package-lock v3 with scopes, integrity, licenses and install scripts', () => {
    const lock = parsePackageLock('package-lock.json', JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { a: '^1' } },
        'node_modules/a': { version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-x', license: 'MIT', hasInstallScript: true },
        'node_modules/b': { version: '2.0.0', dev: true },
        'node_modules/g': { version: '1.0.0', resolved: 'git+ssh://git@github.com/o/g.git#0123456789012345678901234567890123456789' },
        'node_modules/w': { link: true, resolved: 'packages/w' },
      },
    }))!;
    expect(lock.deps.find((d) => d.name === 'a')).toMatchObject({ version: '1.0.0', scope: 'production', integrity: 'sha512-x', license: 'MIT', hasInstallScript: true, sourceKind: 'registry' });
    expect(lock.deps.find((d) => d.name === 'b')?.scope).toBe('development');
    expect(lock.deps.find((d) => d.name === 'g')).toMatchObject({ sourceKind: 'git', pinned: true });
    expect(lock.deps.some((d) => d.name === 'w')).toBe(false);
    expect(lock.importers?.get('')?.get('a')).toBe('^1');
  });
  it('reads package-lock v1 nested trees', () => {
    const lock = parsePackageLock('p', JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '2.0.0', dev: true } } } } }))!;
    expect(lock.deps.map((d) => [d.name, d.direct, d.scope])).toEqual([
      ['a', true, 'production'],
      ['b', false, 'development'],
    ]);
  });
  it('reads yarn v1 and berry lockfiles', () => {
    const v1 = parseYarnLock('yarn.lock', '# yarn lockfile v1\n\n"@s/p@^1.0.0", "@s/p@^1.1.0":\n  version "1.2.0"\n  resolved "https://registry.yarnpkg.com/@s/p/-/p-1.2.0.tgz#abc"\n  integrity sha512-q\n\nleft-pad@1.3.0:\n  version "1.3.0"\n')!;
    expect(v1.deps).toEqual([
      expect.objectContaining({ name: '@s/p', version: '1.2.0', integrity: 'sha512-q' }),
      expect.objectContaining({ name: 'left-pad', version: '1.3.0' }),
    ]);
    const berry = parseYarnLock('yarn.lock', '__metadata:\n  version: 8\n\n"lodash@npm:^4.17.0":\n  version: 4.17.21\n  resolution: "lodash@npm:4.17.21"\n  checksum: abc\n\n"app@workspace:.":\n  version: 0.0.0\n  resolution: "app@workspace:."\n')!;
    expect(berry.deps).toEqual([expect.objectContaining({ name: 'lodash', version: '4.17.21', integrity: 'abc' })]);
  });
  it('reads pnpm v9 lockfiles with importers', () => {
    const lock = parsePnpmLock('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      a:\n        specifier: ^1.0.0\n        version: 1.0.0\n    devDependencies:\n      b:\n        specifier: ^2.0.0\n        version: 2.0.0\npackages:\n  a@1.0.0:\n    resolution: {integrity: sha512-a}\n  b@2.0.0:\n    resolution: {integrity: sha512-b}\n  c@3.0.0(react@18.0.0):\n    resolution: {integrity: sha512-c}\n")!;
    expect(lock.deps.map((d) => [d.name, d.version, d.direct, d.scope])).toEqual([
      ['a', '1.0.0', true, 'unknown'],
      ['b', '2.0.0', true, 'development'],
      ['c', '3.0.0', false, 'unknown'],
    ]);
    expect(lock.importers?.get('.')?.get('a')).toBe('^1.0.0');
  });
  it('finds private scopes in .npmrc', () => {
    expect(parseNpmrc('@acme:registry=https://npm.acme.test/\n@pub:registry=https://registry.npmjs.org/\nregistry=https://registry.npmjs.org/')).toEqual({ privateScopes: ['@acme'], defaultRegistry: 'https://registry.npmjs.org/' });
  });
});

describe('Python', () => {
  it('treats fully pinned requirements as a lock and flags VCS/URL requirements', () => {
    const pinned = parseRequirements('requirements.txt', 'requests==2.32.3 --hash=sha256:abc\nnumpy===1.26.4 ; python_version > "3.9"\n');
    expect(pinned.lock?.deps.map((d) => [d.name, d.version])).toEqual([
      ['requests', '2.32.3'],
      ['numpy', '1.26.4'],
    ]);
    const loose = parseRequirements('requirements-dev.txt', '-r base.txt\nflake8>=6\n-e git+https://github.com/o/r.git@main#egg=r_pkg\npkg @ https://x.test/p.whl\n');
    expect(loose.lock).toBeNull();
    expect(loose.manifest.direct.get('flake8')).toMatchObject({ requirement: '>=6', scope: 'development' });
    expect(loose.manifest.direct.has('r-pkg')).toBe(true);
  });
  it('reads PEP 621 and Poetry pyproject files', () => {
    const m = parsePyproject('pyproject.toml', '[project]\nname="x"\nlicense={text="MIT"}\nrequires-python=">=3.11"\ndependencies=["Requests>=2", "pydantic[email]==2.8.0"]\n[project.optional-dependencies]\ntest=["pytest"]\n[tool.poetry.group.dev.dependencies]\nblack="^24"\n')!;
    expect([...m.direct.keys()].sort()).toEqual(['black', 'pydantic', 'pytest', 'requests']);
    expect(m.direct.get('pytest')?.scope).toBe('development');
    expect(m.license).toBe('MIT');
    expect(m.toolchain).toBe('>=3.11');
  });
  it('reads poetry/uv locks and Pipfile.lock', () => {
    const poetry = parsePythonTomlLock('poetry.lock', '[[package]]\nname = "Requests"\nversion = "2.32.3"\ncategory = "main"\nfiles = [{file="r.whl", hash="sha256:x"}]\n\n[[package]]\nname = "pytest"\nversion = "8.0.0"\ncategory = "dev"\n')!;
    expect(poetry.deps.map((d) => [d.name, d.scope, !!d.integrity])).toEqual([
      ['requests', 'production', true],
      ['pytest', 'development', false],
    ]);
    const uv = parsePythonTomlLock('uv.lock', 'version = 1\n[[package]]\nname = "app"\nversion = "0.1.0"\nsource = { editable = "." }\n[[package]]\nname = "httpx"\nversion = "0.27.0"\nsource = { registry = "https://pypi.org/simple" }\n')!;
    expect(uv.deps.map((d) => d.name)).toEqual(['httpx']);
    const pipenv = parsePipfileLock('Pipfile.lock', JSON.stringify({ default: { flask: { version: '==3.0.0', hashes: ['sha256:x'] } }, develop: { pytest: { version: '==8.0.0' } } }))!;
    expect(pipenv.deps).toEqual([expect.objectContaining({ name: 'flask', version: '3.0.0', scope: 'production' }), expect.objectContaining({ name: 'pytest', scope: 'development' })]);
  });
});

describe('Go, Rust, Ruby, PHP, Maven', () => {
  it('reads go.mod including indirect and replaced modules', () => {
    const { manifest, lock } = parseGoMod('go.mod', 'module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/a/b v1.2.3\n\tgolang.org/x/text v0.14.0 // indirect\n)\n\nreplace github.com/a/b => ../b\n');
    expect(manifest.name).toBe('example.com/app');
    expect(manifest.toolchain).toBe('1.22');
    expect(lock.deps.map((d) => [d.name, d.version, d.direct, d.sourceKind])).toEqual([
      ['github.com/a/b', 'v1.2.3', true, 'path'],
      ['golang.org/x/text', 'v0.14.0', false, 'registry'],
    ]);
  });
  it('reads Cargo manifests and locks', () => {
    const m = parseCargoToml('Cargo.toml', '[package]\nname="app"\nlicense="MIT OR Apache-2.0"\n[dependencies]\nserde={version="1", features=["derive"]}\nrand="0.8"\n[dev-dependencies]\ncriterion="0.5"\n')!;
    expect([...m.direct.entries()].map(([k, v]) => [k, v.scope])).toEqual([
      ['serde', 'production'],
      ['rand', 'production'],
      ['criterion', 'development'],
    ]);
    const lock = parseCargoLock('Cargo.lock', '[[package]]\nname = "app"\nversion = "0.1.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "abc"\n\n[[package]]\nname = "g"\nversion = "0.1.0"\nsource = "git+https://github.com/o/g?branch=main#0123456789012345678901234567890123456789"\n')!;
    expect(lock.deps.map((d) => [d.name, d.sourceKind, d.pinned ?? null])).toEqual([
      ['serde', 'registry', null],
      ['g', 'git', true],
    ]);
  });
  it('reads Gemfile.lock, composer and pom files', () => {
    const gem = parseGemfileLock('Gemfile.lock', 'GEM\n  remote: https://rubygems.org/\n  specs:\n    rack (3.0.8)\n    rails (7.1.0)\n      rack (>= 2)\n\nPLATFORMS\n  ruby\n\nDEPENDENCIES\n  rails\n')!;
    expect(gem.deps.map((d) => [d.name, d.version, d.direct])).toEqual([
      ['rack', '3.0.8', false],
      ['rails', '7.1.0', true],
    ]);
    const cj = parseComposerJson('composer.json', JSON.stringify({ name: 'a/b', license: ['MIT', 'GPL-2.0-only'], require: { php: '>=8', 'monolog/monolog': '^3' } }))!;
    expect(cj.license).toBe('MIT OR GPL-2.0-only');
    expect([...cj.direct.keys()]).toEqual(['monolog/monolog']);
    const cl = parseComposerLock('composer.lock', JSON.stringify({ packages: [{ name: 'monolog/monolog', version: 'v3.5.0', license: ['MIT'], dist: { shasum: '' } }], 'packages-dev': [] }))!;
    expect(cl.deps[0]).toMatchObject({ name: 'monolog/monolog', version: '3.5.0', license: 'MIT' });
    const pom = parsePom('pom.xml', '<project><artifactId>app</artifactId><dependencies><dependency><groupId>org.x</groupId><artifactId>y</artifactId><version>1.0.0</version></dependency><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>${junit.version}</version><scope>test</scope></dependency></dependencies></project>');
    expect(pom.lock.deps.map((d) => [d.name, d.version, d.scope])).toEqual([
      ['org.x:y', '1.0.0', 'production'],
      ['junit:junit', null, 'development'],
    ]);
  });
});
