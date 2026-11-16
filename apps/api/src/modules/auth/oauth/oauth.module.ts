import { Module } from '@nestjs/common';
import * as openIdClient from 'openid-client';
import { GoogleProvider } from './providers/google.provider';
import {
  OAUTH_PROVIDERS,
  OPENID_CLIENT,
  type IOAuthProvider,
  type IOpenIdClient,
} from './providers/oauth-provider.interface';
import { ProviderRegistryService } from './providers/provider-registry.service';

/**
 * The library's function surface, rebound onto an ORDINARY object.
 *
 * `import * as` of an ESM-only package (openid-client is `type: module`) under
 * the CJS runtime yields a module NAMESPACE object, and a namespace object's
 * prototype is null. Nest stores a `useValue` verbatim as a provider instance,
 * and `nestjs-trpc`'s RouterFactory walks EVERY provider in the container
 * reading `Reflect.getMetadata(ROUTER_METADATA_KEY, instance.constructor)`. On
 * a null-prototype value `constructor` is `undefined`, `Reflect.getMetadata`
 * rejects an undefined target, and the whole bootstrap dies before the tRPC
 * driver serializes a single route. The library is fine; binding a namespace
 * object into the DI container is not.
 *
 * The three functions are named rather than the namespace spread, so what the
 * token carries is exactly what {@link IOpenIdClient} declares and exactly what
 * the provider specs fake, instead of all 51 of the library's exports.
 */
const openIdClientSurface: IOpenIdClient = {
  discovery: openIdClient.discovery,
  buildAuthorizationUrl: openIdClient.buildAuthorizationUrl,
  authorizationCodeGrant: openIdClient.authorizationCodeGrant,
};

/**
 * The OAuth/OIDC provider submodule (SPEC section 4), imported by AuthModule
 * the same way SessionModule and LockoutModule already split out of it.
 *
 * This file is the ONE place that pulls in the real `openid-client`. Every
 * other file reaches the library through the {@link OPENID_CLIENT} token, which
 * is what lets the provider specs inject a fake and run with no network and no
 * Google project. What the token carries is `openIdClientSurface` below, not
 * the module namespace itself: see the note on that constant.
 *
 * The controller and the flow/account services are declared by AuthModule, not
 * here: the start/callback flow funnels into the 2FA seam
 * (TwoFactorChallengeService) and its collaborators, which live in AuthModule's
 * injector. This module stays the openid-client confinement boundary and
 * exports the registry that flow reads.
 *
 * Adding Microsoft or Apple later is a provider class plus one more entry in
 * the {@link OAUTH_PROVIDERS} factory below: the controller, the registry and
 * the schema do not change.
 */
@Module({
  providers: [
    { provide: OPENID_CLIENT, useValue: openIdClientSurface },
    GoogleProvider,
    {
      provide: OAUTH_PROVIDERS,
      useFactory: (google: GoogleProvider): readonly IOAuthProvider[] => [google],
      inject: [GoogleProvider],
    },
    ProviderRegistryService,
  ],
  exports: [ProviderRegistryService],
})
export class OAuthModule {}
