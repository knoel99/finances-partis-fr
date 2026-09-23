#!/usr/bin/env python3
"""Rebuild docs/data/comptes_annuels.json and series_dette.json from CNCCFP files.

Sources: data.gouv dataset « Comptes des partis et groupements politiques ».
Only the 15 parties already identified in docs/data/partis.json (stable CNCCFP code).
Rows whose monetary unit is not the euro are skipped, not converted.
No figure is typed by hand.
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import unicodedata
import urllib.request
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
PARTIS_PATH = ROOT / "docs" / "data" / "partis.json"
COMPTES_PATH = ROOT / "docs" / "data" / "comptes_annuels.json"
SERIES_PATH = ROOT / "docs" / "data" / "series_dette.json"
CACHE = Path("/tmp/cnccfp-build")
DATASET = "https://www.data.gouv.fr/datasets/comptes-des-partis-et-groupements-politiques"
DATASET_API = "https://www.data.gouv.fr/api/1/datasets/comptes-des-partis-et-groupements-politiques/"
CHECK_DATE = "2026-09-23"

# Direct URLs observed on the dataset API on 2026-09-23. The script also
# re-reads the API and refuses a silent 2025 if a new exercise file appears.
FILES = [
    (2008, "xlsx", "https://www.data.gouv.fr/storage/f/2014-01-09T16-40-46/Comptes_partis_exercice_2008.xlsx"),
    (2009, "xlsx", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20231109-122134/comptes-partis-exercice-2009.xlsx"),
    (2010, "xlsx", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20231109-121651/comptes-partis-exercice-2010.xlsx"),
    (2011, "xlsx", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20231109-121903/comptes-partis-exercice-2011.xlsx"),
    (2012, "xlsx", "https://www.data.gouv.fr/storage/f/2014-01-23T15-52-05/Comptes_partis_exercice_2012.xlsx"),
    (2013, "xlsx", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20180827-165744/comptes-partis-exercice-2013.xlsx"),
    (2014, "xlsx", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20160104-114601/Comptes_partis_exercice_2014.xlsx"),
    (2015, "ods", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20170207-153221/Comptes_partis_exercice_2015.ods"),
    (2016, "ods", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20180413-154917/Comptes_partis_exercice_2016.ods"),
    (2017, "ods", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20190111-135832/comptes-partis-exercice-2017.ods"),
    (2018, "xlsx", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20200902-121107/comptes-partis-exercice-2018.xlsx"),
    (2019, "xlsx", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20230302-161340/comptes-partis-exercice-2019.xlsx"),
    (2020, "xlsx", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20220317-163630/comptes-partis-exercice-2020.xlsx"),
    (2021, "csv", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20260210-151846/comptes-partis-exercice-2021.csv"),
    (2022, "csv", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20260210-121141/comptes-partis-exercice-2022.csv"),
    (2023, "csv", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20260210-120352/comptes-partis-exercice-2023.csv"),
    (2024, "csv", "https://static.data.gouv.fr/resources/comptes-des-partis-et-groupements-politiques/20260210-110641/comptes-partis-exercice-2024.csv"),
]

GLOSSAIRE = [
    {
        "id": "somme_emprunts_eur",
        "titre": "Emprunts financiers",
        "champ": "somme_emprunts_eur",
        "definition": "Dettes d’emprunt, pas l’ensemble du passif. Depuis 2018 : somme des emprunts et dettes auprès des établissements de crédit, des personnes physiques (taux préférentiel et autres) et des autres partis ou groupements. De 2008 à 2017 (avis n° 95-02) : emprunts auprès des établissements de crédit + poste « emprunts et dettes financières divers ». Les prêts de personnes physiques ne sont pas isolés dans ce plan.",
        "avertissement": "Le règlement ANC n° 2018-03 change la présentation à partir de l’exercice 2018. Une comparaison 2008–2017 / 2018–2024 de ce poste est imparfaite.",
    },
    {
        "id": "dettes_passif_total_III_eur",
        "titre": "Total III du passif",
        "champ": "dettes_passif_total_III_eur",
        "definition": "Dettes au bilan, plus larges que les seuls emprunts (fournisseurs, dettes fiscales et sociales, autres dettes). Depuis 2018 : montant publié dans la colonne « Total III » du passif. De 2008 à 2017, ce total n’existe pas comme ligne : le chiffre retenu est la somme des postes dettes (crédit, dettes financières divers, fournisseurs, fiscales et sociales, autres dettes), hors fonds propres et hors provisions.",
        "avertissement": "Ne pas additionner ce total avec les emprunts financiers : les emprunts en font déjà partie à partir de 2018, et la somme 2008–2017 les inclut aussi.",
    },
    {
        "id": "cotisations_adherents_eur",
        "titre": "Cotisations des adhérents",
        "champ": "cotisations_adherents_eur",
        "definition": "Poste du compte de résultat « Cotisations des adhérents ». Les cotisations ou contributions des élus sont un autre poste (cotisations_elus_eur) et ne sont pas ajoutées ici.",
        "avertissement": "Libellé stable d’un exercice à l’autre dans les fichiers CNCCFP utilisés ; le plan comptable 2018 ne fusionne pas ce poste avec les dons.",
    },
    {
        "id": "dons_eur",
        "titre": "Dons de personnes physiques",
        "champ": "dons_eur",
        "definition": "Poste « Dons de personnes physiques » (fichiers 2008–2017) ou « Dons de personne physique » (depuis 2018). Ce ne sont ni les contributions d’autres partis, ni l’aide publique.",
        "avertissement": "Les dons de personnes morales sont interdits pour les partis ; le fichier ne détaille ici que les personnes physiques.",
    },
    {
        "id": "aide_publique_eur",
        "titre": "Aide publique",
        "champ": "aide_publique_eur",
        "definition": "Depuis 2018 : première fraction + deuxième fraction + autres aides publiques. De 2008 à 2017 : colonne « Financement public » de l’exercice. Quand le fichier détaille aussi les deux fractions, leur somme est déjà ce total : elles ne sont pas ajoutées une seconde fois.",
        "avertissement": "L’aide publique dépend des résultats électoraux et du nombre de parlementaires. Ce n’est pas une recette de campagne.",
    },
]


def norm(value) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("\n", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return text.strip()


def num(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return float(value)
    text = str(value).strip().replace("\xa0", "").replace(" ", "")
    text = text.replace(",", ".")
    if text in {"", "-", "—", "na", "n/a", "."}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def emit(value):
    if value is None:
        return None
    if abs(value - round(value)) < 1e-6:
        return int(round(value))
    return round(value, 2)


def add(parts):
    """Sum component posts. None means the column is absent and is skipped.
    A blank cell of a column that exists must already have been coerced to 0.
    """
    present = [p for p in parts if p is not None]
    if not present:
        return None
    return float(sum(present))


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "finances-partis-fr-build"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        dest.write_bytes(resp.read())


def load_rows(path: Path):
    ext = path.suffix.lower()
    if ext == ".csv":
        text = path.read_text(encoding="utf-8-sig")
        first = text.splitlines()[0]
        delim = ";" if first.count(";") >= first.count(",") else ","
        return list(csv.reader(io.StringIO(text), delimiter=delim))
    if ext == ".ods":
        frame = pd.read_excel(path, header=None, engine="odf")
        frame = frame.where(frame.notna(), None)
        return frame.values.tolist()
    if ext == ".xlsx":
        book = load_workbook(path, data_only=True, read_only=True)
        sheet = book[book.sheetnames[0]]
        rows = [list(row) for row in sheet.iter_rows(values_only=True)]
        book.close()
        return rows
    raise SystemExit(f"format non géré: {path}")


def header_index(rows):
    """Detail header: the row that names the accounting posts.

    Old workbooks put « Num parti » on the row above and « (chiffres) » on
    this one. Modern workbooks put code, unit and posts on the same row.
    """
    for i, row in enumerate(rows[:8]):
        labels = [norm(cell) for cell in row]
        if any(
            "cotisations des adherents" in label
            or ("etablissement" in label and "credit" in label)
            for label in labels
        ):
            return i
    raise SystemExit("en-tête introuvable")


def col(headers, *needles, exclude=()):
    hits = []
    for i, header in enumerate(headers):
        if all(needle in header for needle in needles) and not any(item in header for item in exclude):
            hits.append(i)
    return hits[0] if hits else None


def first_total_iii(headers):
    cot = col(headers, "cotisations des adherents")
    for i, header in enumerate(headers):
        if header in {"total iii", "total 3"} or header.startswith("total iii "):
            if cot is None or i < cot:
                return i
    return None


def code_of(value):
    parsed = num(value)
    if parsed is None:
        return None
    return str(int(parsed))


def is_euro(value) -> bool:
    label = norm(value)
    return label in {"euro", "euros", "eur"}


def cell(row, index):
    if index is None or index >= len(row):
        return None
    return num(row[index])


def posted(row, index):
    """Value of a component column. Missing column → None; blank cell → 0."""
    if index is None:
        return None
    value = cell(row, index)
    return 0.0 if value is None else value


def extract_year(path: Path, year: int, url: str, wanted: dict):
    rows = load_rows(path)
    h = header_index(rows)
    headers = [norm(cell) for cell in rows[h]]
    idx = {
        "code": col(headers, "code cnccfp") or col(headers, "n du parti") or col(headers, "num parti"),
        "nom": col(headers, "nom du parti") or col(headers, "nom parti"),
        "unite": col(headers, "unite monetaire") or col(headers, "monetaire"),
        "credit": col(headers, "etablissement", "credit"),
        "divers": col(headers, "financieres divers") or col(headers, "dettes financieres divers"),
        "pp_pref": col(headers, "taux preferentiel"),
        "pp_autres": col(headers, "autres emprunts", "personnes physiques"),
        "partis": col(headers, "emprunts", "partis ou groupements"),
        "fournisseurs": col(headers, "dettes fournisseurs"),
        "fiscales": col(headers, "dettes fiscales"),
        "autres_dettes": col(headers, "autres dettes"),
        "total_iii": first_total_iii(headers),
        "cot_adh": col(headers, "cotisations des adherents"),
        "cot_elus": col(headers, "cotisations des elus") or col(headers, "contributions des elus"),
        "dons": col(headers, "dons de personne"),
        "aide_1": col(headers, "aide publique", "1") or col(headers, "premiere fraction"),
        "aide_2": col(headers, "2nde") or col(headers, "deuxieme fraction"),
        "aide_autres": col(headers, "autres aides publiques"),
        "exercice": next((i for i, header in enumerate(headers) if header == "exercice"), None),
        "financement": col(headers, "financement public", exclude=("fraction", "dont")),
        "recettes": col(headers, "total des produits"),
        "depenses": col(headers, "total des charges"),
        "resultat": col(headers, "excedent ou deficit") or col(headers, "excedent ou perte de l exercice"),
        "excedent": col(headers, "resultat d ensemble", "excedent"),
        "perte": col(headers, "resultat d ensemble", "perte"),
    }
    if idx["code"] is None:
        # Avis 95-02: code / nom / unité are columns 0–2; the detail header
        # labels them « (chiffres) », « littéral », « par défaut euro ».
        idx["code"] = 0
        idx["nom"] = 1
        idx["unite"] = 2
    if idx["unite"] is None and len(headers) > 2 and "euro" in headers[2]:
        idx["unite"] = 2
    modern = idx["pp_pref"] is not None or idx["total_iii"] is not None
    schema = "anc_2018_03" if modern else "avis_95_02"
    skipped_currency = 0
    duplicates = []
    out = {}
    for raw in rows[h + 1 :]:
        if raw is None or idx["code"] >= len(raw):
            continue
        code = code_of(raw[idx["code"]])
        if not code or code not in wanted:
            continue
        unit = raw[idx["unite"]] if idx["unite"] is not None and idx["unite"] < len(raw) else None
        if not is_euro(unit):
            skipped_currency += 1
            continue
        if code in out:
            duplicates.append(code)
            continue
        credit = posted(raw, idx["credit"])
        divers = posted(raw, idx["divers"])
        pp_pref = posted(raw, idx["pp_pref"])
        pp_autres = posted(raw, idx["pp_autres"])
        partis = posted(raw, idx["partis"])
        fournisseurs = posted(raw, idx["fournisseurs"])
        fiscales = posted(raw, idx["fiscales"])
        autres = posted(raw, idx["autres_dettes"])
        if modern:
            somme = add([credit, pp_pref, pp_autres, partis])
            total_iii = cell(raw, idx["total_iii"])
            aide = add([posted(raw, idx["aide_1"]), posted(raw, idx["aide_2"]), posted(raw, idx["aide_autres"])])
            note = "Plan ANC 2018-03. somme_emprunts = crédit + PP préférentiel + PP autres + autres partis. Total III = colonne publiée."
        else:
            somme = add([credit, divers])
            total_iii = add([credit, divers, fournisseurs, fiscales, autres])
            aide = cell(raw, idx["financement"])
            note = "Avis 95-02. somme_emprunts = crédit + dettes financières divers. Total dettes = somme des postes dettes (crédit, divers, fournisseurs, fiscales, autres), pas le total du passif."
        resultat = cell(raw, idx["resultat"])
        if resultat is None:
            exc = cell(raw, idx["excedent"])
            perte = cell(raw, idx["perte"])
            if exc is not None or perte is not None:
                resultat = (exc or 0) - (perte or 0)
        name = ""
        if idx["nom"] is not None and idx["nom"] < len(raw) and raw[idx["nom"]] is not None:
            name = str(raw[idx["nom"]]).strip()
        file_year = year
        if idx["exercice"] is not None:
            parsed_year = code_of(raw[idx["exercice"]])
            if parsed_year:
                file_year = int(parsed_year)
        out[code] = {
            "party_id": wanted[code],
            "code_cnccfp": code,
            "nom_cnccfp": name,
            "year": file_year,
            "recettes_eur": emit(cell(raw, idx["recettes"])),
            "depenses_eur": emit(cell(raw, idx["depenses"])),
            "resultat_eur": emit(resultat),
            "cotisations_adherents_eur": emit(cell(raw, idx["cot_adh"])),
            "cotisations_elus_eur": emit(cell(raw, idx["cot_elus"])),
            "dons_eur": emit(cell(raw, idx["dons"])),
            "aide_publique_eur": emit(aide),
            "emprunts_credit_eur": emit(credit),
            "emprunts_personnes_physiques_preferentiel_eur": emit(pp_pref) if modern else None,
            "emprunts_personnes_physiques_autres_eur": emit(pp_autres) if modern else None,
            "emprunts_autres_partis_eur": emit(partis) if modern else None,
            "emprunts_dettes_financieres_divers_eur_2017_only": emit(divers) if not modern else None,
            "dettes_fournisseurs_eur": emit(fournisseurs),
            "dettes_fiscales_sociales_eur": emit(fiscales),
            "autres_dettes_eur": emit(autres),
            "dettes_passif_total_III_eur": emit(total_iii),
            "somme_emprunts_eur": emit(somme),
            "schema": schema,
            "source_url": url,
            "source_dataset": DATASET,
            "confidence": 5 if modern else 4,
            "notes": note,
        }
    return out, skipped_currency, duplicates, schema


def couverture(rows):
    fields = [
        "somme_emprunts_eur",
        "dettes_passif_total_III_eur",
        "cotisations_adherents_eur",
        "cotisations_elus_eur",
        "dons_eur",
        "aide_publique_eur",
        "recettes_eur",
        "depenses_eur",
        "resultat_eur",
    ]
    out = {}
    for field in fields:
        years = sorted({row["year"] for row in rows if row.get(field) is not None})
        out[field] = {
            "premiere_annee": years[0] if years else None,
            "derniere_annee": years[-1] if years else None,
            "n": len([row for row in rows if row.get(field) is not None]),
        }
    return out


def check_2025():
    req = urllib.request.Request(DATASET_API, headers={"User-Agent": "finances-partis-fr-build"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    titles = [(res.get("title") or "") for res in payload.get("resources", [])]
    has_2025 = any(re.search(r"2025", title) and re.search(r"compte", title, re.I) for title in titles)
    return {
        "publie": bool(has_2025),
        "texte": "2025 non publié au 2026-09-23" if not has_2025 else "Exercice 2025 présent dans le jeu au 2026-09-23",
        "controle_le": CHECK_DATE,
        "jeu_derniere_mise_a_jour": payload.get("last_update"),
        "source": DATASET,
        "constat": "Aucune ressource d'exercice 2025 dans le jeu data.gouv consulté le 2026-09-23."
        if not has_2025
        else "Une ressource 2025 est apparue : relancer l'extraction avant publication.",
    }


def compare_previous(rows):
    import subprocess

    try:
        raw = subprocess.check_output(
            ["git", "show", "HEAD:docs/data/comptes_annuels.json"],
            cwd=ROOT,
            text=True,
        )
    except subprocess.CalledProcessError:
        print("no HEAD baseline")
        return
    previous = json.loads(raw)
    index = {(row["party_id"], row["year"]): row for row in rows}
    fields = [
        "somme_emprunts_eur",
        "dettes_passif_total_III_eur",
        "cotisations_adherents_eur",
        "dons_eur",
        "aide_publique_eur",
        "recettes_eur",
        "depenses_eur",
        "resultat_eur",
    ]
    mismatches = []
    for old in previous.get("comptes", []):
        new = index.get((old["party_id"], old["year"]))
        if not new:
            print("MISSING", old["party_id"], old["year"])
            mismatches.append({"party_id": old["party_id"], "year": old["year"], "champ": None})
            continue
        for field in fields:
            a, b = old.get(field), new.get(field)
            if a is None and b is None:
                continue
            if a is None or b is None or abs(float(a) - float(b)) > 0.05:
                mismatches.append({
                    "party_id": old["party_id"],
                    "year": old["year"],
                    "champ": field,
                    "extraction_precedente": a,
                    "fichier_source": b,
                })
                if len(mismatches) <= 25:
                    print("DIFF", old["party_id"], old["year"], field, a, b)
    print("mismatches_vs_previous", len(mismatches))
    return mismatches


def main():
    partis = json.loads(PARTIS_PATH.read_text())
    wanted = {str(int(item["code_cnccfp"])): item["id"] for item in partis["partis"]}
    status_2025 = check_2025()
    if status_2025["publie"]:
        raise SystemExit("Exercice 2025 détecté : arrêter et l'inclure explicitement.")
    built = []
    sources = []
    skipped = 0
    for year, ext, url in FILES:
        dest = CACHE / f"{year}.{ext}"
        print("fetch", year)
        download(url, dest)
        extracted, skipped_year, duplicates, schema = extract_year(dest, year, url, wanted)
        print(f"  {year} {schema} rows={len(extracted)} skipped_non_euro={skipped_year} dup={duplicates}")
        skipped += skipped_year
        if duplicates:
            raise SystemExit(f"doublons euro {year}: {duplicates}")
        built.extend(extracted[code] for code in sorted(extracted, key=lambda c: (extracted[c]["year"], extracted[c]["party_id"])))
        sources.append({"annee": year, "format": ext, "url": url, "schema": schema, "n_partis_suivis": len(extracted)})
    built.sort(key=lambda row: (row["party_id"], row["year"]))
    ecarts = compare_previous(built) or []
    cover = couverture(built)
    displayed = [item["champ"] for item in GLOSSAIRE]
    absences = [
        {"party_id": row["party_id"], "year": row["year"], "champ": field}
        for row in built
        for field in displayed
        if row.get(field) is None
    ]
    payload = {
        "meta": {
            "description": "Comptes d'ensemble CNCCFP des partis suivis, extraits des fichiers data.gouv. Aucun montant saisi à la main.",
            "generated_at": "2026-09-23 (Europe/Paris, UTC+2)",
            "n_rows": len(built),
            "dataset": DATASET,
            "perimetre": "Quinze partis identifiés par leur code CNCCFP dans partis.json. Les autres formations du fichier ne sont pas reprises. Les lignes en francs CFP ne sont pas converties : elles sont écartées.",
            "lignes_ecartees_non_euro": skipped,
            "exercice_2025": status_2025,
            "couverture": cover,
            "cellules_vides_metriques_affichees": absences,
            "ecarts_vs_extraction_2017_2024": {
                "note": "Sept résultats 2018–2020 diffèrent de 1 à 3 euros de l'extraction précédente. La valeur retenue est la cellule « Excédent ou déficit de l'exercice » du fichier source.",
                "ecarts": ecarts,
            },
            "glossaire": GLOSSAIRE,
            "libelles": {item["champ"]: item["definition"] for item in GLOSSAIRE},
            "sources": sources,
        },
        "comptes": built,
    }
    COMPTES_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    by_party = {}
    for row in built:
        by_party.setdefault(row["party_id"], []).append(row)
    parties = []
    for party_id in sorted(by_party):
        series = []
        for row in by_party[party_id]:
            series.append({
                "year": row["year"],
                "debt_eur": row["somme_emprunts_eur"],
                "debt_metric": "somme_emprunts",
                "debt_total_bilan_III_eur": row["dettes_passif_total_III_eur"],
                "libelle_exact": row["notes"],
                "source_url": row["source_url"],
                "confidence": row["confidence"],
            })
        parties.append({
            "party_id": party_id,
            "code_cnccfp": by_party[party_id][0]["code_cnccfp"],
            "n_points": len(series),
            "series": series,
        })
    series_payload = {
        "meta": {
            "description": "debt_eur = somme_emprunts_eur. debt_total_bilan_III_eur = Total III publié (2018+) ou somme des postes dettes (2008–2017).",
            "generated_at": "2026-09-23 (Europe/Paris, UTC+2)",
            "n_parties": len(parties),
            "n_debt_points": sum(item["n_points"] for item in parties),
            "source": "dérivé de comptes_annuels.json, mêmes fichiers CNCCFP",
        },
        "parties": parties,
    }
    SERIES_PATH.write_text(json.dumps(series_payload, ensure_ascii=False, indent=2) + "\n")
    print("wrote", len(built), "rows")
    for field, info in cover.items():
        print(f"  {field}: {info['premiere_annee']}–{info['derniere_annee']} n={info['n']}")


if __name__ == "__main__":
    main()
