#!/usr/bin/env python3
"""Build a deduplicated P2L maintenance catalog from the extracted source archive."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
RAW_PATH = ROOT / "tmp" / "maintenance_cleaning" / "raw_sources.json"
OUT_DIR = ROOT / "tmp" / "maintenance_cleaning"


def text(value) -> str:
    if value is None:
        return ""
    value = str(value).replace("\xa0", " ")
    if any(marker in value for marker in ("Ã", "Â", "â€", "â‰", "ðŸ")):
        try:
            value = value.encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return re.sub(r"\s+", " ", value).strip().strip('"')


def fold(value) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text(value)).lower()
        if not unicodedata.combining(c)
    )


def slug(value) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(value)).strip("-")


def clean_part(value) -> str | None:
    value = text(value)
    if not value or value.lower() in {"n/a", "none", "not listed"}:
        return None
    value = re.sub(r"\s*/\s*", " / ", value)
    return value


def part_key(value) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "", text(value)).lower()
    if value in {"754960", "bre0000957"}:
        return "bre0000957"
    return value.lstrip("0") if value.isdigit() else value


def number(value) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(float(value)):
            return float(value)
        return None
    match = re.search(r"-?\d+(?:[.,]\d+)?", text(value))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", "."))
    except ValueError:
        return None


def qty_unit(value) -> tuple[float | None, str | None]:
    raw = text(value)
    qty = number(raw)
    if qty is None:
        return None, None
    unit = re.sub(r"-?\d+(?:[.,]\d+)?", "", raw, count=1).strip(" ()") or None
    aliases = {
        "unidade": "unit", "unidades": "unit", "un": "unit", "pc": "unit",
        "mt": "m", "mq": "m³", "l": "L", "ml": "mL", "kg": "kg", "g": "g",
    }
    if unit:
        unit = aliases.get(fold(unit), unit)
    return qty, unit


CANONICAL_NAMES = {
    "acid capillary long": "Long acid capillary",
    "acid cont carbodevice (int rem!)": "Acid container Carbodevice (internal replacement)",
    "cylinder head screw iso1207-m3x8-nylon": "Nylon cylinder-head screw, ISO 1207 M3 × 8",
    "cylindrical screw, isso 1207, m3x6, nylon": "Nylon cylindrical screw, ISO 1207 M3 × 6",
    "ferrule swg back 1/16\"\"\"\"ss": "Rear ferrule, 1/16 in stainless steel",
    "ferrule swg back 1/16\"\"ss": "Rear ferrule, 1/16 in stainless steel",
    "filament tungsten": "Tungsten filament",
    "flangeless ferrule p-200": "Flangeless ferrule P-200",
    "frit 1/4 o.d. x 1/32, stainless steel": "Stainless-steel frit, 1/4 in OD × 1/32 in",
    "front ferrule, tube o.d. 1/16": "Front ferrule, 1/16 in tube OD",
    "front ferrule, tube o.d. 1/16\"\"": "Front ferrule, 1/16 in tube OD",
    "gasket gold od117xid115": "Gold gasket, OD117 × ID115",
    "gasket gold od38xid36 5": "Gold gasket, OD38 × ID36.5",
    "gasket tef 11. 9x9x0.25 / pack of 3": "PTFE gasket, 11.9 × 9 × 0.25 mm (pack of 3)",
    "halogenlamp 20w 12v - osram": "Halogen lamp, 20 W / 12 V (Osram)",
    "lifting cylinder cd85 100 mm twist-safe": "Lifting cylinder, CD85 100 mm Twist-Safe",
    "membrane complete": "Complete membrane assembly",
    "no twist fitting 1/16\" peek znf1pk": "No-twist fitting, 1/16 in PEEK (ZNF1PK)",
    "operating fuild reservoir for hipace 300": "HiPace 300 operating-fluid reservoir",
    "operating fuild reservoir for hipace 80": "HiPace 80 operating-fluid reservoir",
    "o-ring, 12.37 x 2.62 viton": "Viton O-ring, 12.37 × 2.62 mm",
    "set of sealing rings": "Sealing-ring set",
    "short flangeless nut xp-235": "Short flangeless nut XP-235",
    "shut-off valve (p-732)": "Shut-off valve P-732",
    "spare parts & cons.kiel iv-newacid valve": "Kiel IV new acid-valve spare set",
    "spare parts 253 plus": "MAT 253 Plus spare-parts set",
    "stamp-au-seal.tip d=3 9": "Gold seal tip, 3.9 mm",
    "tube peek 1/16 x0.04": "PEEK tube, 1/16 in OD × 0.040 in ID",
    "tube quartz 4x2x23": "Quartz tube, 4 × 2 × 23 mm",
    "tubo pu 4,0 x 2,5 azul": "Blue PU tube, 4.0 × 2.5 mm",
    "tubo pu 6,0 x 4,0 azul": "Blue PU tube, 6.0 × 4.0 mm",
    "sample vial ks 19/9- 50 lg": "Sample vial, KS 19/9 × 50 mm",
    "piston": "Piston",
    "adesivos loctite 416": "Loctite 416 adhesive",
    "acido fosforico puriss. p.a., crystallized, ≥99.0%": "Phosphoric acid, ≥99% (crystalline)",
    "acido nitrico 70% pa acs": "Nitric acid, 70%, ACS grade",
    "acido oxalico 2h20 pa acs": "Oxalic acid dihydrate, ACS grade",
    "dimetilglioxima pa acs 25g": "Dimethylglyoxime, ACS grade, 25 g",
    "eter de petroleo (30-70) p.a.-a.c.s. (650g) 100%": "Petroleum ether (30–70 °C), ACS grade, 650 g",
    "filtro para seringa membrana pes 0,22um 30mm k18-230 - r$ 11,90": "PES syringe filter, 0.22 µm × 30 mm (K18-230)",
    "gas argonio": "High-purity argon gas",
    "gas co2 ultrapuro": "Ultra-high-purity CO2 gas",
    "gas helio ultrapuro 99.999%": "Ultra-high-purity helium gas (99.999%)",
    "macarico manual vonder para gas mapp": "Vonder hand torch for MAPP gas",
    "nitrogenio liquido (21600 litros)": "Liquid nitrogen supply (21,600 L)",
    "pecas de reposicao para o conteiner": "Container replacement-parts set",
    "refil para macarico gas mapp 400g": "MAPP gas refill, 400 g",
    "trapping volume /double layer": "Double-layer trapping volume",
    "regulador de pressao na saida do cilindro do helio (manomentro duplo)": "Dual-gauge helium cylinder regulator",
    "regulador de pressao ar comprimido e helio (manometro simples)": "Single-gauge air and helium pressure regulator",
}


def canonical_name(value: str) -> str:
    value = text(value).replace('""', '"').replace('"(/)', '').replace('(/)', '')
    return CANONICAL_NAMES.get(fold(value), value)


def infer_type(name: str, context: str = "") -> str:
    value = fold(f"{name} {context}")
    if any(word in value for word in (
        "maintenance", "manutenc", "training", "treinamento", "labor hourly", "servico"
    )):
        return "other"
    if any(word in value for word in (
        "mass spectrometer", "spectrometer", "qtegra", "conflo", "isolink", "triplus",
        "sample magazine", "cooling unit", "ion source assembly", "dual inlet", "purification",
        "nobreak", "router", "roteador", "mouse", "software", "controller", "adapter",
        "carbonate preparation device", "co2 collector", "liquid nitrogen container",
        "hand torch", "macarico"
    )):
        return "equipment"
    if any(word in value for word in (
        "spare", "gasket", "o-ring", "oring", "membrane", "piston", "seal", "screw",
        "valve", "ferrule", "filament", "lamp", "capillary", "reservoir", "frit",
        "fitting", "nut", "cylinder", "counter", "wire", "regulador", "sensor",
        "replacement-parts", "pecas de reposicao", "carbodevice", "trapping volume"
    )):
        return "spare_part"
    if any(word in value for word in (
        "acid", "acido", "alcool", "alcohol", "acetona", "gas ", "helio", "argon",
        "co2", "ln2", "nitrogen", "silica", "chloride", "tin", "vial", "tube",
        "tubo", "refil", "vermicul", "peptone", "pentoxide", "sulfato", "carbonato",
        "ether", "eter", "graxa", "silicone", "loctite", "filter", "filtro",
        "diatomaceous", "dimetilglioxima", "dimethylglyoxime"
    )):
        return "consumable"
    return "other"


def infer_equipment(name: str, context: str = "") -> str:
    value = fold(f"{name} {context}")
    kiel_terms = (
        "kiel", "carbodevice", "acid capillary", "acid drop", "acid-valve",
        "sample vial", "membrane assembly", "piston", "sealing-ring", "gold seal tip",
        "gasket, od38", "lifting cylinder", "phosphoric acid", "trapping volume",
    )
    mat_terms = (
        "mat253", "mat 253", "253 plus", "hipace", "dual inlet", "tungsten filament",
        "gasket, od117", "o-ring", "halogen lamp", "ferrule", "frit", "peek",
        "flangeless nut", "shut-off valve", "cleaning wire", "cup nut",
        "helium", "helio", "gasket", "screw", "ptfe gasket", "pressure regulator",
    )
    if any(term in value for term in kiel_terms):
        return "Kiel IV carbonate preparation device"
    if any(term in value for term in mat_terms):
        return "MAT 253 Plus isotope-ratio mass spectrometry system"
    if "qtegra" in value:
        return "Qtegra instrument workstation"
    if "delta q" in value or "delta v" in value:
        return "MAT 253 Plus isotope-ratio mass spectrometry system"
    if "miele" in value:
        return "Washing machine"
    if "nobreak" in value or "ups" in value:
        return "UPS"
    if "compressor" in value or "ar comprimido" in value:
        return "Air compressor"
    if "ar condicionado" in value or "air conditioning" in value:
        return "Air conditioning"
    if "liofil" in value:
        return "Freeze dryer"
    if "triak" in value:
        return "Triak generator"
    return "General laboratory"


def infer_description(name: str, material_type: str, equipment: str, unit: str | None) -> str:
    value = fold(name)
    rules = [
        (("filament",), "Replacement tungsten filament for the MAT 253 Plus ion source."),
        (("sample vial",), "Reaction/sample vial sized for the Kiel IV carbonate preparation device."),
        (("acid capillary",), "Replacement capillary for the Kiel IV acid delivery path."),
        (("acid container", "carbodevice"), "Internal replacement component for the Kiel IV acid container assembly."),
        (("acid drop counter",), "Replacement drop-counting component for controlled Kiel IV acid dosing."),
        (("membrane",), "Replacement membrane assembly for the Kiel IV pneumatic acid-dosing mechanism."),
        (("piston",), "Replacement piston for the Kiel IV acid-dosing mechanism."),
        (("sealing-ring",), "Seal set for preventive maintenance of the Kiel IV acid-dosing assembly."),
        (("seal tip",), "Gold sealing tip for the Kiel IV acid-dosing assembly."),
        (("gasket", "o-ring"), "Replacement vacuum seal for leak-tight isotope-analysis system connections."),
        (("ferrule", "fitting", "nut"), "Replacement connector for small-bore gas or reagent tubing on the isotope-analysis system."),
        (("frit",), "Stainless-steel inline frit for filtering a small-bore instrument gas or reagent line."),
        (("peek tube",), "Chemically resistant PEEK tubing for a small-bore instrument fluid line."),
        (("quartz tube",), "Replacement quartz reaction tube for high-temperature isotope sample preparation."),
        (("halogen lamp",), "Replacement 20 W, 12 V lamp for the instrument illumination assembly."),
        (("operating-fluid reservoir",), "Replacement operating-fluid reservoir for the named HiPace turbomolecular pump."),
        (("screw",), "Nylon replacement fastener for an instrument service assembly."),
        (("valve",), "Replacement shut-off or dosing valve for the named instrument flow path."),
        (("regulator", "regulador"), "Replacement pressure regulator for a laboratory support-gas supply line."),
        (("phosphoric acid", "acido fosforico"), "High-purity phosphoric acid used for carbonate digestion and CO2 preparation."),
        (("helium", "helio"), "Ultra-high-purity helium carrier and purge gas for isotope-analysis instrumentation."),
        (("argon",), "High-purity argon cylinder for laboratory instrument purge or support gas."),
        (("co2",), "Ultra-high-purity CO2 reference or process gas for isotope-ratio measurements."),
        (("nitrogen", "nitrogenio"), "Liquid nitrogen supply for cryogenic traps and isotope-analysis support equipment."),
        (("stannous chloride",), "Laboratory reagent used in sample preparation; stock is tracked by pack mass."),
        (("tin (sn)",), "Tin reagent used for sealed-capsule or reduction-based sample preparation."),
        (("acid", "acido"), "Laboratory-grade acid reagent for routine sample preparation and cleaning."),
        (("alcohol", "alcool", "acetona", "ether", "eter"), "Laboratory solvent for cleaning and routine sample preparation."),
        (("silica gel", "vermicul", "diatomaceous"), "General laboratory absorbent or packing consumable."),
        (("pu tube",), "Flexible polyurethane tubing for the laboratory compressed-air distribution system."),
        (("refil",), "Replacement MAPP-gas canister for the laboratory hand torch."),
    ]
    for terms, description in rules:
        if any(term in value for term in terms):
            return description
    destination = equipment if equipment != "General laboratory" else "routine laboratory operations"
    if material_type == "spare_part":
        return f"Replacement part kept for preventive or corrective maintenance of {destination}."
    unit_note = f" Stock is tracked in {unit}." if unit and unit != "unit" else ""
    return f"Consumable used for {destination}.{unit_note}"


def inferred_target_stock(name: str, material_type: str) -> float:
    value = fold(name)
    if material_type == "spare_part":
        if any(term in value for term in ("o-ring", "ferrule", "gasket", "screw", "seal", "nut")):
            return 4.0
        return 1.0
    if any(term in value for term in ("vial", "filter", "filtro")):
        return 10.0
    return 2.0


def provider_from_reference(reference: str | None, name: str, part: str | None) -> str | None:
    ref = text(reference)
    if fold(ref) == "sens" or part_key(part or "").startswith("bre"):
        return "SENS Representações Comerciais Ltda."
    host = urlparse(ref).netloc.lower().replace("www.", "") if ref.startswith("http") else ""
    mapping = {
        "sigmaaldrich.com": "Merck / Sigma-Aldrich",
        "labsynth.com.br": "Labsynth Produtos para Laboratórios Ltda.",
        "quimicamoderna.net.br": "Química Moderna",
        "gamagases.com.br": "Gama Gases",
        "elastim.com.br": "Elastim",
        "kalunga.com.br": "Kalunga",
        "lojadomecanico.com.br": "Loja do Mecânico",
        "lojanetlab.com.br": "Netlab",
    }
    for domain, provider in mapping.items():
        if host.endswith(domain):
            return provider
    thermo_terms = ("gasket", "o-ring", "membrane", "ferrule", "kiel", "mat 253", "hipace")
    if part and (part_key(part).isdigit() or any(t in fold(name) for t in thermo_terms)):
        return "SENS Representações Comerciais Ltda."
    return None


class Catalog:
    def __init__(self):
        self.rows: dict[str, dict] = {}

    def add(self, *, name, source_file, source_sheet=None, part=None, quantity=None,
            quantity_text=None, unit=None, reference=None, description=None, material_type=None,
            equipment=None, unit_cost=None, currency=None, provider=None, priority=0,
            stock_authority=False, price_priority=0, evidence_kind="source record"):
        name = canonical_name(text(name))
        part = clean_part(part)
        if not name or fold(name).startswith("total") or fold(name) == "item":
            return
        key = f"pn::{part_key(part)}" if part_key(part or "") else f"name::{slug(name)[:100]}"
        # A later row may omit the part number for an item already identified by name.
        if not part:
            same_name = next((k for k, r in self.rows.items() if fold(r["name"]) == fold(name)), None)
            if same_name:
                key = same_name
        record = self.rows.get(key)
        if record is None:
            record = {
                "normalized_key": key, "name": name, "part_number": part,
                "description": text(description) or None,
                "material_type": material_type or infer_type(name, text(description)),
                "equipment": equipment or infer_equipment(name, text(description)),
                "quantity_text": text(quantity_text) or None,
                "suggested_stock": quantity, "current_stock": None, "minimum_stock": None,
                "unit": unit, "supplier_reference": text(reference) or None,
                "source_file": source_file, "source_sheet": source_sheet,
                "source_path": source_file, "notes": None,
                "availability_status": "available", "unit_cost": unit_cost,
                "currency": currency or "BRL", "storage_location": None,
                "provider_name": provider or provider_from_reference(reference, name, part),
                "catalog_locked": False, "evidence": [], "_priority": priority,
                "_stock_priority": priority if stock_authority else -1,
                "_price_priority": price_priority if unit_cost is not None else -1,
            }
            self.rows[key] = record
        if priority > record["_priority"]:
            record.update({
                "name": name, "part_number": part or record["part_number"],
                "description": text(description) or record["description"],
                "material_type": material_type or infer_type(name, text(description)),
                "equipment": equipment or infer_equipment(name, text(description)),
                "supplier_reference": text(reference) or record["supplier_reference"],
                "source_file": source_file, "source_sheet": source_sheet,
                "source_path": source_file, "_priority": priority,
            })
        if stock_authority and priority >= record["_stock_priority"]:
            record.update({
                "quantity_text": text(quantity_text) or (str(quantity) if quantity is not None else None),
                "suggested_stock": quantity, "unit": unit, "_stock_priority": priority,
            })
        elif record["suggested_stock"] is None and quantity is not None:
            record.update({"suggested_stock": quantity, "quantity_text": text(quantity_text) or str(quantity), "unit": unit})
        if unit_cost is not None and price_priority >= record["_price_priority"]:
            record.update({"unit_cost": unit_cost, "currency": currency or "BRL", "_price_priority": price_priority})
        candidate_provider = provider or provider_from_reference(reference, name, part)
        if candidate_provider and not record["provider_name"]:
            record["provider_name"] = candidate_provider
        if reference and not record["supplier_reference"]:
            record["supplier_reference"] = text(reference)
        record["evidence"].append({
            "source_file": source_file, "source_sheet": source_sheet,
            "kind": evidence_kind, "quantity_text": text(quantity_text) or None,
            "unit_cost": unit_cost, "currency": currency,
        })

    def final_rows(self):
        result = []
        for row in self.rows.values():
            row["name"] = canonical_name(row["name"])
            if row["material_type"] in {"consumable", "spare_part"}:
                if row["suggested_stock"] is None or row["suggested_stock"] <= 0:
                    row["suggested_stock"] = inferred_target_stock(row["name"], row["material_type"])
                    row["quantity_text"] = str(int(row["suggested_stock"]))
                    row["unit"] = row["unit"] or "unit"
                row["minimum_stock"] = max(1, math.ceil(row["suggested_stock"] * 0.2))
                row["equipment"] = infer_equipment(row["name"], row.get("description") or "")
                row["description"] = infer_description(
                    row["name"], row["material_type"], row["equipment"], row["unit"]
                )
            row["notes"] = (
                "Suggested stock is sourced from a planning/list quantity; stock on hand was not "
                "stated in the source files and remains blank."
            )
            row["evidence"] = sorted(row["evidence"], key=lambda x: (x["source_file"], x["source_sheet"] or ""))
            for private in [k for k in row if k.startswith("_")]:
                row.pop(private)
            result.append(row)
        return sorted(result, key=lambda r: (r["material_type"], fold(r["name"])))


def file_map(raw):
    excluded = {"spares&consumables bremen.xlsx"}
    return {
        f["relative_path"]: f
        for f in raw["files"]
        if not Path(f["relative_path"]).name.startswith("._")
        and Path(f["relative_path"]).name.casefold() not in excluded
    }


def sheet(file, name):
    return next(s for s in file["sheets"] if s["name"] == name)["rows"]


def add_main_list(cat, files):
    source = "Spares and consumable main list.xlsx"
    for row in sheet(files[source], "Sheet1")[1:]:
        values = [text(v) for v in row]
        name = values[1] if len(values) > 1 else ""
        quantity_text = values[2] if len(values) > 2 else ""
        part = values[3] if len(values) > 3 else ""
        url_match = re.search(r"https?://\S+", name)
        reference = url_match.group(0) if url_match else None
        name = re.sub(r"\s*https?://\S+", "", name).strip()
        if " / " in part:
            part = part.split(" / ", 1)[0]
        if not part and reference:
            product_code = re.search(r"/product/(?:[^/]+/)?([A-Za-z0-9-]+)", reference)
            if product_code:
                part = product_code.group(1).upper()
        if part == "79622":
            part = "79622-500G"
        pack_labels = {"208256": "200 g pack", "339741": "200 mL pack", "265640": "200 g pack"}
        if part in pack_labels:
            name = f"{name} ({pack_labels[part]})"
        qty, unit = qty_unit(quantity_text)
        cat.add(name=name, part=part, quantity=qty, quantity_text=quantity_text, unit=unit,
                reference=reference, source_file=source, source_sheet="Sheet1", priority=100,
                stock_authority=True, evidence_kind="master planning list")


def add_lab_list(cat, files):
    source = "Lista material laboratorio P2L.csv"
    for row in files[source]["rows"][1:]:
        values = [text(v) for v in row] + [""] * 5
        name, a, b, reference = values[1], values[2], values[3], values[4]
        # Several source rows place code and quantity in the opposite columns.
        a_qty, a_unit = qty_unit(a)
        b_qty, b_unit = qty_unit(b)
        quantity_pattern = r"^\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|mq|m|mt|unidades?)?(?:\s*\([^)]*\))?$"
        a_is_quantity = bool(re.fullmatch(quantity_pattern, a, re.I))
        b_is_quantity = bool(re.fullmatch(quantity_pattern, b, re.I))
        b_is_code = bool(b) and not b_is_quantity and not b.startswith("http")
        a_codeish = (bool(a) and not a_is_quantity) or (
            a.isdigit() and len(a) >= 5 and b_qty is not None and len(b) <= 4
        )
        if not b_is_code and a_codeish and b_qty is not None:
            part, quantity_text, qty, unit = a, b, b_qty, b_unit
        else:
            part, quantity_text, qty, unit = b, a, a_qty, a_unit
        if part in {"208256-100G", "265640-100G"}:
            name = f"{name} (100 g pack)"
        elif part == "339741-100ML":
            name = f"{name} (100 mL pack)"
        cat.add(name=name, part=part, quantity=qty, quantity_text=quantity_text, unit=unit,
                reference=reference, source_file=source, priority=95, stock_authority=True,
                evidence_kind="laboratory planning list")


def add_latest_budget(cat, files):
    source = "USP LESTE PETROBRAS 2024_RFL_CMC_SC.xlsx"
    rows = sheet(files[source], "Importação direta")
    for row in rows[1:]:
        values = list(row) + [None] * 12
        if not isinstance(values[0], (int, float)):
            continue
        name, part, qty = text(values[2]), clean_part(values[1]), number(values[3])
        origin = fold(values[9])
        unit_cost = number(values[4]) if "internacional" in origin else number(values[7])
        currency = "EUR" if "internacional" in origin else "BRL"
        context = f"{text(values[10])} {text(values[11])}"
        cat.add(name=name, part=part, quantity=qty, quantity_text=text(values[3]),
                unit="unit", description=text(values[11]) or text(values[10]),
                material_type=infer_type(name, context), equipment=infer_equipment(name, context),
                unit_cost=unit_cost, currency=currency,
                provider="SENS Representações Comerciais Ltda." if "internacional" in origin else None,
                source_file=source, source_sheet="Importação direta", priority=90,
                stock_authority=False, price_priority=100, evidence_kind="2024 budget quotation")


def add_equipment_comparison(cat, files):
    source = "Thermo vs SENS quotation comparison.xlsx"
    rows = sheet(files[source], "Sheet1")
    for row in rows[1:]:
        values = list(row) + [None] * 6
        name = text(values[1])
        if not name or fold(name) == "total":
            continue
        thermo_eur = number(values[2])
        sens_usd = number(values[4])
        cat.add(name=name, quantity=1, quantity_text="1", unit="unit",
                material_type=infer_type(name), equipment=infer_equipment(name),
                unit_cost=sens_usd if sens_usd is not None else thermo_eur,
                currency="USD" if sens_usd is not None else "EUR",
                provider="SENS Representações Comerciais Ltda." if sens_usd is not None else "Thermo Fisher Scientific (Bremen) GmbH",
                source_file=source, source_sheet="Sheet1", priority=75,
                price_priority=75, evidence_kind="equipment quotation comparison")


def add_pdf_transactions(cat):
    rows = [
        # source, part, description, qty, unit price, currency, kind
        ("SENS administration/1299.pdf", "BRE0000957", "Sample vial KS 19/9, package of 50", 2, 13659.32, "BRL", "tax invoice"),
        ("SENS administration/1376.pdf", "1220110", "Halogen lamp 20W 12V - Osram", 4, 38.62, "BRL", "tax invoice"),
        ("SENS administration/1376.pdf", "0554440", "O-ring 12.37 x 2.62 Viton", 6, 18.53, "BRL", "tax invoice"),
        ("SENS administration/1376.pdf", "0598671", "Gasket Teflon 11.9 x 9 x 0.25, pack of 3", 3, 202.61, "BRL", "tax invoice"),
        ("SENS administration/1376.pdf", "1157670", "Frit 1/4 OD x 1/32 stainless steel", 2, 158.13, "BRL", "tax invoice"),
        ("SENS administration/1376.pdf", "0453750", "Cylindrical screw ISO 1207 M3x6 nylon", 4, 34.92, "BRL", "tax invoice"),
        ("SENS administration/1376.pdf", "0783900", "Quartz tube 4 x 2 x 23", 2, 790.81, "BRL", "tax invoice"),
        ("SENS administration/1376.pdf", "0551600", "Gold gasket OD117 x ID115", 2, 11093.87, "BRL", "tax invoice"),
        ("SENS administration/1376.pdf", "1097570", "PEEK tube 1/16 x 0.04", 2, 234.53, "BRL", "tax invoice"),
        ("SENS administration/20.074-I - USP LESTE.pdf", "1314000", "Cleaning wire 1 m, 0.075", 1, 21.24, "EUR", "pro forma invoice"),
        ("SENS administration/20.074-I - USP LESTE.pdf", "1299570", "Cleaning wire 1 m", 1, 20.60, "EUR", "pro forma invoice"),
        ("SENS administration/20.074-I - USP LESTE.pdf", "BRE0016655", "Replacement kit for Kiel IV fan 1199030", 1, 964.25, "EUR", "pro forma invoice"),
        ("SENS administration/21.310-I USP LESTE atualizado.pdf", "673490", "Additional sample magazine (48)", 1, 3525.86, "EUR", "pro forma invoice"),
        ("SENS administration/USP GEO 19.058-P.pdf", "1281250", "Additional sample magazine including 50 vials", 1, 57445.16, "BRL", "quotation"),
        ("SENS administration/USP LESTE 23.205-I.pdf", "0551240", "Gold gasket OD11.5 x ID10", 3, 67.39, "EUR", "pro forma invoice"),
        ("SENS administration/USP LESTE 23.205-I.pdf", "0792800", "Front ferrule 1/4 Swagelok", 5, 4.54, "EUR", "pro forma invoice"),
        ("SENS administration/USP LESTE 23.205-I.pdf", "0792810", "Rear ferrule 1/4 Swagelok", 5, 2.70, "EUR", "pro forma invoice"),
        ("SENS administration/USP LESTE 23.205-I.pdf", "0521160", "Cup nut stainless steel 1/4", 5, 6.73, "EUR", "pro forma invoice"),
    ]
    for source, part, name, qty, cost, currency, kind in rows:
        cat.add(name=name, part=part, quantity=qty, quantity_text=str(qty), unit="unit",
                unit_cost=cost, currency=currency, provider="SENS Representações Comerciais Ltda.",
                source_file=source, priority=60, price_priority=60, evidence_kind=kind)

    equipment = [
        ("0723323", "MAT 253 Plus isotope-ratio mass spectrometer", 246095),
        ("BRE0003990", "Clumped CO2 collector", 27278),
        ("1082863", "Dual inlet system for MAT 253 Plus", 53329),
        ("1111122", "Differential pump module for MAT 253 Plus", 9742),
        ("0722710", "Kiel IV carbonate preparation device", 122738),
        ("BRE0023589", "Purification trap for clumped isotopes", 23460),
        ("0543090", "Liquid nitrogen container, 90 L", 11972),
        ("BRE0013447", "Spare consumables for Kiel IV acid valve", 800),
    ]
    for part, name, cost in equipment:
        cat.add(name=name, part=part, quantity=1, quantity_text="1", unit="unit",
                material_type=infer_type(name), equipment=infer_equipment(name), unit_cost=cost,
                currency="EUR", provider="SENS Representações Comerciais Ltda.",
                source_file="SENS administration/USP_EACH_MAT253_050521.pdf", priority=65,
                price_priority=65, evidence_kind="equipment sales quote")

    cat.add(name="MAT 253 and Kiel IV maintenance and operator training", quantity=40,
            quantity_text="40 hours", unit="hour", material_type="other", equipment="MAT253 Plus / Kiel IV",
            unit_cost=542.50, currency="BRL", provider="SENS Representações Comerciais Ltda.",
            source_file="SENS administration/USP LESTE 18.305-S-1_P2L.pdf", priority=65,
            price_priority=65, evidence_kind="service quotation")


def build_providers(rows):
    base = {
        "SENS Representações Comerciais Ltda.": {
            "name": "SENS Representações Comerciais Ltda.", "contact_name": "Commercial administration",
            "email": "administrativo@sensms.com.br", "phone": "+55 11 5031-3231",
            "website": "https://www.sensms.com.br",
            "address": "Av. Queiroz Filho, 1560, Sala 18, Bloco 1, Vila Hamburguesa, São Paulo - SP, 05319-000, Brazil",
            "categories": ["equipment", "spare parts", "consumables", "training", "maintenance"],
            "notes": "Authorized Thermo Fisher representative. CNPJ 54.322.656/0001-50. Mobile +55 11 96647-5918. Older documents show Rua Dr. Abelardo Vergueiro César, 555 and cpretel@sensms.com.br.",
        },
        "Thermo Fisher Scientific (Bremen) GmbH": {
            "name": "Thermo Fisher Scientific (Bremen) GmbH", "contact_name": None,
            "email": None, "phone": "+49 421 5493-371", "website": "https://www.thermofisher.com",
            "address": "Hanna-Kunath-Str. 11, 28195 Bremen, Germany",
            "categories": ["equipment", "spare parts", "consumables"],
            "notes": "Manufacturer/exporter identified in the maintenance quotation files. Fax +49 421 549-378.",
        },
    }
    websites = {
        "Merck / Sigma-Aldrich": "https://www.sigmaaldrich.com",
        "Labsynth Produtos para Laboratórios Ltda.": "https://www.labsynth.com.br",
        "Química Moderna": "http://www.quimicamoderna.net.br",
        "Gama Gases": "http://www.gamagases.com.br",
        "Elastim": "http://www.elastim.com.br",
        "Kalunga": "https://www.kalunga.com.br",
        "Loja do Mecânico": "https://www.lojadomecanico.com.br",
        "Netlab": "https://www.lojanetlab.com.br",
    }
    for name in sorted({r["provider_name"] for r in rows if r["provider_name"]}):
        if name not in base:
            base[name] = {
                "name": name, "contact_name": None, "email": None, "phone": None,
                "website": websites.get(name), "address": None,
                "categories": sorted({r["material_type"] for r in rows if r["provider_name"] == name}),
                "notes": "Provider inferred from supplier URLs in the maintenance source files; no unverified contact details added.",
            }
    return sorted(base.values(), key=lambda x: fold(x["name"]))


def build_assets():
    return [
        {"asset_code": "KIEL-01", "name": "Kiel IV carbonate preparation device", "manufacturer": "Thermo Fisher Scientific", "model": "Kiel IV", "status": "active", "provider_name": "SENS Representações Comerciais Ltda.", "notes": "Canonicalized from maintenance quotations and equipment documentation."},
        {"asset_code": "IRMS-01", "name": "MAT 253 Plus isotope-ratio mass spectrometry system", "manufacturer": "Thermo Fisher Scientific", "model": "MAT 253 Plus", "status": "active", "provider_name": "SENS Representações Comerciais Ltda.", "notes": "Canonicalized from sales quote 040521MAT and product brochure BR-30333."},
        {"asset_code": "QTEGRA-WS", "name": "Qtegra instrument workstation", "manufacturer": "Thermo Fisher Scientific", "model": "Qtegra ISDS", "status": "active", "provider_name": "SENS Representações Comerciais Ltda.", "notes": "Canonicalized from the main list and quotation comparison."},
    ]


def main():
    raw = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    files = file_map(raw)
    cat = Catalog()
    add_main_list(cat, files)
    add_lab_list(cat, files)
    add_latest_budget(cat, files)
    add_equipment_comparison(cat, files)
    add_pdf_transactions(cat)
    rows = cat.final_rows()
    providers = build_providers(rows)
    assets = build_assets()

    actual_files = [f for f in files.values() if Path(f["relative_path"]).name not in {".DS_Store"}]
    duplicated_exports = [
        "Itens para orcamento.csv", "Lista de compra mar 2023.csv",
        "Lista de compra nov 2022.csv", "Material lab 10 2023.csv",
    ]
    source_audit = []
    used_sources = {e["source_file"] for r in rows for e in r["evidence"]}
    for f in sorted(actual_files, key=lambda x: fold(x["relative_path"])):
        path = f["relative_path"]
        classification = "inventory/quotation evidence" if path in used_sources else "reference or superseded source"
        reason = "Processed and represented in the clean catalog." if path in used_sources else "Processed for provenance; no unique current catalog row was taken from this file."
        if path in duplicated_exports:
            classification, reason = "duplicate CSV export", "Processed; the corresponding XLSX was preferred to avoid duplicate records."
        if path.endswith(("BR-30333-IRMS-253-Plus-BR30333-EN.pdf", "IRMS Customer Training Brochure 2020.pdf", "PN30360-Radke-10kV IRMS-PN30360-EN.pdf")):
            classification, reason = "reference document", "Processed for equipment/provider context; it is not a purchase or stock list."
        source_audit.append({
            "source_file": path, "kind": f["kind"], "size_bytes": f["size_bytes"],
            "sha256": f["sha256"], "classification": classification, "decision": reason,
        })

    quality = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_file_count": len(actual_files),
        "catalog_row_count": len(rows),
        "provider_count": len(providers),
        "equipment_asset_count": len(assets),
        "rows_by_type": dict(Counter(r["material_type"] for r in rows)),
        "rows_with_part_number": sum(bool(r["part_number"]) for r in rows),
        "rows_with_suggested_stock": sum(r["suggested_stock"] is not None for r in rows),
        "rows_with_current_stock": sum(r["current_stock"] is not None for r in rows),
        "rows_with_provider": sum(bool(r["provider_name"]) for r in rows),
        "rows_with_latest_price": sum(r["unit_cost"] is not None for r in rows),
        "duplicate_normalized_keys": len(rows) - len({r["normalized_key"] for r in rows}),
        "null_or_blank_names": sum(not r["name"] for r in rows),
        "policy": {
            "stock": "Planning/list quantities populate suggested_stock only; current_stock remains null unless an actual stock count exists.",
            "deduplication": "Part number after punctuation removal and numeric leading-zero normalization; name slug when no part number exists.",
            "pricing": "Latest 2024 RFL/CMC/SC quotation wins; historical invoices and quotations remain evidence.",
            "sources": "CSV exports duplicated by XLSX were processed but not counted twice; the Bremen workbook was explicitly excluded; brochures/papers were context only.",
        },
    }

    payload = {"materials": rows, "providers": providers, "equipment_assets": assets, "source_audit": source_audit, "quality": quality}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "clean_catalog.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(quality, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
