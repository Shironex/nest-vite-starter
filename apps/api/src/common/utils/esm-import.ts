/**
 * Workaround for dynamic ESM imports in CJS-compiled NestJS context.
 * NestJS compiles to CommonJS (module: node16), which rewrites dynamic import()
 * to require(). This uses new Function() to preserve the real import().
 *
 * The function is compiled PER CALL with a unique source string, not once at
 * module load. Under jest's --experimental-vm-modules lane, V8 dedupes
 * identically-sourced Function bodies within a worker isolate, so when two
 * isolation spec files run on one worker the second file would receive the
 * first file's compiled import callback, bound to a jest environment that has
 * already been torn down ("import a file after the Jest environment has been
 * torn down"). A unique comment defeats the cache and binds the dynamic-import
 * callback to the CURRENT environment. At runtime the cost is one tiny
 * compilation per call, and every production call site runs once at boot.
 */
let sequence = 0;
export const esmImport = (specifier: string): Promise<unknown> => {
  sequence += 1;
  const importer = new Function(
    'specifier',
    `/* esm-import ${process.pid}-${sequence}-${Math.random().toString(36).slice(2)} */ return import(specifier)`,
  ) as (specifier: string) => Promise<unknown>;
  return importer(specifier);
};
