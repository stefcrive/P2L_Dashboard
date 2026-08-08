import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const outputDir = path.join(root, "outputs", "maintenance-refresh-20260807");
const clean = JSON.parse(
  await fs.readFile(path.join(root, "tmp", "maintenance_cleaning", "clean_catalog.json"), "utf8"),
);
await fs.mkdir(outputDir, { recursive: true });

const wb = Workbook.create();
const summary = wb.worksheets.add("Summary");
const materials = wb.worksheets.add("Materials");
const providers = wb.worksheets.add("Providers");
const assets = wb.worksheets.add("Equipment Assets");
const audit = wb.worksheets.add("Source Audit");

const navy = "#16324F";
const teal = "#0F766E";
const pale = "#E7F3F2";
const gold = "#E8B44F";
const ink = "#17212B";
const muted = "#5B6773";
const border = "#D6DEE5";

function titleBand(sheet, range, title, subtitle) {
  sheet.getRange(range).merge();
  const first = range.split(":")[0];
  sheet.getRange(first).values = [[title]];
  sheet.getRange(range).format = {
    fill: navy,
    font: { bold: true, color: "#FFFFFF", size: 18 },
    verticalAlignment: "center",
  };
  const subtitleRange = sheet.getRange("A2:H2");
  subtitleRange.merge();
  subtitleRange.values = [[subtitle]];
  subtitleRange.format = { fill: "#DCE7F1", font: { color: ink, italic: true }, wrapText: true };
  sheet.getRange("A1:H2").format.rowHeight = 27;
}

function styleHeader(range) {
  range.format = {
    fill: teal,
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: border },
  };
  range.format.rowHeight = 32;
}

function styleBody(range) {
  range.format = {
    font: { color: ink, size: 10 },
    verticalAlignment: "top",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: border },
  };
}

titleBand(summary, "A1:H1", "P2L Maintenance Catalog — Clean Refresh", "Audited output from 27 maintenance files. Planning quantities are not treated as physical stock counts.");
summary.getRange("A4:B12").values = [
  ["Metric", "Value"],
  ["Clean catalog records", null],
  ["Consumables", null],
  ["Spare parts", null],
  ["Equipment", null],
  ["Services / other", null],
  ["Providers", null],
  ["Source files processed", null],
  ["Rows with current stock", null],
];
summary.getRange("B5").formulas = [[`=COUNTA(Materials!$B$2:$B$${clean.materials.length + 1})`]];
summary.getRange("B6").formulas = [[`=COUNTIF(Materials!$A$2:$A$${clean.materials.length + 1},"consumable")`]];
summary.getRange("B7").formulas = [[`=COUNTIF(Materials!$A$2:$A$${clean.materials.length + 1},"spare_part")`]];
summary.getRange("B8").formulas = [[`=COUNTIF(Materials!$A$2:$A$${clean.materials.length + 1},"equipment")`]];
summary.getRange("B9").formulas = [[`=COUNTIF(Materials!$A$2:$A$${clean.materials.length + 1},"other")`]];
summary.getRange("B10").formulas = [[`=COUNTA(Providers!$A$2:$A$${clean.providers.length + 1})`]];
summary.getRange("B11").formulas = [[`=COUNTA('Source Audit'!$A$2:$A$${clean.source_audit.length + 1})`]];
summary.getRange("B12").formulas = [[`=COUNT(Materials!$G$2:$G$${clean.materials.length + 1})`]];
styleHeader(summary.getRange("A4:B4"));
styleBody(summary.getRange("A5:B12"));
summary.getRange("B5:B12").format.numberFormat = "0";
summary.getRange("A14:B18").values = [
  ["Validation check", "Result"],
  ["123 unique records", null],
  ["27 files covered", null],
  ["No current-stock claims", null],
  ["No duplicate normalized keys", clean.quality.duplicate_normalized_keys === 0],
];
summary.getRange("B15").formulas = [["=IF(B5=123,\"PASS\",\"CHECK\")"]];
summary.getRange("B16").formulas = [["=IF(B11=27,\"PASS\",\"CHECK\")"]];
summary.getRange("B17").formulas = [["=IF(B12=0,\"PASS\",\"CHECK\")"]];
styleHeader(summary.getRange("A14:B14"));
styleBody(summary.getRange("A15:B18"));
summary.getRange("A20:H22").merge();
summary.getRange("A20").values = [[
  "Policy: suggested_stock comes from the consolidated planning lists. current_stock is intentionally blank because none of the files is a verified stock count. Latest quoted prices come from USP LESTE PETROBRAS 2024_RFL_CMC_SC.xlsx; historical invoices and quotations remain in the evidence trail.",
]];
summary.getRange("A20:H22").format = { fill: pale, font: { color: ink }, wrapText: true, verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: teal } };
summary.getRange("A:A").format.columnWidth = 28;
summary.getRange("B:B").format.columnWidth = 14;
summary.getRange("C:C").format.columnWidth = 3;
summary.getRange("D:H").format.columnWidth = 15;
summary.showGridLines = false;
summary.freezePanes.freezeRows(2);
const chart = summary.charts.add("bar", summary.getRange("A6:B9"));
chart.title = "Catalog records by type";
chart.hasLegend = false;
chart.setPosition("D4", "H17");

const materialHeaders = [
  "Type", "Name", "Part number", "Equipment", "Suggested stock", "Unit",
  "Current stock", "Minimum stock", "Unit cost", "Currency", "Provider",
  "Supplier reference", "Source file", "Source sheet", "Availability",
  "Normalized key", "Evidence records", "Notes",
];
const materialRows = clean.materials.map((row) => [
  row.material_type, row.name, row.part_number, row.equipment, row.suggested_stock,
  row.unit, row.current_stock, row.minimum_stock, row.unit_cost, row.currency,
  row.provider_name, row.supplier_reference, row.source_file, row.source_sheet,
  row.availability_status, row.normalized_key, row.evidence.length, row.notes,
]);
materials.getRangeByIndexes(0, 0, 1, materialHeaders.length).values = [materialHeaders];
materials.getRangeByIndexes(1, 0, materialRows.length, materialHeaders.length).values = materialRows;
styleHeader(materials.getRangeByIndexes(0, 0, 1, materialHeaders.length));
styleBody(materials.getRangeByIndexes(1, 0, materialRows.length, materialHeaders.length));
materials.getRange(`E2:J${materialRows.length + 1}`).format.numberFormat = "0.00";
materials.getRange(`Q2:Q${materialRows.length + 1}`).format.numberFormat = "0";
materials.getRange("A:A").format.columnWidth = 14;
materials.getRange("B:B").format.columnWidth = 40;
materials.getRange("C:C").format.columnWidth = 18;
materials.getRange("D:D").format.columnWidth = 23;
materials.getRange("E:J").format.columnWidth = 13;
materials.getRange("K:K").format.columnWidth = 30;
materials.getRange("L:L").format.columnWidth = 38;
materials.getRange("M:N").format.columnWidth = 28;
materials.getRange("O:Q").format.columnWidth = 19;
materials.getRange("R:R").format.columnWidth = 55;
materials.freezePanes.freezeRows(1);
materials.freezePanes.freezeColumns(2);
materials.tables.add(`A1:R${materialRows.length + 1}`, true, "CleanMaterialsTable").style = "TableStyleMedium2";
materials.showGridLines = false;

const providerHeaders = ["Name", "Contact", "Email", "Phone", "Website", "Address", "Categories", "Notes"];
const providerRows = clean.providers.map((row) => [row.name, row.contact_name, row.email, row.phone, row.website, row.address, row.categories.join(", "), row.notes]);
providers.getRangeByIndexes(0, 0, 1, providerHeaders.length).values = [providerHeaders];
providers.getRangeByIndexes(1, 0, providerRows.length, providerHeaders.length).values = providerRows;
styleHeader(providers.getRangeByIndexes(0, 0, 1, providerHeaders.length));
styleBody(providers.getRangeByIndexes(1, 0, providerRows.length, providerHeaders.length));
providers.getRange("A:A").format.columnWidth = 35;
providers.getRange("B:E").format.columnWidth = 25;
providers.getRange("F:H").format.columnWidth = 45;
providers.freezePanes.freezeRows(1);
providers.tables.add(`A1:H${providerRows.length + 1}`, true, "CleanProvidersTable").style = "TableStyleMedium2";
providers.showGridLines = false;

const assetHeaders = ["Asset code", "Name", "Manufacturer", "Model", "Status", "Provider", "Notes"];
const assetRows = clean.equipment_assets.map((row) => [row.asset_code, row.name, row.manufacturer, row.model, row.status, row.provider_name, row.notes]);
assets.getRangeByIndexes(0, 0, 1, assetHeaders.length).values = [assetHeaders];
assets.getRangeByIndexes(1, 0, assetRows.length, assetHeaders.length).values = assetRows;
styleHeader(assets.getRangeByIndexes(0, 0, 1, assetHeaders.length));
styleBody(assets.getRangeByIndexes(1, 0, assetRows.length, assetHeaders.length));
assets.getRange("A:A").format.columnWidth = 16;
assets.getRange("B:G").format.columnWidth = 32;
assets.freezePanes.freezeRows(1);
assets.tables.add(`A1:G${assetRows.length + 1}`, true, "CleanAssetsTable").style = "TableStyleMedium2";
assets.showGridLines = false;

const auditHeaders = ["Source file", "Kind", "Bytes", "SHA-256", "Classification", "Decision"];
const auditRows = clean.source_audit.map((row) => [row.source_file, row.kind, row.size_bytes, row.sha256, row.classification, row.decision]);
audit.getRangeByIndexes(0, 0, 1, auditHeaders.length).values = [auditHeaders];
audit.getRangeByIndexes(1, 0, auditRows.length, auditHeaders.length).values = auditRows;
styleHeader(audit.getRangeByIndexes(0, 0, 1, auditHeaders.length));
styleBody(audit.getRangeByIndexes(1, 0, auditRows.length, auditHeaders.length));
audit.getRange("C:C").format.numberFormat = "#,##0";
audit.getRange("A:A").format.columnWidth = 48;
audit.getRange("B:B").format.columnWidth = 14;
audit.getRange("C:C").format.columnWidth = 14;
audit.getRange("D:D").format.columnWidth = 68;
audit.getRange("E:E").format.columnWidth = 28;
audit.getRange("F:F").format.columnWidth = 65;
audit.freezePanes.freezeRows(1);
audit.tables.add(`A1:F${auditRows.length + 1}`, true, "SourceAuditTable").style = "TableStyleMedium2";
audit.showGridLines = false;

const formulaInspection = await wb.inspect({ kind: "formula", sheetId: "Summary", range: "A1:H22", maxChars: 4000 });
await fs.writeFile(path.join(outputDir, "workbook_formula_inspection.ndjson"), formulaInspection.ndjson ?? String(formulaInspection), "utf8");
const summaryPreview = await wb.render({ sheetName: "Summary", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, "clean_catalog_summary.png"), new Uint8Array(await summaryPreview.arrayBuffer()));
const materialsPreview = await wb.render({ sheetName: "Materials", range: "A1:R18", scale: 1, format: "png" });
await fs.writeFile(path.join(outputDir, "clean_catalog_materials.png"), new Uint8Array(await materialsPreview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(path.join(outputDir, "p2l_maintenance_clean_catalog.xlsx"));
console.log(JSON.stringify({ workbook: path.join(outputDir, "p2l_maintenance_clean_catalog.xlsx"), materials: materialRows.length, providers: providerRows.length, sources: auditRows.length }));
