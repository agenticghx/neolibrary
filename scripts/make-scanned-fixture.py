"""Make fixtures/books/scanned-meditation.pdf: a two-page PDF built like a scan.

A scanned book (the Internet Archive, a library's digitisation, a phone
scanner app) is a picture of each page, usually compressed as JPEG 2000 or
JBIG2, with the recognised words laid invisibly on top. pdf.js decodes those
two picture formats only with its WebAssembly decoders (see
docs/root-cause-scanned-pdfs.md), so the reader's tests need such a file.

Page 1 is a JPEG 2000 picture, page 2 a JBIG2 picture; each carries one
invisible line of text, as an OCR'd scan does. The words are from Descartes'
Meditation I (John Veitch's translation, 1901; US public domain).

Run from the repo root:  python3 scripts/make-scanned-fixture.py
Needs PyMuPDF and Pillow built with OpenJPEG and libtiff.
"""

import io
import struct
import sys

import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont

OUT = "fixtures/books/scanned-meditation.pdf"
LINES = [
    "MEDITATION I.",
    "Of the things of which we may doubt.",
    "Several years have now elapsed since I first",
    "became aware that I had accepted, even from",
    "my youth, many false opinions for true.",
]
W, H = 850, 1100  # pixels: a letter page at 100 dpi
PAGE = fitz.Rect(0, 0, 612, 792)


def drawn_page(page_number: int) -> Image.Image:
    """Black text and a border on white, as a scanner sees a printed page."""
    img = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=30)
    d.rectangle([60, 60, W - 60, H - 60], outline=0, width=6)
    for i, line in enumerate(LINES):
        d.text((110, 140 + i * 60), line, fill=0, font=font)
    d.text((W // 2 - 20, H - 130), str(page_number), fill=0, font=font)
    return img


def jpeg2000(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG2000", quality_mode="rates", quality_layers=[20])
    return buf.getvalue()


def jbig2_embedded(img: Image.Image) -> bytes:
    """A JBIG2 stream in PDF's embedded form (no file header): a page
    information segment, then one immediate generic region coded with MMR,
    which is the same code as fax Group 4 (ITU T.6). Pillow writes Group 4
    through libtiff; its single strip is the region's data."""
    # JBIG2 and T.6 both call 1 black; Pillow's mode "1" calls 0 black, and
    # libtiff codes Pillow's 0 as a black run under MinIsBlack, so invert.
    bw = img.point(lambda v: 255 if v < 128 else 0).convert("1")
    buf = io.BytesIO()
    bw.save(buf, "TIFF", compression="group4", tiffinfo={278: H})  # 278: rows per strip
    tif = Image.open(io.BytesIO(buf.getvalue()))
    offsets, counts = tif.tag_v2[273], tif.tag_v2[279]
    if len(offsets) != 1:
        sys.exit(f"expected one TIFF strip, got {len(offsets)}")
    mmr = buf.getvalue()[offsets[0] : offsets[0] + counts[0]]

    def segment(number: int, kind: int, data: bytes) -> bytes:
        # number, flags (type; 1-byte page association), no referred-to segments, page 1, data length
        return struct.pack(">IBBBI", number, kind, 0, 1, len(data)) + data

    page_info = struct.pack(">IIIIBH", W, H, 0, 0, 0, 0)
    region_info = struct.pack(">IIIIB", W, H, 0, 0, 0)
    generic = region_info + bytes([1]) + mmr  # flags: MMR on, no template pixels
    return segment(0, 48, page_info) + segment(1, 38, generic) + segment(2, 49, b"")


def invisible_text(page: fitz.Page) -> None:
    """The recognised words, drawn invisibly (render mode 3), as OCR leaves them."""
    for i, line in enumerate(LINES):
        page.insert_text((79, 120 + i * 43.2), line, fontsize=17, fontname="helv", render_mode=3)


doc = fitz.open()
doc.set_metadata({"title": "A Scanned Meditation", "author": "René Descartes"})

p1 = doc.new_page(width=PAGE.width, height=PAGE.height)
p1.insert_image(PAGE, stream=jpeg2000(drawn_page(1)))
invisible_text(p1)

# Page 2: PyMuPDF cannot make a JBIG2 picture itself, so make a placeholder
# picture, then replace its stream and dictionary with the JBIG2 one.
p2 = doc.new_page(width=PAGE.width, height=PAGE.height)
xref = p2.insert_image(PAGE, pixmap=fitz.Pixmap(fitz.csGRAY, fitz.IRect(0, 0, 1, 1), 0))
doc.update_object(
    xref,
    f"<< /Type /XObject /Subtype /Image /Width {W} /Height {H} /ColorSpace /DeviceGray "
    "/BitsPerComponent 1 /Filter /JBIG2Decode >>",
)
doc.update_stream(xref, jbig2_embedded(drawn_page(2)), compress=False)
doc.xref_set_key(xref, "Filter", "/JBIG2Decode")  # update_stream drops the filter it was not asked to apply
invisible_text(p2)

# No recompression on save: MuPDF would otherwise decode the JBIG2 picture and store it as Flate.
doc.save(OUT, garbage=1, deflate=False)
raw = open(OUT, "rb").read()
for marker in (b"/JPXDecode", b"/JBIG2Decode"):
    if marker not in raw:
        sys.exit(f"{OUT} has no {marker.decode()} picture")
print(f"wrote {OUT}: {len(raw)} bytes, JPEG 2000 on page 1, JBIG2 on page 2")
