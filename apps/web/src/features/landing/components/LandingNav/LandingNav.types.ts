export interface ILandingNavLink {
  /** In-page anchor, e.g. `#cennik`. */
  href: string;
  label: string;
}

export interface ILandingNavView {
  links: ILandingNavLink[];
  isMenuOpen: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
}
