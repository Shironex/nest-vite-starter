/**
 * Two small object helpers that exist to remove hand-maintained key lists.
 *
 * Both are here rather than inline because the pattern they replace is the one
 * that drifts: a function that copies a fixed set of fields from one shape onto
 * another, written out as a run of `if (input.x !== undefined) patch.x = ...`
 * lines. A field added to the source type is a silent no-op in every such run,
 * with no compile error and no failing test; the edit simply does not arrive.
 * Driving the copy from a `satisfies`-checked key list turns that into a
 * missing-property error at the list.
 */

/**
 * `Object.keys`, with the key type kept.
 *
 * `Object.keys` is typed `string[]` for a real reason: structural typing lets
 * a value carry more properties than its type declares, so the narrower return
 * would be unsound in general. It is sound at the call sites here, which pass
 * an object LITERAL declared in the same file, where the declared type and the
 * runtime keys are the same set by construction.
 */
export function keysOf<T extends object>(value: T): readonly (keyof T)[] {
  return Object.keys(value) as (keyof T)[];
}

/**
 * `Pick`, with every property optional AND with `undefined` removed from the
 * value types.
 *
 * Not `Partial<Pick<T, K>>`, and the difference matters under
 * `exactOptionalPropertyTypes`: a source field declared `x?: string | undefined`
 * keeps that `| undefined` through `Partial`, and a Prisma update input declares
 * `x?: string`, so the result would be rejected by the very targets these
 * patches exist to build. `Exclude<T[P], undefined>` states what the runtime
 * already guarantees: a key present in the output was present and defined in
 * the input.
 */
type DefinedPick<T, K extends keyof T> = { [P in K]?: Exclude<T[P], undefined> };

/** `value !== undefined`, as a narrowing the compiler can carry through a generic. */
function isDefined<V>(value: V): value is Exclude<V, undefined> {
  return value !== undefined;
}

/**
 * Copy the named keys from `source`, skipping the ones that are `undefined`.
 *
 * ABSENT KEYS ARE OMITTED, NEVER NULLED, which is the property callers depend
 * on: a patch built for a partial update must write a column exactly when the
 * caller mentioned it, so a key whose value is `undefined` has to be missing
 * from the result rather than present-and-undefined. `null` is a VALUE here and
 * is copied through, because for a nullable column "set it to null" and "leave
 * it alone" are different instructions.
 */
export function pickDefined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): DefinedPick<T, K> {
  const out: DefinedPick<T, K> = {};
  for (const key of keys) {
    const value = source[key];
    if (isDefined(value)) out[key] = value;
  }
  return out;
}
