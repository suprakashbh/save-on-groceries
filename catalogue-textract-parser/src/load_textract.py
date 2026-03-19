import json

def load_textract(path: str) -> dict:
    with open(path, "r") as f:
        return json.load(f)


def load_textract_content(content: str) -> dict:
    return json.loads(content)
