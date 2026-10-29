"""Extract structured PDF text and provenance-preserving visual crops with Docling.

The script is intentionally model-free: Docling performs local layout/table
analysis, while the Node ingestion layer decides which crops merit a vision
description. Results are cached in the output directory by the source checksum.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path

# Docling enables torch.compile by default. On Windows that optimization requires
# the Visual C++ toolchain even though ordinary CPU inference does not.
os.environ.setdefault("DOCLING_INFERENCE_COMPILE_TORCH_MODELS", "false")

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc import ImageRefMode, PictureItem, TableItem


SCHEMA_VERSION = 1


def _json_bbox(item: PictureItem | TableItem) -> dict[str, object]:
    if not item.prov:
        return {}
    return item.prov[0].bbox.model_dump(mode="json")


def _surface_ratio(item: PictureItem | TableItem, document: object) -> float:
    if not item.prov:
        return 0.0
    provenance = item.prov[0]
    page = document.pages.get(provenance.page_no)
    if page is None or page.size.width <= 0 or page.size.height <= 0:
        return 0.0
    bbox = provenance.bbox
    width = abs(float(bbox.r) - float(bbox.l))
    height = abs(float(bbox.t) - float(bbox.b))
    return (width * height) / (float(page.size.width) * float(page.size.height))


def extract(args: argparse.Namespace) -> dict[str, object]:
    input_path = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    source_sha = hashlib.sha256(input_path.read_bytes()).hexdigest()

    if manifest_path.exists() and not args.force:
        cached = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (
            cached.get("schemaVersion") == SCHEMA_VERSION
            and cached.get("sourceSha256") == source_sha
        ):
            return cached

    options = PdfPipelineOptions()
    options.images_scale = args.image_scale
    options.generate_page_images = True
    options.generate_picture_images = True
    options.generate_table_images = True
    options.do_picture_classification = False
    options.do_picture_description = False
    options.document_timeout = args.timeout_seconds

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=options),
        }
    )
    page_range = None
    if args.page_start is not None or args.page_end is not None:
        page_range = (args.page_start or 1, args.page_end or args.page_start or 1)
    result = converter.convert(input_path, page_range=page_range)
    document = result.document
    markdown = document.export_to_markdown(
        image_mode=ImageRefMode.PLACEHOLDER,
        image_placeholder="<!-- visual asset -->",
        enable_chart_tables=True,
        include_annotations=True,
    )
    (output_dir / "document.md").write_text(markdown, encoding="utf-8")

    assets: list[dict[str, object]] = []
    seen_hashes: set[str] = set()
    for item, _level in document.iterate_items():
        if not isinstance(item, (PictureItem, TableItem)):
            continue
        if len(assets) >= args.max_visuals:
            break
        ratio = _surface_ratio(item, document)
        if ratio < args.min_surface_ratio:
            continue
        image = item.get_image(document)
        if image is None or image.width < args.min_pixels or image.height < args.min_pixels:
            continue

        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG", optimize=True)
        image_bytes = buffer.getvalue()
        image_sha = hashlib.sha256(image_bytes).hexdigest()
        if image_sha in seen_hashes:
            continue
        seen_hashes.add(image_sha)

        kind = "table" if isinstance(item, TableItem) else "figure"
        page_number = int(item.prov[0].page_no) if item.prov else 1
        sequence = len(assets) + 1
        filename = f"page-{page_number:04d}-{kind}-{sequence:04d}-{image_sha[:12]}.png"
        (output_dir / filename).write_bytes(image_bytes)
        caption = item.caption_text(document).strip()
        structured_text = (
            item.export_to_markdown(document).strip()
            if isinstance(item, TableItem)
            else ""
        )
        assets.append(
            {
                "stableId": hashlib.sha256(
                    f"{source_sha}:{page_number}:{kind}:{image_sha}".encode("utf-8")
                ).hexdigest(),
                "pageNumber": page_number,
                "kind": kind,
                "caption": caption,
                "structuredText": structured_text,
                "file": filename,
                "mimeType": "image/png",
                "sha256": image_sha,
                "width": image.width,
                "height": image.height,
                "bbox": _json_bbox(item),
                "pageSurfaceRatio": ratio,
            }
        )

    manifest: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceSha256": source_sha,
        "parser": "docling-standard",
        "doclingVersion": importlib.metadata.version("docling"),
        "markdownFile": "document.md",
        "visualsTruncated": len(assets) >= args.max_visuals,
        "assets": assets,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--max-visuals", type=int, default=120)
    parser.add_argument("--min-surface-ratio", type=float, default=0.025)
    parser.add_argument("--min-pixels", type=int, default=160)
    parser.add_argument("--image-scale", type=float, default=2.0)
    parser.add_argument("--timeout-seconds", type=float, default=1800)
    parser.add_argument("--page-start", type=int)
    parser.add_argument("--page-end", type=int)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    manifest = extract(args)
    print(
        json.dumps(
            {
                "manifest": str(Path(args.output_dir).resolve() / "manifest.json"),
                "assets": len(manifest.get("assets", [])),
                "cached": not args.force,
            }
        )
    )


if __name__ == "__main__":
    main()
