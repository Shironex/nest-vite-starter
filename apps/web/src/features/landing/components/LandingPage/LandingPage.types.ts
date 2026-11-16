/**
 * The landing page takes no data; the interface exists so the barrel has a
 * types module to re-export, matching the component-folder convention.
 */
export interface ILandingPageProps {
  /** Optional extra classes for the page wrapper. */
  className?: string;
}

export interface ILandingPageView {
  readonly productName: string;
  readonly productMark: string;
  readonly copyright: string;
}
