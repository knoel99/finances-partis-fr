"""Unit tests for normalize_party_slug. Runnable with pytest or as a script."""

from normalize_party_slug import normalize_party_slug


def test_parti_socialiste():
    assert normalize_party_slug("  Parti Socialiste  ") == "parti-socialiste"


def test_les_republicains():
    assert normalize_party_slug("Les Républicains") == "les-republicains"


def test_upr():
    assert normalize_party_slug("UPR") == "upr"


if __name__ == "__main__":
    test_parti_socialiste()
    test_les_republicains()
    test_upr()
    print("ok")
