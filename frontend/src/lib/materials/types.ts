export const MATERIAL_TYPES = [
  'equipment',
  'consumable',
  'spare_part',
  'other',
] as const;

export type MaterialType = (typeof MATERIAL_TYPES)[number];

export interface ExtractedMaterial {
  normalizedKey: string;
  name: string;
  partNumber: string | null;
  description: string | null;
  materialType: MaterialType;
  equipment: string | null;
  quantityText: string | null;
  suggestedStock: number | null;
  unit: string | null;
  supplierReference: string | null;
  sourceFile: string;
  sourceSheet: string | null;
  sourcePath: string;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string;
}

export interface MaterialsExtractionStats {
  totalMaterials: number;
  byType: Record<MaterialType, number>;
  byEquipment: Record<string, number>;
  consumablesWithStock: number;
}

export interface MaterialsExtractionSnapshot {
  sourceFolder: string;
  extractedAt: string;
  materials: ExtractedMaterial[];
  stats: MaterialsExtractionStats;
  warnings: string[];
}

export interface MaterialInventoryRow {
  id: string;
  normalized_key: string;
  name: string;
  part_number: string | null;
  description: string | null;
  material_type: MaterialType;
  equipment: string | null;
  quantity_text: string | null;
  suggested_stock: number | null;
  current_stock: number | null;
  minimum_stock: number | null;
  unit: string | null;
  supplier_reference: string | null;
  source_file: string;
  source_sheet: string | null;
  source_path: string;
  notes: string | null;
  availability_status:
    | 'available'
    | 'low_stock'
    | 'out_of_stock'
    | 'on_order'
    | 'unavailable';
  unit_cost: number | null;
  currency: string;
  storage_location: string | null;
  provider_id: string | null;
  catalog_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaterialStockMovementRow {
  id: string;
  material_id: string;
  movement_type: string;
  amount: number;
  previous_stock: number | null;
  new_stock: number | null;
  note: string | null;
  created_at: string;
}

export interface MaterialPurchaseListRow {
  id: string;
  name: string;
  provider_name: string | null;
  provider_contact: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MaterialPurchaseListItemRow {
  id: string;
  purchase_list_id: string;
  material_id: string | null;
  quantity: number;
  note: string | null;
  material_name_snapshot: string;
  part_number_snapshot: string | null;
  material_type_snapshot: MaterialType | null;
  unit_snapshot: string | null;
  created_at: string;
}

export interface MaterialPurchaseListWithItems extends MaterialPurchaseListRow {
  items: MaterialPurchaseListItemRow[];
}

export interface MaterialsCatalogStats {
  totalMaterials: number;
  totalConsumables: number;
  totalEquipment: number;
  totalSpareParts: number;
  lowStockConsumables: number;
  trackedConsumables: number;
  totalPurchaseLists: number;
}

export interface MaterialsCatalogDataResponse {
  source: 'local' | 'supabase' | 'filesystem';
  warnings: string[];
  availableTypes: MaterialType[];
  availableEquipment: string[];
  equipmentOptions: Array<{
    id: string;
    assetCode: string;
    name: string;
    status: 'active' | 'service_due' | 'out_of_service' | 'retired';
  }>;
  materials: MaterialInventoryRow[];
  purchaseLists: MaterialPurchaseListWithItems[];
  providers: Array<{ id: string; name: string }>;
  stats: MaterialsCatalogStats;
}
