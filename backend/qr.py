import io
import os

import segno

# The front part of the link stored in every QR code.
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")


def build_qr_link(product_id: int) -> str:
    """The text stored inside the QR code, e.g. http://localhost:8000/p/1"""
    return f"{BASE_URL}/p/{product_id}"


def make_qr_png(product_id: int) -> bytes:
    """Generate the QR code image for a product and return it as PNG bytes."""
    # make_qr always makes a regular QR code (never Micro QR).
    # error="m" is medium error correction.
    qr = segno.make_qr(build_qr_link(product_id), error="m")
    buffer = io.BytesIO()
    # scale = size of each square in pixels, border = white margin scanners need
    qr.save(buffer, kind="png", scale=10, border=4)
    return buffer.getvalue()