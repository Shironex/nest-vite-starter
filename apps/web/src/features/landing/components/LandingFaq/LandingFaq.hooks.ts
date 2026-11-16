import { useCallback, useState } from 'react';
import type { IFaqItem, ILandingFaqView } from './LandingFaq.types';

/**
 * Answers describe only what the starter ships; anything on the roadmap is
 * worded as planned. Replace them with your product's own questions.
 */
const ITEMS: IFaqItem[] = [
  {
    question: 'What is included out of the box?',
    answer:
      'Accounts with email verification, two-factor authentication, organizations with role-based access and an audit log.',
  },
  {
    question: 'Can I import data from another tool?',
    answer:
      'Not yet. Data is added in the app today, and file import is planned. If you are moving a larger team, get in touch and we will work out the details.',
  },
  {
    question: 'Can one account work across several organizations?',
    answer:
      'Yes. You switch between the organizations you belong to, and permissions are set separately for each one.',
  },
  {
    question: 'How is my data kept apart from other customers?',
    answer:
      'Every record belongs to one organization, and the data layer scopes every query to it, so one customer cannot read the records of another.',
  },
];

export function useLandingFaq(): ILandingFaqView {
  // The first question starts expanded on load.
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleItem = useCallback((index: number) => {
    setOpenIndex((current) => (current === index ? null : index));
  }, []);

  return { items: ITEMS, openIndex, toggleItem };
}
