import re
PRICE_REGEX = r"\$\d+(?:\.\d{1,2})?"

def extract_prices(text: str):
    raw = re.findall(PRICE_REGEX, text)
    prices = []

    for p in raw: 
        try:
            v = float (p. replace("$", ""))

            # OCR decimal recovery
            if v >= 100:    
                v = v / 100
            # sanity bounds (learning-friendly)
            if 0.5 <= v <= 50:
                prices.append (round (v, 2))
        
        except ValueError:
            continue

    return prices

def is_reasonable_item_price(text: str) -> bool:
    t = text.lower()
    if "save" in t: 
        return False

    if "per" in t: 
        return False

    prices = extract_prices(text)
    return len(prices) == 1

def has_old_price_cue(texts):
    cues = ["was", "range was", "previous", "before"]
    joined = " ".join(t.lower() for t in texts)
    return any(cue in joined for cue in cues)