from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW_PATH = ROOT / "tmp" / "maintenance_cleaning" / "raw_sources.json"
SUMMARY_PATH = ROOT / "tmp" / "maintenance_cleaning" / "source_summary.md"


def compact_cell(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r", " ").replace("\n", " ").strip()
    return text[:240]


def main() -> None:
    payload = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    lines = ["# Maintenance source extraction", ""]
    for item in payload["files"]:
        kind = item.get("kind")
        if kind == "unsupported":
            continue
        lines.extend([f"## {item['relative_path']}", ""])
        if kind == "spreadsheet":
            for sheet in item["sheets"]:
                lines.append(
                    f"### Sheet: {sheet['name']} ({sheet['max_row']} x {sheet['max_column']})"
                )
                lines.append("")
                for index, row in enumerate(sheet["rows"], start=1):
                    rendered = " | ".join(compact_cell(value) for value in row)
                    lines.append(f"{index:03d}: {rendered}")
                if sheet["formulas"]:
                    lines.append("")
                    lines.append("Formulas: " + json.dumps(sheet["formulas"], ensure_ascii=False))
                lines.append("")
        elif kind == "csv":
            lines.append(
                f"Encoding: {item['encoding']}; delimiter: `{item['delimiter']}`; rows: {len(item['rows'])}"
            )
            lines.append("")
            for index, row in enumerate(item["rows"], start=1):
                rendered = " | ".join(compact_cell(value) for value in row)
                lines.append(f"{index:03d}: {rendered}")
            lines.append("")
        elif kind == "pdf":
            lines.append(
                f"Pages: {item['page_count']}; extracted characters: {item['text_characters']}"
            )
            lines.append("")
            for page in item["pages"]:
                text = " ".join(str(page["text"]).split())
                lines.append(f"Page {page['page']}: {text[:2500]}")
            lines.append("")

    SUMMARY_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(str(SUMMARY_PATH))


if __name__ == "__main__":
    main()
