import { Inject, Injectable } from '@nestjs/common';
import { OAUTH_PROVIDERS, type IOAuthProvider } from './oauth-provider.interface';
import { InvariantError } from '../../../../common/errors/invariant-error';

/**
 * Indexes the registered providers by key and answers the two questions the
 * OAuth surface asks: "which providers may I offer?" (discovery endpoint) and
 * "is this `:provider` route param real and usable?".
 *
 * `get` returns nothing for a disabled provider, so an unknown key and a
 * configured-off key are indistinguishable to a caller. That is deliberate: the
 * controller 404s both before any redirect is built, and a probe cannot learn
 * which providers a deployment merely has the code for.
 */
@Injectable()
export class ProviderRegistryService {
  private readonly byKey: ReadonlyMap<string, IOAuthProvider>;
  private readonly enabled: readonly IOAuthProvider[];

  constructor(@Inject(OAUTH_PROVIDERS) providers: readonly IOAuthProvider[]) {
    const byKey = new Map<string, IOAuthProvider>();
    for (const provider of providers) {
      if (byKey.has(provider.key)) {
        // Two providers answering to one key would make which of them handles a
        // callback depend on registration order. Fail the boot instead.
        throw new InvariantError(`Duplicate OAuth provider key: ${provider.key}`);
      }
      byKey.set(provider.key, provider);
    }
    this.byKey = byKey;
    this.enabled = [...byKey.values()].filter((provider) => provider.isEnabled);
  }

  /** The enabled provider for `key`, or undefined when it is unknown or disabled. */
  get(key: string): IOAuthProvider | undefined {
    const provider = this.byKey.get(key);
    return provider?.isEnabled === true ? provider : undefined;
  }

  /** Every provider whose credentials are configured, in registration order. */
  getEnabled(): readonly IOAuthProvider[] {
    return this.enabled;
  }
}
