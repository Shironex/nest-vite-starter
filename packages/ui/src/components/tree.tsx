'use client';

import * as React from 'react';
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, FileIcon } from 'lucide-react';

import { Button } from './button';
import { cn } from '../lib/utils';

interface ITreeNode<T = unknown> {
  id: string;
  label: string;
  icon?: React.ReactNode;
  children?: ITreeNode<T>[];
  isFolder?: boolean;
  data?: T;
}

interface ITreeItemProps<T = unknown> {
  node: ITreeNode<T>;
  level?: number;
  onSelect?: (node: ITreeNode<T>) => void;
  onToggle?: (nodeId: string, isOpen: boolean) => void;
  selectedId?: string;
  expandedIds?: Set<string>;
  renderLabel?: (node: ITreeNode<T>) => React.ReactNode;
  className?: string;
}

interface ITreeProps<T = unknown> {
  nodes: ITreeNode<T>[];
  onSelect?: (node: ITreeNode<T>) => void;
  onToggle?: (nodeId: string, isOpen: boolean) => void;
  selectedId?: string;
  initialExpandedIds?: string[];
  renderLabel?: (node: ITreeNode<T>) => React.ReactNode;
  className?: string;
}

function TreeIndicator({ level }: { level: number }) {
  return (
    <>
      {Array.from({ length: level }).map((_, i) => (
        <div key={i} className="relative inline-block h-6 w-4 border-l border-border" />
      ))}
    </>
  );
}

function TreeItem<T = unknown>({
  node,
  level = 0,
  onSelect,
  onToggle,
  selectedId,
  expandedIds = new Set(),
  renderLabel,
  className,
}: ITreeItemProps<T>) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle?.(node.id, !isExpanded);
  };

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(node);
  };

  /*
   * The row is a div rather than a button because it contains one (the
   * expand/collapse control), and nesting interactive elements is invalid HTML
   * that browsers resolve unpredictably. So the row carries the treeitem role
   * and its own keyboard path instead: Enter and Space are what a native button
   * would answer to, and stopPropagation keeps a selection from also toggling
   * the parent row.
   */
  const handleSelectKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // Space scrolls the page on a focusable non-button by default.
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(node);
  };

  const getIcon = () => {
    if (node.icon) return node.icon;
    if (node.isFolder) return <FolderIcon className="h-4 w-4" />;
    return <FileIcon className="h-4 w-4" />;
  };

  return (
    <div className={cn('select-none', className)}>
      <div
        className={cn(
          'flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors',
          'hover:bg-accent/50',
          isSelected && 'border-l-2 border-primary bg-primary/10',
        )}
        onClick={handleSelect}
        onKeyDown={handleSelectKey}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        {...(hasChildren ? { 'aria-expanded': isExpanded } : {})}
        style={{ marginLeft: `${level * 20}px` }}
      >
        {hasChildren && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="h-5 w-5 p-0"
            onClick={handleToggle}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.label}`}
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <ChevronDownIcon className="h-4 w-4" />
            ) : (
              <ChevronRightIcon className="h-4 w-4" />
            )}
          </Button>
        )}
        {!hasChildren && <div className="w-5" />}

        <div className="flex-shrink-0 text-muted-foreground">{getIcon()}</div>

        <span className="flex-1 truncate text-sm font-medium">
          {renderLabel ? renderLabel(node) : node.label}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-0">
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              level={level + 1}
              {...(onSelect ? { onSelect } : {})}
              {...(onToggle ? { onToggle } : {})}
              {...(selectedId ? { selectedId } : {})}
              expandedIds={expandedIds}
              {...(renderLabel ? { renderLabel } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Tree<T = unknown>({
  nodes,
  onSelect,
  onToggle,
  selectedId,
  initialExpandedIds = [],
  renderLabel,
  className,
}: ITreeProps<T>) {
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set(initialExpandedIds));

  const handleToggle = (nodeId: string, isOpen: boolean) => {
    const newExpandedIds = new Set(expandedIds);
    if (isOpen) {
      newExpandedIds.add(nodeId);
    } else {
      newExpandedIds.delete(nodeId);
    }
    setExpandedIds(newExpandedIds);
    onToggle?.(nodeId, isOpen);
  };

  return (
    /*
     * `role="tree"` is what makes the `treeitem` rows below mean anything: an
     * orphaned treeitem with no tree ancestor is dropped by assistive tech, so
     * the two roles have to be added together or not at all.
     */
    <div role="tree" className={cn('space-y-1', className)}>
      {nodes.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No items</div>
      ) : (
        nodes.map((node) => (
          <TreeItem
            key={node.id}
            node={node}
            level={0}
            {...(onSelect ? { onSelect } : {})}
            onToggle={handleToggle}
            {...(selectedId ? { selectedId } : {})}
            expandedIds={expandedIds}
            {...(renderLabel ? { renderLabel } : {})}
          />
        ))
      )}
    </div>
  );
}

export { Tree, TreeItem, TreeIndicator, type ITreeNode, type ITreeProps, type ITreeItemProps };
