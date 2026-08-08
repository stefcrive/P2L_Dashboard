from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
INPUT_ROOT = ROOT / "tmp" / "pdfs" / "maintenance"
OUTPUT_ROOT = ROOT / "tmp" / "pdfs" / "maintenance-contact-sheets"


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    images = sorted(INPUT_ROOT.rglob("*.png"))
    tile_width = 500
    tile_height = 720
    label_height = 42
    columns = 3
    rows = 3
    page_size = columns * tile_width, rows * tile_height
    font = ImageFont.load_default(size=16)

    for sheet_index, start in enumerate(range(0, len(images), columns * rows), start=1):
        canvas = Image.new("RGB", page_size, "#e5e7eb")
        draw = ImageDraw.Draw(canvas)
        for offset, path in enumerate(images[start : start + columns * rows]):
            row, column = divmod(offset, columns)
            x = column * tile_width
            y = row * tile_height
            image = Image.open(path).convert("RGB")
            image.thumbnail((tile_width - 16, tile_height - label_height - 16))
            paste_x = x + (tile_width - image.width) // 2
            paste_y = y + label_height + 8
            canvas.paste(image, (paste_x, paste_y))
            label = f"{path.parent.name} / {path.stem}"
            draw.rectangle((x, y, x + tile_width, y + label_height), fill="#111827")
            draw.text((x + 8, y + 10), label[:62], fill="white", font=font)
        output = OUTPUT_ROOT / f"maintenance-pdfs-{sheet_index:02d}.jpg"
        canvas.save(output, quality=88, optimize=True)

    print(f"{len(images)} pages -> {len(list(OUTPUT_ROOT.glob('*.jpg')))} contact sheets")


if __name__ == "__main__":
    main()
