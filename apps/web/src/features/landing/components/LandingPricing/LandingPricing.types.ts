export interface IPricingPlan {
  name: string;
  /** Headline figure. Currently `Coming soon` for every plan, see the hook for why. */
  price: string;
  /** Qualifier rendered next to the figure, e.g. `/ seat / month`. */
  priceSuffix: string;
  audience: string;
  features: string[];
  ctaLabel: string;
  /**
   * Every plan routes into self-serve signup through TanStack Router. Add a
   * `sales` variant when there is a real address to send people to.
   */
  ctaKind: 'register';
  /** `true` for the highlighted middle plan. */
  featured?: boolean;
  /** Ribbon copy shown above the featured plan. */
  badge?: string;
}

export interface ILandingPricingView {
  plans: IPricingPlan[];
}
