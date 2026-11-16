/**
 * The canary seam's own guard rails. The isolation lane proves what a
 * mutant DOES; this proves the mutant can only ever be selected by the test
 * lane, and that a typo in the runner cannot produce a registry that silently
 * still scopes everything.
 */
import { CANARY_DISABLE_ALL, CANARY_ENV_VAR, resolveCanaryModels } from '@test/tenant-scope-canary';
import { TENANT_SCOPED_MODELS } from './tenant-scope.extension';

describe('resolveCanaryModels', () => {
  it('returns the production registry untouched when nothing is requested', () => {
    expect(resolveCanaryModels(undefined, 'test')).toBe(TENANT_SCOPED_MODELS);
  });

  it('treats the documented blank in .env.example as "no mutant"', () => {
    expect(resolveCanaryModels('', 'production')).toBe(TENANT_SCOPED_MODELS);
  });

  it('drops exactly one model', () => {
    const models = resolveCanaryModels('workspace', 'test');
    expect(models.workspace).toBeUndefined();
    expect(Object.keys(models)).toHaveLength(Object.keys(TENANT_SCOPED_MODELS).length - 1);
  });

  it('scopes nothing at all for the pass-through mutant', () => {
    expect(resolveCanaryModels(CANARY_DISABLE_ALL, 'test')).toEqual({});
  });

  it('refuses a model name that is not in the registry, so a typo cannot read as survival', () => {
    expect(() => resolveCanaryModels('workspacee', 'test')).toThrow(/names no model/u);
  });

  it.each(['production', 'development', undefined])(
    'refuses to mutate the registry when NODE_ENV is %s',
    (nodeEnv) => {
      expect(() => resolveCanaryModels('workspace', nodeEnv)).toThrow(
        new RegExp(`${CANARY_ENV_VAR}.*refused outside the test environment`, 'u'),
      );
    },
  );
});
