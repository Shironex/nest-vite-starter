export interface IFaqItem {
  question: string;
  answer: string;
}

export interface ILandingFaqView {
  items: IFaqItem[];
  /** Index of the single expanded item, or `null` when all are collapsed. */
  openIndex: number | null;
  toggleItem: (index: number) => void;
}
