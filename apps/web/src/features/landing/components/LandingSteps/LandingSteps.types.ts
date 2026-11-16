export interface ILandingStep {
  /** Zero-padded ordinal shown as the oversized numeral. */
  number: string;
  title: string;
  description: string;
}

export interface ILandingStepsView {
  steps: ILandingStep[];
}
