import { NextResponse } from 'next/server';

import {
  CREDIT_EVENT_TYPES,
  type CreditEventType,
} from '@/lib/client-manager/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface CreateCreditEventPayload {
  clientId?: string;
  eventType?: CreditEventType;
  eventDate?: string | null;
  analysesCount?: number | string | null;
  equipment?: string | null;
  unitCost?: number | string | null;
  amount?: number | string | null;
  balanceAfter?: number | string | null;
  comment?: string | null;
}

interface UpdateCreditEventPayload extends Omit<CreateCreditEventPayload, 'clientId'> {
  eventId?: string;
}

interface DeleteCreditEventPayload {
  eventId?: string;
}

interface LedgerBalanceEvent {
  id: string;
  source_type: 'spreadsheet' | 'manual';
  amount: number | string | null;
  balance_before: number | string | null;
  balance_after: number | string | null;
}

const CREDIT_EVENT_SELECT =
  'id, client_id, source_type, source_document_id, source_relative_path, source_sheet, source_row, event_type, event_date, analyses_count, equipment, unit_cost, amount, balance_before, balance_after, comment, created_at, updated_at';

function hasMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const normalized = error as { code?: string; message?: string };
  if (normalized.code === '42P01') {
    return true;
  }

  const message = normalized.message?.toLowerCase() ?? '';
  return message.includes('does not exist');
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseNullableDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString().slice(0, 10);
}

function getReadableError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Unknown error';
  }
  const maybeError = error as { message?: string };
  return maybeError.message ?? 'Unknown error';
}

function normalizeEventType(value: unknown): CreditEventType {
  return CREDIT_EVENT_TYPES.includes(value as CreditEventType)
    ? (value as CreditEventType)
    : 'adjustment';
}

function deriveEventAmount(
  eventType: CreditEventType,
  analysesCount: number | null,
  unitCost: number | null,
  amountOverride: number | null
): number | null {
  if (amountOverride !== null) return amountOverride;
  if (analysesCount === null || unitCost === null) return null;

  const total = Math.abs(analysesCount * unitCost);
  if (eventType === 'analysis') return -total;
  if (eventType === 'credit_topup') return total;
  return analysesCount * unitCost;
}

async function rebalanceClientCreditEvents(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  clientId: string
): Promise<string | null> {
  const creditEventsTable = supabase.from('client_credit_events') as any;
  const { data, error } = await creditEventsTable
    .select(
      'id, source_type, amount, balance_before, balance_after, event_date, created_at'
    )
    .eq('client_id', clientId)
    .order('event_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) return error.message;

  let runningBalance: number | null = null;
  const updates: Array<{ id: string; balanceBefore: number; balanceAfter: number }> = [];

  for (const event of (data ?? []) as LedgerBalanceEvent[]) {
    const amount = parseNullableNumber(event.amount) ?? 0;
    const balanceBefore = parseNullableNumber(event.balance_before);
    const balanceAfter = parseNullableNumber(event.balance_after);

    if (event.source_type === 'spreadsheet') {
      if (balanceAfter !== null) {
        runningBalance = balanceAfter;
      } else if (balanceBefore !== null) {
        runningBalance = balanceBefore + amount;
      }
      continue;
    }

    const nextBalanceBefore = runningBalance ?? 0;
    const nextBalanceAfter = nextBalanceBefore + amount;
    if (
      balanceBefore !== nextBalanceBefore ||
      balanceAfter !== nextBalanceAfter
    ) {
      updates.push({
        id: event.id,
        balanceBefore: nextBalanceBefore,
        balanceAfter: nextBalanceAfter,
      });
    }
    runningBalance = nextBalanceAfter;
  }

  for (const update of updates) {
    const { error: updateError } = await creditEventsTable
      .update({
        balance_before: update.balanceBefore,
        balance_after: update.balanceAfter,
      })
      .eq('id', update.id);
    if (updateError) return updateError.message;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | CreateCreditEventPayload
      | null;

    const clientId = body?.clientId?.trim();
    const eventType = normalizeEventType(body?.eventType);

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required.' }, { status: 400 });
    }

    const analysesCount = parseNullableNumber(body?.analysesCount);
    const equipment =
      typeof body?.equipment === 'string' && body.equipment.trim()
        ? body.equipment.trim()
        : null;
    const unitCost = parseNullableNumber(body?.unitCost);
    const rawAmount = parseNullableNumber(body?.amount);
    const amount = deriveEventAmount(
      eventType,
      analysesCount,
      unitCost,
      rawAmount
    );
    const eventDate = parseNullableDate(body?.eventDate);
    const comment =
      typeof body?.comment === 'string' && body.comment.trim()
        ? body.comment.trim()
        : null;

    const supabase = getSupabaseAdminClient();
    const creditEventsTable = supabase.from('client_credit_events') as any;
    const { data: insertedEvent, error: insertError } = await creditEventsTable
      .insert({
        client_id: clientId,
        source_type: 'manual',
        source_document_id: null,
        source_relative_path: null,
        source_sheet: '',
        source_row: null,
        event_type: eventType,
        event_date: eventDate,
        analyses_count: analysesCount,
        equipment,
        unit_cost: unitCost,
        amount,
        balance_before: null,
        balance_after: null,
        comment,
      })
      .select(CREDIT_EVENT_SELECT)
      .single();

    if (insertError) {
      if (hasMissingTableError(insertError)) {
        return NextResponse.json(
          {
            error:
              'Supabase credit event tables are missing. Apply supabase/migrations/20260308_client_manager.sql first.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: `Unable to create credit event: ${insertError.message}` },
        { status: 500 }
      );
    }

    const balanceError = await rebalanceClientCreditEvents(supabase, clientId);
    if (balanceError) {
      return NextResponse.json(
        { error: `Credit event was created, but its balance could not be updated: ${balanceError}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Credit event created.',
      event: insertedEvent,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Unexpected create credit event error: ${getReadableError(error)}` },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | UpdateCreditEventPayload
      | null;
    const eventId = body?.eventId?.trim();
    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required.' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    const hasEventType = Object.prototype.hasOwnProperty.call(body, 'eventType');
    const hasEventDate = Object.prototype.hasOwnProperty.call(body, 'eventDate');
    const hasAnalysesCount = Object.prototype.hasOwnProperty.call(body, 'analysesCount');
    const hasEquipment = Object.prototype.hasOwnProperty.call(body, 'equipment');
    const hasUnitCost = Object.prototype.hasOwnProperty.call(body, 'unitCost');
    const hasAmount = Object.prototype.hasOwnProperty.call(body, 'amount');
    const hasBalanceAfter = Object.prototype.hasOwnProperty.call(body, 'balanceAfter');
    const hasComment = Object.prototype.hasOwnProperty.call(body, 'comment');

    if (
      !hasEventType &&
      !hasEventDate &&
      !hasAnalysesCount &&
      !hasEquipment &&
      !hasUnitCost &&
      !hasAmount &&
      !hasBalanceAfter &&
      !hasComment
    ) {
      return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const creditEventsTable = supabase.from('client_credit_events') as any;
    const { data: existingEvent, error: existingEventError } =
      await creditEventsTable
        .select('client_id, event_type')
        .eq('id', eventId)
        .maybeSingle();

    if (existingEventError) {
      return NextResponse.json(
        { error: `Unable to load credit event: ${existingEventError.message}` },
        { status: 500 }
      );
    }
    if (!existingEvent) {
      return NextResponse.json({ error: 'Credit event not found.' }, { status: 404 });
    }

    const eventType = hasEventType
      ? normalizeEventType(body?.eventType)
      : normalizeEventType(existingEvent.event_type);
    if (hasEventType) {
      updates.event_type = eventType;
    }

    let parsedAnalysesCount: number | null = null;
    let parsedUnitCost: number | null = null;

    if (hasEventDate) {
      updates.event_date = parseNullableDate(body?.eventDate);
    }
    if (hasAnalysesCount) {
      parsedAnalysesCount = parseNullableNumber(body?.analysesCount);
      updates.analyses_count = parsedAnalysesCount;
    }
    if (hasEquipment) {
      updates.equipment =
        typeof body?.equipment === 'string' && body.equipment.trim()
          ? body.equipment.trim()
          : null;
    }
    if (hasUnitCost) {
      parsedUnitCost = parseNullableNumber(body?.unitCost);
      updates.unit_cost = parsedUnitCost;
    }
    if (hasBalanceAfter) {
      updates.balance_after = parseNullableNumber(body?.balanceAfter);
    }
    if (hasComment) {
      updates.comment =
        typeof body?.comment === 'string' && body.comment.trim()
          ? body.comment.trim()
          : null;
    }

    const parsedAmount = hasAmount ? parseNullableNumber(body?.amount) : null;
    if (hasAmount || (hasAnalysesCount && hasUnitCost)) {
      updates.amount = deriveEventAmount(
        eventType,
        parsedAnalysesCount,
        parsedUnitCost,
        parsedAmount
      );
    }

    const { data: updatedEvent, error: updateError } = await creditEventsTable
      .update(updates)
      .eq('id', eventId)
      .select(CREDIT_EVENT_SELECT)
      .single();

    if (updateError) {
      if (hasMissingTableError(updateError)) {
        return NextResponse.json(
          {
            error:
              'Supabase credit event tables are missing. Apply supabase/migrations/20260308_client_manager.sql first.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: `Unable to update credit event: ${updateError.message}` },
        { status: 500 }
      );
    }

    const balanceError = await rebalanceClientCreditEvents(
      supabase,
      updatedEvent.client_id
    );
    if (balanceError) {
      return NextResponse.json(
        { error: `Credit event was updated, but its balance could not be refreshed: ${balanceError}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Credit event updated.',
      event: updatedEvent,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Unexpected update credit event error: ${getReadableError(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | DeleteCreditEventPayload
      | null;
    const eventId = body?.eventId?.trim();
    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required.' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const creditEventsTable = supabase.from('client_credit_events') as any;
    const { data: existingEvent, error: existingEventError } =
      await creditEventsTable
        .select('client_id')
        .eq('id', eventId)
        .maybeSingle();

    if (existingEventError) {
      return NextResponse.json(
        { error: `Unable to load credit event: ${existingEventError.message}` },
        { status: 500 }
      );
    }
    if (!existingEvent) {
      return NextResponse.json({ error: 'Credit event not found.' }, { status: 404 });
    }
    const { error: deleteError } = await creditEventsTable.delete().eq('id', eventId);

    if (deleteError) {
      if (hasMissingTableError(deleteError)) {
        return NextResponse.json(
          {
            error:
              'Supabase credit event tables are missing. Apply supabase/migrations/20260308_client_manager.sql first.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: `Unable to delete credit event: ${deleteError.message}` },
        { status: 500 }
      );
    }

    const balanceError = await rebalanceClientCreditEvents(
      supabase,
      existingEvent.client_id
    );
    if (balanceError) {
      return NextResponse.json(
        { error: `Credit event was deleted, but its balance could not be refreshed: ${balanceError}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Credit event deleted.',
      eventId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Unexpected delete credit event error: ${getReadableError(error)}` },
      { status: 500 }
    );
  }
}
