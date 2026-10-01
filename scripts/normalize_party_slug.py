"""Turn a party name into a stable URL slug."""

import re
import unicodedata


def normalize_party_slug(name: str) -> str:
    """Strip, lowercase, drop accents, and hyphenate non-alphanumerics."""
    text = name.strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")
