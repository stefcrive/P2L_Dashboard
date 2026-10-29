import { NextResponse } from 'next/server';

import { planActiveQueue } from '@/lib/queue/service';

export async function POST() {
  try {
    return NextResponse.json({
      data: await planActiveQueue(),
      message: 'Active queue planned on the calendar.',
    });
  } catch (error) {
    console.error('Failed to plan the active queue:', error);
    return NextResponse.json(
      { error: 'The active queue could not be planned on the calendar.' },
      { status: 503 }
    );
  }
}
