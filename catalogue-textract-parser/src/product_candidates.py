from .price_utils import extract_prices, is_reasonable_item_price, has_old_price_cue

def find_price_anchors (column_lines) :
    return [l for l in column_lines if is_reasonable_item_price(l["text"])]
            
def build_candidate(anchor, column_lines, y_range=0.12):
    cluster = []

    for l in column_lines:
        if abs (l["top"] - anchor["top"]) < y_range:
            cluster. append (l)

    # M collect all prices in the cluster
    all_prices = []
    for l in cluster:
        all_prices.extend (extract_prices(l["text"]))

    if not all_prices: 
        return None

    #QUICK FIX for strike-through / old price
    if len(all_prices) >= 2 and has_old_price_cue([l["text"] for l in cluster]):
        anchor_price = min(all_prices)
    else:
        anchor_price = max(all_prices) #dominant price - max

    return{
    "anchor_price": anchor_price,
    "texts": [l["text"] for l in cluster]
    }

def dedupe_candidates(candidates, price_tol=0.01):
    deduped = []

    for c in candidates:
        duplicate = False
        for d in deduped:
            if abs(c["anchor_price"] - d["anchor_price"]) < price_tol:
                duplicate = True 
                break
        if not duplicate:
            deduped.append(c)
    
    return deduped