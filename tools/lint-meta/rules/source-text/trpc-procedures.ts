import ts from 'typescript';

/*
 * Shared reader for the tRPC procedure rules (procedures-require-guard,
 * procedure-requires-output).
 *
 * nestjs-trpc declares a procedure as a decorated method on a `@Router` class,
 * so both rules need the same facts: which class, which alias, which
 * middlewares apply on the class and on the method, and what the procedure
 * decorator was given. Those facts live in decorators that span lines and nest
 * objects, which is where a regex read goes wrong, so this parses the file with
 * the TypeScript compiler (syntax only, no type checker, no program).
 */

/** Procedure decorators nestjs-trpc exposes that the rules police. */
const PROCEDURE_DECORATORS = new Set(['Query', 'Mutation']);

const ROUTER_DECORATOR = 'Router';
const MIDDLEWARE_DECORATOR = 'UseMiddlewares';

/** Where the routers live. Specs are excluded: they are not served. */
export const ROUTER_FILE_SUFFIX = '.router.ts';
export const ROUTER_SCAN_PATH = 'apps/api/src/';

export interface IProcedure {
  /** Repo-relative file path, for messages. */
  readonly file: string;
  /** 1-based line of the method name. */
  readonly line: number;
  /** The router class name. */
  readonly className: string;
  /** The `@Router({ alias })` value, or the class name when there is none. */
  readonly router: string;
  /** The method name, which is the procedure name on the wire. */
  readonly procedure: string;
  /** `Query` or `Mutation`. */
  readonly kind: string;
  /** Middleware class names from the class-level `@UseMiddlewares`. */
  readonly classMiddlewares: readonly string[];
  /** Middleware class names from the method-level `@UseMiddlewares`. */
  readonly methodMiddlewares: readonly string[];
  /**
   * Whether the procedure decorator's options declare `output`: `true` or
   * `false` when the first argument is an object literal, `null` when it is
   * something else (a variable, a spread) whose keys cannot be read here.
   */
  readonly hasOutput: boolean | null;
}

export interface ISourceFile {
  /** Repo-relative path. */
  readonly file: string;
  readonly source: string;
}

/** Decorator name for `@Name(...)` or `@Name`, or null for anything else. */
function decoratorName(decorator: ts.Decorator): string | null {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;
  return ts.isIdentifier(expression) ? expression.text : null;
}

function decoratorArguments(decorator: ts.Decorator): readonly ts.Expression[] {
  return ts.isCallExpression(decorator.expression) ? decorator.expression.arguments : [];
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

/** The identifiers passed to every `@UseMiddlewares(...)` on a node. */
function middlewaresOf(node: ts.Node): string[] {
  return decoratorsOf(node)
    .filter((decorator) => decoratorName(decorator) === MIDDLEWARE_DECORATOR)
    .flatMap((decorator) =>
      decoratorArguments(decorator).map((argument) =>
        ts.isIdentifier(argument) ? argument.text : argument.getText(),
      ),
    );
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

/** `@Router({ alias: 'x' })` alias, or null when absent or not a string literal. */
function routerAlias(decorator: ts.Decorator): string | null {
  const [options] = decoratorArguments(decorator);
  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    return null;
  }
  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === 'alias' &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return null;
}

/** Whether the procedure decorator's options object declares `output`. */
function declaresOutput(decorator: ts.Decorator): boolean | null {
  const [options] = decoratorArguments(decorator);
  if (options === undefined) {
    return false;
  }
  if (!ts.isObjectLiteralExpression(options)) {
    return null;
  }
  let unreadable = false;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      unreadable = true;
      continue;
    }
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyName(property.name) === 'output'
    ) {
      return true;
    }
  }
  return unreadable ? null : false;
}

/** Every `@Query` / `@Mutation` method on every `@Router` class in `input`. */
export function readProcedures(input: ISourceFile): IProcedure[] {
  const sourceFile = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true);
  const procedures: IProcedure[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) {
      continue;
    }
    const routerDecorator = decoratorsOf(statement).find(
      (decorator) => decoratorName(decorator) === ROUTER_DECORATOR,
    );
    if (routerDecorator === undefined) {
      continue;
    }
    const className = statement.name?.text ?? '<anonymous>';
    const router = routerAlias(routerDecorator) ?? className;
    const classMiddlewares = middlewaresOf(statement);

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) {
        continue;
      }
      const procedureDecorator = decoratorsOf(member).find((decorator) =>
        PROCEDURE_DECORATORS.has(decoratorName(decorator) ?? ''),
      );
      if (procedureDecorator === undefined) {
        continue;
      }
      const procedure = propertyName(member.name) ?? member.name.getText(sourceFile);
      procedures.push({
        file: input.file,
        line: sourceFile.getLineAndCharacterOfPosition(member.name.getStart(sourceFile)).line + 1,
        className,
        router,
        procedure,
        kind: decoratorName(procedureDecorator) ?? '',
        classMiddlewares,
        methodMiddlewares: middlewaresOf(member),
        hasOutput: declaresOutput(procedureDecorator),
      });
    }
  }

  return procedures;
}

/** The router files among `sourceFiles`, keyed by repo-relative path. */
export function routerFiles(sourceFiles: readonly string[]): { file: string; absolute: string }[] {
  return sourceFiles
    .map((absolute) => ({ absolute, normalized: absolute.replace(/\\/gu, '/') }))
    .filter(
      ({ normalized }) =>
        normalized.includes(ROUTER_SCAN_PATH) && normalized.endsWith(ROUTER_FILE_SUFFIX),
    )
    .map(({ absolute, normalized }) => ({
      absolute,
      file: normalized.slice(normalized.indexOf(ROUTER_SCAN_PATH)),
    }));
}
