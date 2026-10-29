import {
  addQueueWorkingDays,
  countQueueWorkingDays,
  nextQueueWorkingDay,
  queueDateAtNineUtc,
} from './calendar';

type Run = {
  id: string;
  queue_item_id: string;
  run_position: number;
  segment_order: number;
  start_at: string;
  end_at: string;
};

type Item = {
  id: string;
  status: string;
  segments: Run[];
};

export type RunDateChange = { id: string; start: Date; end: Date };

export function queueRunDateBlockReason(
  status: string,
  start: Date,
  end: Date,
  mode: 'move' | 'resize-start' | 'resize-end',
  today: Date
) {
  if (status === 'completed')
    return 'Completed queue runs cannot be changed on the calendar.';
  if (status === 'analysing' && start <= today) {
    if (end < today || mode !== 'resize-end') {
      return 'A queue run that has started can only resize its end date.';
    }
  }
  return null;
}

// Calculate every affected date before writing any changes. A queued run is still
// movable when its planned start has passed; only actual work locks its dates.
export function planQueueDateChanges(
  items: Item[],
  changes: RunDateChange[],
  now = new Date()
) {
  const today = queueDateAtNineUtc(now);
  const changesById = new Map(changes.map((change) => [change.id, change]));
  const runway = items
    .filter((item) => item.status === 'queued' || item.status === 'analysing')
    .flatMap((item) =>
      item.segments.map((run) => ({ run, status: item.status }))
    )
    .sort(
      (a, b) =>
        a.run.run_position - b.run.run_position ||
        a.run.segment_order - b.run.segment_order
    );
  if (
    changes.some((change) => !runway.some(({ run }) => run.id === change.id))
  ) {
    throw new Error(
      'Completed or removed queue runs cannot be rescheduled. Refresh and try again.'
    );
  }

  const planned: Array<RunDateChange & { itemId: string }> = [];
  let cursor: Date | null = null;
  let affected = false;
  for (const { run, status } of runway) {
    const originalStart = queueDateAtNineUtc(new Date(run.start_at));
    const originalEnd = queueDateAtNineUtc(new Date(run.end_at));
    const change = changesById.get(run.id);
    let start = originalStart;
    let end = originalEnd;
    if (change) {
      affected = true;
      start = queueDateAtNineUtc(change.start);
      end = queueDateAtNineUtc(change.end);
      const mode =
        start.getTime() === originalStart.getTime() ? 'resize-end' : 'move';
      const blocked = queueRunDateBlockReason(
        status,
        originalStart,
        originalEnd,
        mode,
        today
      );
      if (blocked) throw new Error(blocked);
      if (status === 'analysing' && originalStart <= today && end < today) {
        throw new Error('An active queue run cannot end before today.');
      }
      if (cursor && start < cursor) {
        throw new Error(
          'The edited run overlaps preceding queue work. Choose a later start date.'
        );
      }
    } else if (affected && cursor) {
      if (status === 'analysing' && originalStart <= today) {
        if (start < cursor)
          throw new Error(
            'The new dates overlap a run that has already started.'
          );
      } else {
        start = cursor;
        end = addQueueWorkingDays(
          start,
          Math.max(1, countQueueWorkingDays(originalStart, originalEnd)) - 1
        );
      }
    }
    if (
      change ||
      start.getTime() !== originalStart.getTime() ||
      end.getTime() !== originalEnd.getTime()
    ) {
      planned.push({ id: run.id, itemId: run.queue_item_id, start, end });
    }
    const afterRun = nextQueueWorkingDay(end);
    if (!cursor || afterRun > cursor) cursor = afterRun;
  }
  return planned;
}
