#!/usr/bin/env python3
"""Create and execute the maintenance catalog audit notebook."""

from pathlib import Path
import ast
import contextlib
import io
import json
import os


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs" / "maintenance-refresh-20260807"
OUT.mkdir(parents=True, exist_ok=True)
NOTEBOOK = OUT / "maintenance_catalog_audit.ipynb"

def markdown(source):
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(True)}


def code(source):
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source.splitlines(True)}


nb = {"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": []}
nb["metadata"]["kernelspec"] = {
    "display_name": "Python 3",
    "language": "python",
    "name": "python3",
}
nb["metadata"]["language_info"] = {"name": "python", "version": "3"}
nb["cells"] = [
    markdown(
        "# P2L maintenance catalog audit\n\n"
        "This notebook validates the source coverage, reconciliation policy, and final database-ready catalog. "
        "It is an auditable companion to the clean workbook and database refresh."
    ),
    code(
        "from pathlib import Path\n"
        "import json, collections\n"
        "root = Path.cwd().parents[1]\n"
        "raw = json.loads((root / 'tmp/maintenance_cleaning/raw_sources.json').read_text(encoding='utf-8'))\n"
        "clean = json.loads((root / 'tmp/maintenance_cleaning/clean_catalog.json').read_text(encoding='utf-8'))\n"
        "materials = clean['materials']\n"
        "providers = clean['providers']\n"
        "assets = clean['equipment_assets']\n"
        "audit = clean['source_audit']\n"
        "clean['quality']"
    ),
    markdown(
        "## Reconciliation rules\n\n"
        "- XLSX files are authoritative over duplicate CSV exports.\n"
        "- The consolidated main list and laboratory list set suggested quantities.\n"
        "- Quotation quantities are planning evidence, not physical stock counts.\n"
        "- Current stock remains blank because no source is a verified stock count.\n"
        "- The latest 2024 RFL/CMC/SC quotation supplies current quoted prices.\n"
        "- Part numbers are normalized for punctuation and numeric leading-zero variants."
    ),
    code(
        "actual_sources = [f for f in raw['files'] if not Path(f['relative_path']).name.startswith('._') and Path(f['relative_path']).name != '.DS_Store']\n"
        "assert len(actual_sources) == 27\n"
        "assert len(audit) == 27\n"
        "assert {f['relative_path'] for f in actual_sources} == {r['source_file'] for r in audit}\n"
        "[(r['source_file'], r['classification']) for r in audit]"
    ),
    code(
        "keys = [r['normalized_key'] for r in materials]\n"
        "assert len(keys) == len(set(keys))\n"
        "assert all(r['name'].strip() for r in materials)\n"
        "assert all(r['current_stock'] is None for r in materials)\n"
        "assert all(r['currency'] in {'BRL', 'EUR', 'USD'} for r in materials)\n"
        "summary = {\n"
        "    'materials': len(materials),\n"
        "    'providers': len(providers),\n"
        "    'assets': len(assets),\n"
        "    'by_type': dict(collections.Counter(r['material_type'] for r in materials)),\n"
        "    'with_part_number': sum(bool(r['part_number']) for r in materials),\n"
        "    'with_suggested_stock': sum(r['suggested_stock'] is not None for r in materials),\n"
        "    'with_price': sum(r['unit_cost'] is not None for r in materials),\n"
        "    'with_provider': sum(bool(r['provider_name']) for r in materials),\n"
        "}\n"
        "summary"
    ),
    code(
        "assert summary['materials'] == 123\n"
        "assert summary['by_type'] == {'consumable': 43, 'equipment': 23, 'other': 14, 'spare_part': 43}\n"
        "assert len(providers) == 10\n"
        "assert len(assets) == 3\n"
        "'All catalog and coverage checks passed.'"
    ),
]

os.chdir(OUT)
namespace = {}
execution_count = 0
for cell in nb["cells"]:
    if cell["cell_type"] != "code":
        continue
    execution_count += 1
    cell["execution_count"] = execution_count
    source = "".join(cell["source"])
    tree = ast.parse(source, filename=str(NOTEBOOK))
    last_expression = tree.body[-1] if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        if last_expression:
            prefix = ast.Module(body=tree.body[:-1], type_ignores=[])
            exec(compile(prefix, str(NOTEBOOK), "exec"), namespace)
            value = eval(compile(ast.Expression(last_expression.value), str(NOTEBOOK), "eval"), namespace)
        else:
            exec(compile(tree, str(NOTEBOOK), "exec"), namespace)
            value = None
    output = buffer.getvalue()
    if output:
        cell["outputs"].append({"name": "stdout", "output_type": "stream", "text": output.splitlines(True)})
    if value is not None:
        cell["outputs"].append({
            "data": {"text/plain": [repr(value)]},
            "execution_count": execution_count,
            "metadata": {},
            "output_type": "execute_result",
        })
NOTEBOOK.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
print(NOTEBOOK)
