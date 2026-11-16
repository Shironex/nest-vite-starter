import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ProviderRegistryService } from './provider-registry.service';
import { OAUTH_PROVIDERS, type IOAuthProvider } from './oauth-provider.interface';

const fakeProvider = (key: string, isEnabled: boolean): IOAuthProvider => ({
  key,
  isEnabled,
  buildAuthorizationUrl: jest.fn(),
  handleCallback: jest.fn(),
});

const buildRegistry = async (providers: readonly IOAuthProvider[]) => {
  const moduleRef = await Test.createTestingModule({
    providers: [ProviderRegistryService, { provide: OAUTH_PROVIDERS, useValue: providers }],
  }).compile();
  return moduleRef.get(ProviderRegistryService);
};

describe('ProviderRegistryService', () => {
  it('resolves an enabled provider by key', async () => {
    const google = fakeProvider('google', true);
    const registry = await buildRegistry([google]);
    expect(registry.get('google')).toBe(google);
  });

  it('hides a disabled provider from lookup and from getEnabled', async () => {
    // Absent credentials disable the provider rather than crash boot, so
    // its routes must 404 exactly like an unknown key would.
    const registry = await buildRegistry([fakeProvider('google', false)]);
    expect(registry.get('google')).toBeUndefined();
    expect(registry.getEnabled()).toEqual([]);
  });

  it('returns undefined for an unknown key, indistinguishably from a disabled one', async () => {
    const registry = await buildRegistry([fakeProvider('google', true)]);
    expect(registry.get('microsoft')).toBeUndefined();
    expect(registry.get('')).toBeUndefined();
  });

  it('lists only enabled providers, in registration order', async () => {
    const google = fakeProvider('google', true);
    const apple = fakeProvider('apple', true);
    const registry = await buildRegistry([google, fakeProvider('microsoft', false), apple]);
    expect(registry.getEnabled()).toEqual([google, apple]);
  });

  it('reports an empty list when nothing is configured', async () => {
    const registry = await buildRegistry([]);
    expect(registry.getEnabled()).toEqual([]);
  });

  it('refuses to construct when two providers claim the same key', async () => {
    // Which one handled a callback would otherwise depend on registration order.
    await expect(
      buildRegistry([fakeProvider('google', true), fakeProvider('google', true)]),
    ).rejects.toThrow(/Duplicate OAuth provider key: google/);
  });
});
