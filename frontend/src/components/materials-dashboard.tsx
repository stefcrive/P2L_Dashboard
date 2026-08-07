'use client';

import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FileSpreadsheet,
  GripVertical,
  Pencil,
  Plus,
  Save,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';

import {
  MetricRail,
  MetricTile,
  PageHeader,
  StatusPill,
  Toolbar,
} from '@/components/dashboard/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  MATERIAL_TYPES,
  type MaterialInventoryRow,
  type MaterialPurchaseListWithItems,
  type MaterialType,
  type MaterialsCatalogDataResponse,
} from '@/lib/materials/types';
import { cn } from '@/lib/utils';

interface FiltersState {
  search: string;
  type: 'all' | MaterialType;
  equipment: string;
  lowStockOnly: boolean;
}

interface DraftItem {
  material: MaterialInventoryRow;
  quantity: number;
}

interface MaterialFormState {
  name: string;
  partNumber: string;
  description: string;
  materialType: MaterialType;
  equipment: string;
  availabilityStatus: MaterialInventoryRow['availability_status'];
  currentStock: string;
  minimumStock: string;
  suggestedStock: string;
  unit: string;
  unitCost: string;
  currency: string;
  providerId: string;
  storageLocation: string;
  notes: string;
}

interface PurchaseListFormState {
  name: string;
  providerName: string;
  status: string;
}

const purchaseListStatuses = ['draft', 'ordered', 'received', 'cancelled'];

const materialTypeLabel: Record<MaterialType, string> = {
  equipment: 'Equipment',
  consumable: 'Consumable',
  spare_part: 'Spare part',
  other: 'Other',
};

const availabilityLabel: Record<
  MaterialInventoryRow['availability_status'],
  string
> = {
  available: 'Available',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  on_order: 'On order',
  unavailable: 'Unavailable',
};

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function inferredMinimumStock(material: MaterialInventoryRow): number {
  if (material.minimum_stock !== null) return material.minimum_stock;
  if (material.suggested_stock !== null) {
    return Math.max(1, Math.ceil(material.suggested_stock * 0.2));
  }
  return material.material_type === 'consumable' ? 1 : 0;
}

function isLowStock(material: MaterialInventoryRow): boolean {
  return (
    material.current_stock !== null &&
    material.current_stock <= inferredMinimumStock(material)
  );
}

function stockProgress(material: MaterialInventoryRow): {
  percentage: number;
  tone: string;
} {
  const current = Math.max(0, material.current_stock ?? 0);
  const minimum = inferredMinimumStock(material);
  const target = Math.max(material.suggested_stock ?? 0, minimum * 2, current, 1);
  const percentage = Math.min(100, Math.round((current / target) * 100));
  const tone =
    current <= 0
      ? 'bg-rose-500'
      : current <= minimum
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  return { percentage, tone };
}

function materialToForm(material: MaterialInventoryRow): MaterialFormState {
  return {
    name: material.name,
    partNumber: material.part_number ?? '',
    description: material.description ?? '',
    materialType: material.material_type,
    equipment: material.equipment ?? '',
    availabilityStatus: material.availability_status,
    currentStock: material.current_stock === null ? '' : String(material.current_stock),
    minimumStock: material.minimum_stock === null ? '' : String(material.minimum_stock),
    suggestedStock:
      material.suggested_stock === null ? '' : String(material.suggested_stock),
    unit: material.unit ?? '',
    unitCost: material.unit_cost === null ? '' : String(material.unit_cost),
    currency: material.currency || 'BRL',
    providerId: material.provider_id ?? '',
    storageLocation: material.storage_location ?? '',
    notes: material.notes ?? '',
  };
}

function purchaseListToForm(
  purchaseList: MaterialPurchaseListWithItems
): PurchaseListFormState {
  return {
    name: purchaseList.name,
    providerName: purchaseList.provider_name ?? '',
    status: purchaseList.status,
  };
}

async function fetchMaterialsData(
  filters: FiltersState
): Promise<MaterialsCatalogDataResponse> {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('q', filters.search.trim());
  if (filters.type !== 'all') params.set('type', filters.type);
  if (filters.equipment !== 'all') params.set('equipment', filters.equipment);
  if (filters.lowStockOnly) params.set('lowStockOnly', '1');
  const response = await fetch(
    params.size ? `/api/materials/data?${params.toString()}` : '/api/materials/data',
    { cache: 'no-store' }
  );
  const payload = (await response.json().catch(() => null)) as
    | MaterialsCatalogDataResponse
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      (payload && 'error' in payload && payload.error) ||
        `Request failed with status ${response.status}`
    );
  }
  return payload as MaterialsCatalogDataResponse;
}

async function saveMaterial({
  id,
  form,
}: {
  id: string;
  form: MaterialFormState;
}): Promise<{ message: string }> {
  const response = await fetch(`/api/materials/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  const payload = (await response.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? 'Unable to update material.');
  }
  return { message: payload?.message ?? 'Material updated.' };
}

async function createPurchaseList(payload: {
  name: string;
  providerName: string;
  items: Array<{ materialId: string; quantity: number }>;
}): Promise<{ message: string }> {
  const response = await fetch('/api/materials/purchase-lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(result?.error ?? 'Unable to save purchase list.');
  }
  return { message: result?.message ?? 'Purchase list saved.' };
}

async function updatePurchaseList({
  id,
  form,
}: {
  id: string;
  form: PurchaseListFormState;
}): Promise<{ message: string }> {
  const response = await fetch(`/api/materials/purchase-lists/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  const result = (await response.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(result?.error ?? 'Unable to update purchase request.');
  }
  return { message: result?.message ?? 'Purchase request updated.' };
}

async function deletePurchaseList(id: string): Promise<{ message: string }> {
  const response = await fetch(`/api/materials/purchase-lists/${id}`, {
    method: 'DELETE',
  });
  const result = (await response.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;
  if (!response.ok) {
    throw new Error(result?.error ?? 'Unable to delete purchase request.');
  }
  return { message: result?.message ?? 'Purchase request deleted.' };
}

export function MaterialsDashboard() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FiltersState>({
    search: '',
    type: 'all',
    equipment: 'all',
    lowStockOnly: false,
  });
  const [statusMessage, setStatusMessage] = useState('');
  const [draftItems, setDraftItems] = useState<Record<string, DraftItem>>({});
  const [editingQuantityId, setEditingQuantityId] = useState<string | null>(null);
  const [purchaseListName, setPurchaseListName] = useState(
    `Materials request ${new Date().toLocaleDateString()}`
  );
  const [providerName, setProviderName] = useState('');
  const [selectedMaterial, setSelectedMaterial] =
    useState<MaterialInventoryRow | null>(null);
  const [materialForm, setMaterialForm] = useState<MaterialFormState | null>(null);
  const [selectedPurchaseList, setSelectedPurchaseList] =
    useState<MaterialPurchaseListWithItems | null>(null);
  const [purchaseListForm, setPurchaseListForm] =
    useState<PurchaseListFormState | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const materialsQuery = useQuery({
    queryKey: ['materials', filters],
    queryFn: () => fetchMaterialsData(filters),
  });
  const data = materialsQuery.data;
  const materials = useMemo(() => data?.materials ?? [], [data?.materials]);
  const draftItemsArray = useMemo(() => Object.values(draftItems), [draftItems]);

  const materialMutation = useMutation({
    mutationFn: saveMaterial,
    onError: (error: Error) => setStatusMessage(error.message),
    onSuccess: async (payload) => {
      setStatusMessage(payload.message);
      setSelectedMaterial(null);
      setMaterialForm(null);
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
    },
  });

  const createListMutation = useMutation({
    mutationFn: createPurchaseList,
    onError: (error: Error) => setStatusMessage(error.message),
    onSuccess: async (payload) => {
      setStatusMessage(payload.message);
      setDraftItems({});
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
    },
  });

  const updateListMutation = useMutation({
    mutationFn: updatePurchaseList,
    onError: (error: Error) => setStatusMessage(error.message),
    onSuccess: async (payload) => {
      setStatusMessage(payload.message);
      setSelectedPurchaseList(null);
      setPurchaseListForm(null);
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: deletePurchaseList,
    onError: (error: Error) => setStatusMessage(error.message),
    onSuccess: async (payload) => {
      setStatusMessage(payload.message);
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
    },
  });

  function openMaterial(material: MaterialInventoryRow) {
    setSelectedMaterial(material);
    setMaterialForm(materialToForm(material));
  }

  function openPurchaseList(purchaseList: MaterialPurchaseListWithItems) {
    setSelectedPurchaseList(purchaseList);
    setPurchaseListForm(purchaseListToForm(purchaseList));
  }

  function removePurchaseList(purchaseList: MaterialPurchaseListWithItems) {
    if (
      !window.confirm(
        `Delete "${purchaseList.name}"? This will also remove its saved items.`
      )
    ) {
      return;
    }
    deleteListMutation.mutate(purchaseList.id);
  }

  function addToDraft(material: MaterialInventoryRow, quantity = 1) {
    setDraftItems((previous) => {
      const existing = previous[material.id];
      return {
        ...previous,
        [material.id]: {
          material,
          quantity: existing ? existing.quantity + quantity : quantity,
        },
      };
    });
    setStatusMessage(`${material.name} added to the purchase request.`);
  }

  function addLowStockConsumables() {
    const lowStock = materials.filter(
      (material) => material.material_type === 'consumable' && isLowStock(material)
    );
    setDraftItems((previous) => {
      const next = { ...previous };
      for (const material of lowStock) {
        if (!next[material.id]) next[material.id] = { material, quantity: 1 };
      }
      return next;
    });
    setStatusMessage(`${lowStock.length} low-stock items added.`);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const id = event.dataTransfer.getData('application/x-p2l-material');
    const material = materials.find((row) => row.id === id);
    if (material) addToDraft(material);
  }

  function submitPurchaseList() {
    if (!draftItemsArray.length) {
      setStatusMessage('Add at least one material to the purchase request.');
      return;
    }
    createListMutation.mutate({
      name: purchaseListName.trim() || 'Materials request',
      providerName,
      items: draftItemsArray.map((item) => ({
        materialId: item.material.id,
        quantity: item.quantity,
      })),
    });
  }

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        eyebrow="Laboratory supply"
        title="Inventory"
        description="Review the maintenance archive, control stock, and prepare traceable purchase requests."
        actions={
          <StatusPill
            tone={
              data?.source === 'local' || data?.source === 'supabase'
                ? 'success'
                : 'warning'
            }
          >
            {data?.source === 'local'
              ? 'Embedded PostgreSQL'
              : data?.source === 'supabase'
                ? 'Supabase'
                : 'Filesystem preview'}
          </StatusPill>
        }
      />

      {data?.warnings?.length ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {statusMessage ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {statusMessage}
        </p>
      ) : null}

      <MetricRail className="md:grid-cols-4">
        <MetricTile
          label="Materials"
          value={data?.stats.totalMaterials ?? 0}
          detail="Cataloged records"
          tone="primary"
        />
        <MetricTile
          label="Consumables"
          value={data?.stats.totalConsumables ?? 0}
          detail="Routine laboratory items"
        />
        <MetricTile
          label="Low stock"
          value={data?.stats.lowStockConsumables ?? 0}
          detail="At or below minimum"
          tone={data?.stats.lowStockConsumables ? 'warning' : 'success'}
        />
        <MetricTile
          label="Requests"
          value={data?.stats.totalPurchaseLists ?? 0}
          detail="Saved purchase lists"
          tone="special"
        />
      </MetricRail>

      <Toolbar>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, search: event.target.value }))
              }
              placeholder="Search material, part number, equipment or source"
              className="pl-9"
            />
          </div>
          <select
            value={filters.type}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                type: event.target.value as FiltersState['type'],
              }))
            }
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All categories</option>
            {(data?.availableTypes ?? []).map((type) => (
              <option key={type} value={type}>
                {materialTypeLabel[type]}
              </option>
            ))}
          </select>
          <select
            value={filters.equipment}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                equipment: event.target.value,
              }))
            }
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All destinations</option>
            {(data?.availableEquipment ?? []).map((equipment) => (
              <option key={equipment} value={equipment}>
                {equipment}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={filters.lowStockOnly}
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                lowStockOnly: event.target.checked,
              }))
            }
          />
          Only show low-stock consumables
        </label>
      </Toolbar>

      {materialsQuery.isError ? (
        <Card>
          <CardContent className="text-sm text-destructive">
            {(materialsQuery.error as Error).message}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Cataloged materials</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Drag a row into the purchase request, or click it to edit its record.
              </p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {materials.length} shown
            </span>
          </CardHeader>
          <CardContent className="max-h-[720px] overflow-auto p-0">
            <Table className="min-w-[790px] table-fixed">
              <colgroup>
                <col className="w-[32px]" />
                <col className="w-[32%]" />
                <col className="w-[110px]" />
                <col className="w-[150px]" />
                <col className="w-[130px]" />
                <col className="w-[210px]" />
                <col className="w-[48px]" />
              </colgroup>
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead aria-label="Drag" />
                  <TableHead>Material</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Part number</TableHead>
                  <TableHead>Stock availability</TableHead>
                  <TableHead aria-label="Add" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Loading materials…
                    </TableCell>
                  </TableRow>
                ) : null}
                {!materialsQuery.isLoading && !materials.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No materials match these filters.
                    </TableCell>
                  </TableRow>
                ) : null}
                {materials.map((material) => {
                  const progress = stockProgress(material);
                  const minimum = inferredMinimumStock(material);
                  return (
                    <TableRow
                      key={material.id}
                      draggable
                      tabIndex={0}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy';
                        event.dataTransfer.setData(
                          'application/x-p2l-material',
                          material.id
                        );
                      }}
                      onClick={() => openMaterial(material)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') openMaterial(material);
                      }}
                      className="cursor-pointer"
                    >
                      <TableCell className="px-2 text-muted-foreground">
                        <GripVertical className="h-4 w-4" />
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <p className="line-clamp-2 font-medium leading-5">{material.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {material.source_file}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {materialTypeLabel[material.material_type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="truncate">
                        {material.equipment ?? 'General lab'}
                      </TableCell>
                      <TableCell className="truncate font-mono text-[11px]">
                        {material.part_number ?? '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-[11px] tabular-nums">
                            {formatNumber(material.current_stock)}
                            {material.unit ? ` ${material.unit}` : ''}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            min {formatNumber(minimum)}
                          </span>
                        </div>
                        <div
                          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                          title={`${progress.percentage}% of the working stock target`}
                        >
                          <div
                            className={cn('h-full rounded-full', progress.tone)}
                            style={{ width: `${progress.percentage}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {availabilityLabel[material.availability_status]}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Add to purchase request"
                          onClick={(event) => {
                            event.stopPropagation();
                            addToDraft(material);
                          }}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card
          className={cn(
            'self-start overflow-hidden transition-colors',
            dragActive && 'border-primary bg-primary/5'
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              Custom purchase request
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Drop catalog rows here. Saved requests remain in purchase history.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={purchaseListName}
              onChange={(event) => setPurchaseListName(event.target.value)}
              placeholder="Request name"
            />
            <select
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Provider not assigned</option>
              {(data?.providers ?? []).map((provider) => (
                <option key={provider.id} value={provider.name}>
                  {provider.name}
                </option>
              ))}
            </select>
            <div
              className={cn(
                'min-h-24 rounded-md border border-dashed',
                dragActive && 'border-primary'
              )}
            >
              <Table className="table-fixed">
                <colgroup>
                  <col />
                  <col className="w-[70px]" />
                  <col className="w-[72px]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!draftItemsArray.length ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-20 whitespace-normal text-center text-muted-foreground">
                        Drag materials here or use the plus icon.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {draftItemsArray.map((item) => (
                    <TableRow key={item.material.id}>
                      <TableCell className="whitespace-normal">
                        <p className="line-clamp-2 font-medium">{item.material.name}</p>
                      </TableCell>
                      <TableCell>
                        {editingQuantityId === item.material.id ? (
                          <Input
                            autoFocus
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.quantity}
                            onChange={(event) =>
                              setDraftItems((previous) => ({
                                ...previous,
                                [item.material.id]: {
                                  ...previous[item.material.id],
                                  quantity: Math.max(0.01, Number(event.target.value) || 1),
                                },
                              }))
                            }
                            onBlur={() => setEditingQuantityId(null)}
                            className="h-7 px-2"
                          />
                        ) : (
                          <span className="font-mono tabular-nums">
                            {formatNumber(item.quantity)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-1">
                        <div className="flex">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Edit quantity"
                            onClick={() => setEditingQuantityId(item.material.id)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Remove"
                            onClick={() =>
                              setDraftItems((previous) => {
                                const next = { ...previous };
                                delete next[item.material.id];
                                return next;
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={addLowStockConsumables}>
                Add low stock
              </Button>
              <Button
                className="flex-1"
                disabled={createListMutation.isPending || !draftItemsArray.length}
                onClick={submitPurchaseList}
              >
                <Save className="mr-1.5 h-4 w-4" />
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Purchase history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[780px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
                <TableHead className="text-right">Export</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.purchaseLists.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No saved purchase requests yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {(data?.purchaseLists ?? []).map((list) => (
                <TableRow key={list.id}>
                  <TableCell className="font-medium">{list.name}</TableCell>
                  <TableCell>{list.provider_name ?? '—'}</TableCell>
                  <TableCell>{formatDateTime(list.created_at)}</TableCell>
                  <TableCell className="font-mono">{list.items.length}</TableCell>
                  <TableCell>
                    <StatusPill tone="neutral">{list.status}</StatusPill>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Edit ${list.name}`}
                        aria-label={`Edit ${list.name}`}
                        onClick={() => openPurchaseList(list)}
                        disabled={updateListMutation.isPending || deleteListMutation.isPending}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Delete ${list.name}`}
                        aria-label={`Delete ${list.name}`}
                        onClick={() => removePurchaseList(list)}
                        disabled={updateListMutation.isPending || deleteListMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={`/api/materials/purchase-lists/${list.id}/export?format=xlsx`}
                          title="Export Excel workbook"
                        >
                          <FileSpreadsheet className="mr-1 h-4 w-4" />
                          XLSX
                        </a>
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={`/api/materials/purchase-lists/${list.id}/export?format=csv`}
                          title="Export CSV"
                        >
                          <Download className="mr-1 h-4 w-4" />
                          CSV
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {selectedPurchaseList && purchaseListForm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-request-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setSelectedPurchaseList(null);
              setPurchaseListForm(null);
            }
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-xl border bg-background shadow-2xl">
            <div className="flex items-start justify-between border-b px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-primary">
                  Purchase history
                </p>
                <h2 id="purchase-request-title" className="font-display text-lg font-semibold">
                  Edit purchase request
                </h2>
                <p className="text-xs text-muted-foreground">
                  {selectedPurchaseList.items.length} saved item
                  {selectedPurchaseList.items.length === 1 ? '' : 's'}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                aria-label="Close purchase request editor"
                onClick={() => {
                  setSelectedPurchaseList(null);
                  setPurchaseListForm(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4 p-5">
              <FormField label="Request name">
                <Input
                  value={purchaseListForm.name}
                  onChange={(event) =>
                    setPurchaseListForm({
                      ...purchaseListForm,
                      name: event.target.value,
                    })
                  }
                />
              </FormField>
              <FormField label="Provider">
                <select
                  value={purchaseListForm.providerName}
                  onChange={(event) =>
                    setPurchaseListForm({
                      ...purchaseListForm,
                      providerName: event.target.value,
                    })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Provider not assigned</option>
                  {(data?.providers ?? []).map((provider) => (
                    <option key={provider.id} value={provider.name}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Status">
                <select
                  value={purchaseListForm.status}
                  onChange={(event) =>
                    setPurchaseListForm({
                      ...purchaseListForm,
                      status: event.target.value,
                    })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Array.from(
                    new Set([...purchaseListStatuses, purchaseListForm.status])
                  ).map((status) => (
                    <option key={status} value={status}>
                      {status.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setSelectedPurchaseList(null);
                  setPurchaseListForm(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={updateListMutation.isPending || !purchaseListForm.name.trim()}
                onClick={() =>
                  updateListMutation.mutate({
                    id: selectedPurchaseList.id,
                    form: purchaseListForm,
                  })
                }
              >
                <Save className="mr-1.5 h-4 w-4" />
                Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedMaterial && materialForm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-record-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setSelectedMaterial(null);
              setMaterialForm(null);
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-xl border bg-background shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-background px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-primary">
                  Material record
                </p>
                <h2 id="material-record-title" className="font-display text-lg font-semibold">
                  {selectedMaterial.name}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Source: {selectedMaterial.source_file}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setSelectedMaterial(null);
                  setMaterialForm(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <FormField label="Material name" className="sm:col-span-2">
                <Input
                  value={materialForm.name}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, name: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Category">
                <select
                  value={materialForm.materialType}
                  onChange={(event) =>
                    setMaterialForm({
                      ...materialForm,
                      materialType: event.target.value as MaterialType,
                    })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {MATERIAL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {materialTypeLabel[type]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Equipment destination">
                <Input
                  value={materialForm.equipment}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, equipment: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Part number">
                <Input
                  value={materialForm.partNumber}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, partNumber: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Availability">
                <select
                  value={materialForm.availabilityStatus}
                  onChange={(event) =>
                    setMaterialForm({
                      ...materialForm,
                      availabilityStatus: event.target
                        .value as MaterialFormState['availabilityStatus'],
                    })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(availabilityLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Current stock">
                <Input
                  type="number"
                  min="0"
                  value={materialForm.currentStock}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, currentStock: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Minimum stock">
                <Input
                  type="number"
                  min="0"
                  value={materialForm.minimumStock}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, minimumStock: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Target stock">
                <Input
                  type="number"
                  min="0"
                  value={materialForm.suggestedStock}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, suggestedStock: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Unit">
                <Input
                  value={materialForm.unit}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, unit: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Unit cost">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={materialForm.unitCost}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, unitCost: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Currency">
                <Input
                  value={materialForm.currency}
                  maxLength={3}
                  onChange={(event) =>
                    setMaterialForm({
                      ...materialForm,
                      currency: event.target.value.toUpperCase(),
                    })
                  }
                />
              </FormField>
              <FormField label="Provider">
                <select
                  value={materialForm.providerId}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, providerId: event.target.value })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Not assigned</option>
                  {(data?.providers ?? []).map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Storage location">
                <Input
                  value={materialForm.storageLocation}
                  onChange={(event) =>
                    setMaterialForm({
                      ...materialForm,
                      storageLocation: event.target.value,
                    })
                  }
                />
              </FormField>
              <FormField label="Description" className="sm:col-span-2">
                <textarea
                  value={materialForm.description}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, description: event.target.value })
                  }
                  className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm"
                />
              </FormField>
              <FormField label="Internal notes" className="sm:col-span-2">
                <textarea
                  value={materialForm.notes}
                  onChange={(event) =>
                    setMaterialForm({ ...materialForm, notes: event.target.value })
                  }
                  className="min-h-16 w-full rounded-md border border-input bg-background p-3 text-sm"
                />
              </FormField>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background px-5 py-3">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedMaterial(null);
                  setMaterialForm(null);
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={materialMutation.isPending}
                onClick={() =>
                  materialMutation.mutate({ id: selectedMaterial.id, form: materialForm })
                }
              >
                <Save className="mr-1.5 h-4 w-4" />
                Save material
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FormField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('space-y-1.5', className)}>
      <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
