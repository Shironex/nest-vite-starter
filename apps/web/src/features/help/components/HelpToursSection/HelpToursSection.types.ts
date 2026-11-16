export type TourRowStatus = 'completed' | 'dismissed' | 'unseen';

export interface IHelpTourRowView {
  readonly id: string;
  /** The tour's name, as the settings list titles it. */
  readonly name: string;
  /** The route the tour belongs to, shown so a reader knows where it will take them. */
  readonly route: string;
  readonly status: TourRowStatus;
  /** Already translated and already dated. */
  readonly statusLabel: string;
}

export interface IHelpToursSectionView {
  readonly rows: readonly IHelpTourRowView[];
  readonly isLoading: boolean;
  readonly hasLoadError: boolean;
  readonly isResetting: boolean;
  readonly labels: {
    readonly title: string;
    readonly description: string;
    readonly columnTour: string;
    readonly columnScreen: string;
    readonly columnStatus: string;
    readonly replay: string;
    readonly resetAll: string;
    readonly loadError: string;
  };
  readonly onReplay: (tourId: string) => void;
  readonly onResetAll: () => void;
}
