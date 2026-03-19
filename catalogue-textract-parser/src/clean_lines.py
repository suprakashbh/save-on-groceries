import re

NOISE_KEYWORDS = [
"advertiser promotion",
"serving suggestion",
"available in-store",
"gift cards"
"scan your",
]

def is_noise(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in NOISE_KEYWORDS)

def extract_lines(textract: dict):
    lines = []

    for b in textract.get("Blocks", []):
        if b["BlockType"] != "LINE":
            continue

        if b.get("Confidence", 0) < 80:
            continue

        text = b[ "Text"]

        if is_noise(text):
            continue

        bb = b[ "Geometry"]["BoundingBox"]

        lines.append({
            "text": text,
            "left": bb["Left"],
            "top":  bb["Top"]
        })
    return lines