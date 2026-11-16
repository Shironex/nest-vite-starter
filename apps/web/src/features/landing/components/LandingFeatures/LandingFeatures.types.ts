import type { LucideIcon } from 'lucide-react';

/**
 * `tint` and `signature` are the two deliberate anchors in the six-cell grid:
 * the first cell carries a brand wash, the last is the inverted near-black
 * cell. Everything between them is a plain surface card.
 */
export type FeatureCellVariant = 'default' | 'tint' | 'signature';

export interface IFeatureCell {
  icon: LucideIcon;
  title: string;
  description: string;
  variant: FeatureCellVariant;
  /**
   * `true` when the capability is designed but not shipped yet, which renders a
   * "Coming soon" badge on the cell. Marking the gap keeps this page from
   * advertising functionality that does not exist.
   */
  planned?: boolean;
}

export interface ILandingFeaturesView {
  cells: IFeatureCell[];
}
