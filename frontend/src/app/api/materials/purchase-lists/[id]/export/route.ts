import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

type RouteContext = { params: { id: string } };

interface ExportItem {
  material_name_snapshot: string;
  part_number_snapshot: string | null;
  material_type_snapshot: string | null;
  quantity: number;
  unit_snapshot: string | null;
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request, { params }: RouteContext) {
  const database = getSupabaseAdminClient();
  const { data: list, error: listError } = await database
    .from('material_purchase_lists')
    .select('id, name, provider_name, provider_contact, status, created_at')
    .eq('id', params.id)
    .single();
  if (listError || !list) {
    return NextResponse.json({ error: 'Purchase list not found.' }, { status: 404 });
  }

  const { data: itemData, error: itemsError } = await database
    .from('material_purchase_list_items')
    .select(
      'material_name_snapshot, part_number_snapshot, material_type_snapshot, quantity, unit_snapshot'
    )
    .eq('purchase_list_id', params.id)
    .order('created_at', { ascending: true });
  if (itemsError) {
    return NextResponse.json(
      { error: `Unable to export items: ${itemsError.message}` },
      { status: 500 }
    );
  }

  const items = (itemData ?? []) as ExportItem[];
  const rows = items.map((item) => ({
    Material: item.material_name_snapshot,
    'Part number': item.part_number_snapshot ?? '',
    Category: item.material_type_snapshot ?? '',
    Quantity: item.quantity,
    Unit: item.unit_snapshot ?? '',
  }));
  const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const baseName = safeFileName(String(list.name ?? 'purchase-list'));

  if (format === 'csv') {
    const headers = ['Material', 'Part number', 'Category', 'Quantity', 'Unit'];
    const lines = [
      headers.map(csvCell).join(','),
      ...rows.map((row) =>
        headers.map((header) => csvCell(row[header as keyof typeof row])).join(',')
      ),
    ];
    return new Response(`\uFEFF${lines.join('\r\n')}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}.csv"`,
      },
    });
  }

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 42 },
    { wch: 20 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Purchase request');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return new Response(bytes, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${baseName}.xlsx"`,
    },
  });
}
