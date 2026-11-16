import type { ReactNode } from 'react';

/** How the form column's header block is aligned against the 400px form. */
export type AuthLayoutAlign = 'start' | 'center';

export interface IAuthLayoutProps {
  readonly title?: string;
  /**
   * ReactNode rather than string: the screens put a link in this line
   * ("No account yet? Register an organization"), so plain text is not enough.
   */
  readonly description?: ReactNode;
  /**
   * Optional 48px badge above the title, used by the code-entry screens.
   * Pass the icon itself; the badge chrome comes from the layout.
   */
  readonly icon?: ReactNode;
  readonly align?: AuthLayoutAlign;
  readonly children: ReactNode;
}

export interface IAuthLayoutView {
  readonly hasHeader: boolean;
  readonly headerClass: string;
  readonly badgeClass: string;
}
