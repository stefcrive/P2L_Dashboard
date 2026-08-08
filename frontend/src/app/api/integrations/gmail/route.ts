import { NextResponse } from 'next/server';

import {
  disconnectGmail,
  getGmailConnectionStatus,
} from '@/lib/gmail/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ data: await getGmailConnectionStatus() });
  } catch {
    return NextResponse.json(
      { error: 'The Gmail connection status could not be loaded.' },
      { status: 503 }
    );
  }
}

export async function DELETE() {
  try {
    await disconnectGmail();
    return NextResponse.json({ message: 'Gmail account disconnected.' });
  } catch {
    return NextResponse.json(
      { error: 'The Gmail account could not be disconnected.' },
      { status: 503 }
    );
  }
}
