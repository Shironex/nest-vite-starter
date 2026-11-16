'use client';

import * as React from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { GripVerticalIcon, PlusIcon } from 'lucide-react';

import { Button } from './button';
import { Card } from './card';
import { cn } from '../lib/utils';

interface IKanbanCard {
  id: string;
  title: string;
  description?: string;
  columnId: string;
  [key: string]: unknown;
}

interface IKanbanColumn {
  id: string;
  title: string;
  cards: IKanbanCard[];
}

interface IKanbanBoardProps {
  columns: IKanbanColumn[];
  onCardMove?: (cardId: string, fromColumnId: string, toColumnId: string) => void;
  onCardAdd?: (columnId: string) => void;
  renderCard?: (card: IKanbanCard) => React.ReactNode;
  className?: string;
}

function KanbanColumnHeader({
  column,
  cardCount,
  onAddCard,
}: {
  column: IKanbanColumn;
  cardCount: number;
  onAddCard?: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h3 className="font-semibold">{column.title}</h3>
        <p className="text-xs text-muted-foreground">{cardCount} cards</p>
      </div>
      {onAddCard && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onAddCard}
          title="Add card"
          aria-label="Add card"
        >
          <PlusIcon className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

const DraggableKanbanCard = React.forwardRef<
  HTMLDivElement,
  {
    card: IKanbanCard;
    isOverlay?: boolean;
    children?: React.ReactNode;
    className?: string;
  }
>(({ card, isOverlay, children, className }, _ref) => {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('cursor-grab active:cursor-grabbing', className, {
        'opacity-50': isDragging,
      })}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
    >
      {children}
    </div>
  );
});
DraggableKanbanCard.displayName = 'DraggableKanbanCard';

function KanbanCard({ card, className }: { card: IKanbanCard; className?: string }) {
  return (
    <DraggableKanbanCard card={card}>
      <Card
        className={cn(
          'mb-3 cursor-grab p-3 transition-shadow hover:shadow-md active:cursor-grabbing',
          className,
        )}
      >
        <div className="flex gap-2">
          <GripVerticalIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium break-words">{card.title}</h4>
            {card.description && (
              <p className="mt-1 text-xs break-words text-muted-foreground">{card.description}</p>
            )}
          </div>
        </div>
      </Card>
    </DraggableKanbanCard>
  );
}

function KanbanColumn({
  column,
  cards,
  onAddCard,
  renderCard,
  minHeight = 500,
}: {
  column: IKanbanColumn;
  cards: IKanbanCard[];
  onAddCard?: () => void;
  renderCard?: (card: IKanbanCard) => React.ReactNode;
  minHeight?: number;
}) {
  const cardIds = React.useMemo(() => cards.map((c) => c.id), [cards]);

  return (
    <div className="flex max-w-md min-w-[350px] flex-1 flex-col">
      <KanbanColumnHeader
        column={column}
        cardCount={cards.length}
        {...(onAddCard ? { onAddCard } : {})}
      />
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div
          className="flex-1 space-y-3 overflow-y-auto rounded-lg bg-muted/30 p-3"
          style={{ minHeight: `${minHeight}px` }}
        >
          {cards.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No cards yet
            </div>
          ) : (
            cards.map((card) =>
              renderCard ? (
                <div key={card.id}>{renderCard(card)}</div>
              ) : (
                <KanbanCard key={card.id} card={card} />
              ),
            )
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function KanbanBoard({ columns, onCardMove, onCardAdd, renderCard, className }: IKanbanBoardProps) {
  const [localColumns, setLocalColumns] = React.useState(columns);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  // Resync local board state when the parent-controlled `columns` prop changes.
  // Using the "store previous prop and adjust state during render" pattern from
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // avoids a setState-in-useEffect cascade that the v7 react-hooks rules flag.
  const [prevColumns, setPrevColumns] = React.useState(columns);
  if (columns !== prevColumns) {
    setPrevColumns(columns);
    setLocalColumns(columns);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (!over) return;

    const activeCard = findCard(String(active.id));
    const overCard = findCard(String(over.id));

    if (!activeCard || !overCard) return;

    if (activeCard.columnId === overCard.columnId) {
      // Reorder within same column
      handleReorderWithinColumn(activeCard.columnId, String(active.id), String(over.id));
    } else {
      // Move between columns
      handleMoveCard(activeCard.id, activeCard.columnId, overCard.columnId);
    }
  };

  const findCard = (cardId: string): IKanbanCard | undefined => {
    for (const column of localColumns) {
      const card = column.cards.find((c) => c.id === cardId);
      if (card) return card;
    }
    return undefined;
  };

  const handleReorderWithinColumn = (columnId: string, activeId: string, overId: string) => {
    setLocalColumns((prevColumns) =>
      prevColumns.map((col) => {
        if (col.id === columnId) {
          const activeIndex = col.cards.findIndex((c) => c.id === activeId);
          const overIndex = col.cards.findIndex((c) => c.id === overId);
          return {
            ...col,
            cards: arrayMove(col.cards, activeIndex, overIndex),
          };
        }
        return col;
      }),
    );
  };

  const handleMoveCard = (cardId: string, fromColumnId: string, toColumnId: string) => {
    const card = findCard(cardId);
    if (!card) return;

    setLocalColumns((prevColumns) =>
      prevColumns.map((col) => {
        if (col.id === fromColumnId) {
          return {
            ...col,
            cards: col.cards.filter((c) => c.id !== cardId),
          };
        }
        if (col.id === toColumnId) {
          return {
            ...col,
            cards: [...col.cards, { ...card, columnId: toColumnId }],
          };
        }
        return col;
      }),
    );

    onCardMove?.(cardId, fromColumnId, toColumnId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={cn('flex w-full gap-6 overflow-x-auto pb-4', className)}>
        {localColumns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            cards={column.cards}
            {...(onCardAdd ? { onAddCard: () => onCardAdd(column.id) } : {})}
            {...(renderCard ? { renderCard } : {})}
          />
        ))}
      </div>
      <DragOverlay>
        {activeId ? (
          <div className="opacity-50">
            {(() => {
              const card = findCard(activeId);
              return card ? <KanbanCard card={card} /> : null;
            })()}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export type { IKanbanCard as KanbanCardType, IKanbanColumn as KanbanColumnType };

export { KanbanBoard, KanbanCard, KanbanColumn, KanbanColumnHeader };
