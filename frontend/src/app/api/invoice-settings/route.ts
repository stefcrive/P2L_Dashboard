import { NextResponse } from 'next/server';

import {
  fallbackInvoiceSettings,
  type InvoiceSettings,
} from '@/lib/invoices/settings';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const writableFields = [
  'issuer_details',
  'national_payment_details',
  'international_payment_details',
  'default_payment_instructions',
  'default_currency',
  'default_language',
  'footer_note',
] as const;

export async function GET() {
  try {
    const database = getSupabaseAdminClient();
    const { data, error } = await database
      .from('invoice_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      data: data ?? fallbackInvoiceSettings,
      source: getApplicationDatabaseSource(),
    });
  } catch {
    return NextResponse.json(
      { error: 'Invoice settings could not be loaded.' },
      { status: 503 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const input = (await request.json()) as Partial<InvoiceSettings>;
    const payload = Object.fromEntries(
      writableFields.map((field) => [field, String(input[field] ?? '').trim()])
    ) as Record<(typeof writableFields)[number], string>;

    payload.default_currency = payload.default_currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(payload.default_currency)) {
      return NextResponse.json(
        { error: 'Default currency must use a three-letter code.' },
        { status: 400 }
      );
    }
    if (!['en', 'pt'].includes(payload.default_language)) {
      return NextResponse.json(
        { error: 'Choose a supported invoice language.' },
        { status: 400 }
      );
    }
    if (
      !['national', 'international', 'both'].includes(
        payload.default_payment_instructions
      )
    ) {
      return NextResponse.json(
        { error: 'Choose valid default payment instructions.' },
        { status: 400 }
      );
    }
    if (!payload.issuer_details) {
      return NextResponse.json(
        { error: 'Issuer details are required.' },
        { status: 400 }
      );
    }

    const database = getSupabaseAdminClient();
    const { data, error } = await database
      .from('invoice_settings')
      .upsert({ id: 'default', ...payload }, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ data, message: 'Invoice settings saved.' });
  } catch {
    return NextResponse.json(
      { error: 'Invoice settings could not be saved.' },
      { status: 503 }
    );
  }
}
