'use client';

import * as React from 'react';
import { format, addDays, startOfDay, differenceInDays } from 'date-fns';
import { DiamondIcon } from 'lucide-react';

import { cn } from '../lib/utils';

interface IGanttTask {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  progress?: number;
  isMilestone?: boolean;
  category?: string;
}

interface IGanttChartProps {
  tasks: IGanttTask[];
  startDate: Date;
  endDate: Date;
  viewMode?: 'day' | 'week' | 'month';
  taskHeight?: number;
  gridHeight?: number;
  className?: string;
}

function GanttHeader({
  startDate,
  endDate,
  viewMode = 'week',
  cellWidth = 80,
}: {
  startDate: Date;
  endDate: Date;
  viewMode?: 'day' | 'week' | 'month';
  cellWidth?: number;
}) {
  const days: Date[] = [];
  let current = startOfDay(startDate);

  while (current <= endDate) {
    days.push(new Date(current));
    current = addDays(current, 1);
  }

  const getHeaderLabel = (date: Date) => {
    switch (viewMode) {
      case 'day':
        return format(date, 'EEE dd');
      case 'month':
        return format(date, 'MMM');
      default:
        return format(date, 'EEE dd');
    }
  };

  return (
    <div className="sticky top-0 z-20 border-b bg-background">
      <div className="flex h-12 overflow-x-auto">
        <div className="w-48 flex-shrink-0 border-r" />
        <div className="flex">
          {days.map((day, idx) => (
            <div
              key={idx}
              className="flex items-center justify-center border-r border-border bg-muted/30 text-xs font-medium text-muted-foreground"
              style={{ width: `${cellWidth}px`, minWidth: `${cellWidth}px` }}
            >
              {getHeaderLabel(day)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GanttBar({
  task,
  startDate,
  endDate,
  cellWidth: _cellWidth = 80,
}: {
  task: IGanttTask;
  startDate: Date;
  endDate: Date;
  cellWidth?: number;
}) {
  const totalDays = differenceInDays(endDate, startDate) + 1;
  const taskStartDays = Math.max(
    0,
    differenceInDays(startOfDay(task.startDate), startOfDay(startDate)),
  );
  const taskDuration = differenceInDays(task.endDate, task.startDate) + 1;

  const offsetPercent = (taskStartDays / totalDays) * 100;
  const widthPercent = (taskDuration / totalDays) * 100;

  if (task.isMilestone) {
    const milestoneOffset =
      (differenceInDays(startOfDay(task.startDate), startOfDay(startDate)) / totalDays) * 100;

    return (
      <div
        className="absolute top-1/2 -translate-y-1/2 transform"
        style={{ left: `${milestoneOffset}%` }}
      >
        <DiamondIcon className="h-5 w-5 rotate-45 fill-warning text-warning" />
      </div>
    );
  }

  return (
    <div
      className="absolute top-1/2 flex h-6 -translate-y-1/2 transform items-center overflow-hidden rounded border border-primary/50 bg-gradient-to-r from-primary to-primary/80 pl-2 text-xs font-medium text-primary-foreground"
      style={{
        left: `${offsetPercent}%`,
        width: `${widthPercent}%`,
        minWidth: '2rem',
      }}
    >
      <div className="truncate">{task.progress}%</div>
    </div>
  );
}

function GanttRow({
  task,
  startDate,
  endDate,
  cellWidth = 80,
  taskHeight = 40,
}: {
  task: IGanttTask;
  startDate: Date;
  endDate: Date;
  cellWidth?: number;
  taskHeight?: number;
}) {
  const days: Date[] = [];
  let current = startOfDay(startDate);

  while (current <= endDate) {
    days.push(new Date(current));
    current = addDays(current, 1);
  }

  return (
    <div className="flex border-b border-border" style={{ height: `${taskHeight}px` }}>
      <div className="flex w-48 flex-shrink-0 flex-col justify-center border-r border-border bg-muted/20 px-3 py-2">
        <h4 className="truncate text-sm font-medium">{task.title}</h4>
        {task.category && <p className="text-xs text-muted-foreground">{task.category}</p>}
      </div>
      <div className="relative flex-1">
        {days.map((day, idx) => (
          <div
            key={idx}
            className="border-r border-border"
            style={{ width: `${cellWidth}px`, minWidth: `${cellWidth}px` }}
          />
        ))}
        <GanttBar task={task} startDate={startDate} endDate={endDate} cellWidth={cellWidth} />
      </div>
    </div>
  );
}

function GanttMilestone({
  title,
  date,
  startDate,
  endDate,
}: {
  title: string;
  date: Date;
  startDate: Date;
  endDate: Date;
}) {
  const totalDays = differenceInDays(endDate, startDate) + 1;
  const milestoneOffset =
    (differenceInDays(startOfDay(date), startOfDay(startDate)) / totalDays) * 100;

  return (
    <div className="relative flex h-8 items-center" style={{ left: `${milestoneOffset}%` }}>
      <DiamondIcon className="h-4 w-4 rotate-45 fill-warning text-warning" />
      {/* The diamond carries the milestone signal, so it takes the warning tone
          and only has to clear the 3:1 non-text bar. The label is 12px, and
          `text-warning` measures 4.16:1 on the app background in Light, so the
          text takes `text-text-secondary` (7.52:1) rather than the tone. */}
      <span className="ml-1 text-xs font-medium text-text-secondary">{title}</span>
    </div>
  );
}

function GanttChart({
  tasks,
  startDate,
  endDate,
  viewMode = 'week',
  taskHeight = 40,
  gridHeight = 600,
  className,
}: IGanttChartProps) {
  const cellWidth = viewMode === 'day' ? 100 : viewMode === 'week' ? 80 : 120;

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-background', className)}>
      <GanttHeader
        startDate={startDate}
        endDate={endDate}
        viewMode={viewMode}
        cellWidth={cellWidth}
      />
      <div className="overflow-x-auto overflow-y-auto" style={{ height: `${gridHeight}px` }}>
        {tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No tasks to display
          </div>
        ) : (
          tasks.map((task) => (
            <GanttRow
              key={task.id}
              task={task}
              startDate={startDate}
              endDate={endDate}
              cellWidth={cellWidth}
              taskHeight={taskHeight}
            />
          ))
        )}
      </div>
    </div>
  );
}

export { GanttChart, GanttHeader, GanttRow, GanttBar, GanttMilestone, type IGanttTask };
