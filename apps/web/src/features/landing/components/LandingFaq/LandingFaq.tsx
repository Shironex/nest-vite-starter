import { ChevronDown } from 'lucide-react';
import { Container } from '@repo/ui/container';
import { sectionOverline } from '../../landing.styles';
import { useLandingFaq } from './LandingFaq.hooks';
import type { IFaqItem } from './LandingFaq.types';

interface IFaqRowProps {
  item: IFaqItem;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}

function FaqRow({ item, index, isOpen, onToggle }: IFaqRowProps) {
  const buttonId = `faq-question-${index}`;
  const panelId = `faq-answer-${index}`;
  // Collapsed panels stay in the DOM so `aria-controls` always resolves.
  const isPanelHidden = !isOpen;
  const chevronClassName = isOpen
    ? 'size-3.5 shrink-0 rotate-180 text-text-tertiary motion-safe:transition-transform'
    : 'size-3.5 shrink-0 text-text-tertiary motion-safe:transition-transform';

  return (
    <li className="rounded-xl border border-border bg-surface">
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center gap-4 rounded-xl px-4 py-4 text-left type-heading-h3 text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span className="flex-1">{item.question}</span>
          <ChevronDown aria-hidden="true" className={chevronClassName} />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={isPanelHidden}
        className="px-4 pb-4"
      >
        <p className="type-body-small text-text-muted">{item.answer}</p>
      </div>
    </li>
  );
}

export default function LandingFaq() {
  const { items, openIndex, toggleItem } = useLandingFaq();

  const rows = items.map((item, index) => (
    <FaqRow
      key={item.question}
      item={item}
      index={index}
      isOpen={openIndex === index}
      onToggle={() => toggleItem(index)}
    />
  ));

  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="scroll-mt-16 border-b border-border bg-surface"
    >
      <Container>
        <div className="mx-auto max-w-2xl py-20">
          <div className="text-center">
            <p className={sectionOverline}>FAQ</p>
            <h2 id="faq-heading" className="mt-3 type-display-large text-text">
              Frequently asked questions
            </h2>
          </div>

          <ul className="mt-10 flex flex-col gap-2.5">{rows}</ul>
        </div>
      </Container>
    </section>
  );
}
