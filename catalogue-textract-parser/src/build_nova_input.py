
def build_nova_input (candidates, page_number=1):
    return {
        "page": page_number,
        "product_candidates": candidates
    }