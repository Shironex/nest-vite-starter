/** Resolved view for the sidebar's organization identity block. */
export interface IOrganizationIdentityView {
  /** The organization's display name, or the translated fallback when it has none. */
  readonly name: string;
  /** One or two letters drawn in the avatar glyph. */
  readonly initial: string;
}

/**
 * What the footer draws, by `user.tenant` query state.
 *
 * `pending` reserves the footer's space with a skeleton so the sidebar's bottom
 * edge does not shift when the query lands. `error` still carries a view (the
 * translated fallback name) so a failed lookup never leaves a hole where the
 * footer was.
 */
export type OrganizationIdentityState =
  | { readonly status: 'pending' }
  | ({ readonly status: 'error' | 'ready' } & IOrganizationIdentityView);
