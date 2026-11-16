import { readFileSync } from 'node:fs';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

import { readProcedures, routerFiles, type ISourceFile } from './trpc-procedures';

const RULE_ID = 'procedure-requires-output';

/*
 * Every tRPC procedure declares `output:` in its decorator options.
 *
 * The output schema is the nestjs-trpc codegen contract, not documentation.
 * Since 2.11, a procedure with no `output` makes the generator import the router
 * class into `apps/api/src/@generated/server.ts` to infer the return type, which
 * drags the api's whole type graph into the web's type check, which fails in
 * ways that are hard to trace back to the missing schema.
 *
 * An options object the rule cannot read (a variable, a spread) reports too:
 * the rule cannot prove `output` is there, and the fail-closed direction is the
 * one that keeps the codegen contract.
 */
export function checkProcedureRequiresOutput(files: readonly ISourceFile[]): IViolation[] {
  const violations: IViolation[] = [];

  for (const file of files) {
    for (const procedure of readProcedures(file)) {
      if (procedure.hasOutput === true) {
        continue;
      }
      const where = `@${procedure.kind} ${procedure.className}.${procedure.procedure} at ${procedure.file}:${String(procedure.line)}`;
      violations.push({
        file: procedure.file,
        rule: RULE_ID,
        message:
          procedure.hasOutput === false
            ? `${where} declares no \`output\`. Without it nestjs-trpc codegen imports the router class into @generated/server.ts and pulls the api type graph into the web build. Add \`output: <zod schema>\` to the decorator options.`
            : `${where} passes decorator options whose keys cannot be read here (a variable or a spread), so \`output\` cannot be verified. Write \`output\` inline in the options object.`,
      });
    }
  }

  return violations;
}

/** Every tRPC procedure declares its output schema. */
export const procedureRequiresOutputRule: IMetaRule = {
  id: RULE_ID,
  category: 'source-text',
  ciCritical: true,
  description:
    'Every @Query / @Mutation in apps/api *.router.ts must declare `output:` in an inline options object (the nestjs-trpc codegen contract).',
  run(ctx: IMetaContext): IViolation[] {
    return checkProcedureRequiresOutput(
      routerFiles(ctx.sourceFiles).map(({ file, absolute }) => ({
        file,
        source: readFileSync(absolute, 'utf8'),
      })),
    );
  },
};
