import { NextResponse } from 'next/server';

import { saveInvoiceClient } from '@/lib/invoices/clients';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name ?? '').trim();
    if (!name) {
      return NextResponse.json(
        { error: 'Client name is required.' },
        { status: 400 }
      );
    }
    const client = await saveInvoiceClient({
      id: String(body.id ?? '').trim() || undefined,
      name,
      billingDetails: String(body.billingDetails ?? ''),
      email: String(body.email ?? ''),
      phone: String(body.phone ?? ''),
      taxId: String(body.taxId ?? ''),
    });
    return NextResponse.json(
      { message: `${client.name} saved to the client database.`, client },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to save the client.',
      },
      { status: 500 }
    );
  }
}

