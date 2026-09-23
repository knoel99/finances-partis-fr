#!/usr/bin/env python3
"""Presidential results (France entière) from Ministère de l'Intérieur open files.

No figure is typed as a result. The constants below are checks: if a parse
drifts from the file, the script stops. Party ids are taken from
docs/data/partis.json for 2017 and 2022 only. Earlier years keep a parti_id
only when the same person is already tied to a party in that file.
"""
from __future__ import annotations

import csv
import io
import json
import re
import unicodedata
import urllib.request
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parents[1]
PARTIS_PATH = ROOT / "docs" / "data" / "partis.json"
OUT_PATH = ROOT / "docs" / "data" / "elections_presidentielles.json"
CACHE = Path("/tmp/elec-build")

CHECKS = {
    (2022, 1): {"exprimes": 35132947, "voix": {"MACRON": 9783058, "LE PEN": 8133828}},
    (2022, 2): {"exprimes": 32057325, "voix": {"MACRON": 18768639, "LE PEN": 13288686}},
    (2017, 1): {"inscrits": 47582183, "exprimes": 36054394, "voix": {"MACRON": 8656346}},
    (2017, 2): {"exprimes": 31381603, "voix": {"MACRON": 20743128, "LE PEN": 10638475}},
    (2012, 1): {"exprimes": 35883209, "voix": {"HOLLANDE": 10272705, "SARKOZY": 9753629}},
    (2012, 2): {"exprimes": 34861353, "voix": {"HOLLANDE": 18000668, "SARKOZY": 16860685}},
    (2007, 1): {"inscrits": 44472834, "exprimes": 36719396, "voix": {"SARKOZY": 11448663, "ROYAL": 9500112}},
    (2007, 2): {"exprimes": 35773578, "voix": {"SARKOZY": 18983138, "ROYAL": 16790440}},
    (2002, 1): {"exprimes": 28499487, "voix": {"CHIRAC": 5666021, "LE PEN": 4804772}},
    (2002, 2): {"exprimes": 31062928, "voix": {"CHIRAC": 25537894, "LE PEN": 5525034}},
}

# Same person already coded in partis.json. Not applied to 2017/2022
# (those years use the official list, including a null parti_id).
CONTINUITY = {
    "le pen marine": ("rn", "Même personne que la candidate RN des listes 2017 et 2022 dans partis.json. Le fichier 2012 ne porte pas de code parti."),
    "arthaud nathalie": ("lo", "Même personne que la candidate LO des listes 2017 et 2022 dans partis.json. Le fichier antérieur ne porte pas de code parti."),
    "cheminade jacques": ("sp", "Même personne que le candidat Solidarité et Progrès des listes 2017 et 2022 dans partis.json. Le fichier antérieur ne porte pas de code parti."),
    "dupont aignan nicolas": ("dlf", "Même personne que le candidat DLF des listes 2017 et 2022 dans partis.json. Le fichier antérieur ne porte pas de code parti."),
    "asselineau francois": ("upr", "Même personne que le candidat UPR de la liste 2017 dans partis.json. Le fichier antérieur ne porte pas de code parti."),
}


def norm(value) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("\n", " ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return text.strip()


def key_of(nom, prenom) -> str:
    return norm(nom) + " " + norm(prenom)


def parse_int(value):
    if value is None or value == "":
        return None
    if isinstance(value, float):
        return int(round(value))
    if isinstance(value, int):
        return value
    text = str(value).replace("\xa0", "").replace(" ", "").replace(",", ".")
    if text == "":
        return None
    return int(Decimal(text).to_integral_value(rounding=ROUND_HALF_UP))


def parse_pct(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    if text == "":
        return None
    return float(text)


def pct_from_ratio(voix, base):
    if not base:
        return None
    quant = (Decimal(voix) * Decimal(100) / Decimal(base)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(quant)


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "finances-partis-fr-build"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        dest.write_bytes(resp.read())


def load_official():
    payload = json.loads(PARTIS_PATH.read_text())
    by_year = {}
    for year, block in payload["meta"]["candidats_officiels"].items():
        index = {}
        for item in block["liste"]:
            parts = item["nom"].split(" ", 1)
            prenom, nom = parts[0], parts[1]
            index[key_of(nom, prenom)] = item
        by_year[int(year)] = index
    return by_year


def attach_party(year, nom, prenom, official):
    key = key_of(nom, prenom)
    if year in official:
        item = official[year].get(key)
        if not item:
            return None, None, "Nom absent de partis.json candidats_officiels pour cette année."
        return item.get("parti_id"), item.get("etiquette"), "partis.json candidats_officiels " + str(year)
    if key in CONTINUITY:
        parti_id, note = CONTINUITY[key]
        return parti_id, None, note
    return None, None, (
        "Le fichier du ministère et les décisions du Conseil constitutionnel utilisées "
        "ne donnent pas de code CNCCFP. Pas de rattachement inventé."
    )


def split_label(label: str):
    text = re.sub(r"^(M\.|Mme|Mlle)\s+", "", str(label).strip())
    nom, prenom = text.rsplit(" ", 1)
    return nom, prenom


def candidate(nom, prenom, voix, pct_exp, pct_ins, year, official, source_pct: str):
    parti_id, etiquette, mapping = attach_party(year, nom, prenom, official)
    row = {
        "nom": nom,
        "prenom": prenom,
        "voix": voix,
        "pct_exprimes": pct_exp,
        "pct_exprimes_source": source_pct,
        "pct_inscrits": pct_ins,
        "parti_id": parti_id,
        "mapping_source": mapping,
    }
    if etiquette:
        row["etiquette"] = etiquette
    return row


def tour_shell(year, tour, source):
    return {
        "scrutin": "presidentielle",
        "annee": year,
        "tour": tour,
        "perimetre": "France entière",
        "source_url": source["url"],
        "source_dataset": source["dataset"],
        "source_page": source["page"],
        "producteur": "Ministère de l'Intérieur",
        "licence": "Licence Ouverte",
        "methode": source["methode"],
        "inscrits": None,
        "abstentions": None,
        "votants": None,
        "blancs": None,
        "nuls": None,
        "blancs_et_nuls": None,
        "exprimes": None,
        "candidats": [],
    }


def parse_fe_txt(path: Path, year: int, tour: int, source, official):
    raw = path.read_bytes()
    text = raw.decode("cp1252")
    rows = list(csv.reader(io.StringIO(text), delimiter=";"))
    header, data = rows[0], rows[1]
    index = {name: i for i, name in enumerate(header)}

    def col(*names):
        for name in names:
            if name in index:
                return index[name]
        raise SystemExit(f"colonne absente {names} dans {path}")

    block = tour_shell(year, tour, source)
    block["inscrits"] = parse_int(data[col("Inscrits")])
    block["abstentions"] = parse_int(data[col("Abstentions")])
    block["votants"] = parse_int(data[col("Votants")])
    block["blancs"] = parse_int(data[col("Blancs")])
    block["nuls"] = parse_int(data[col("Nuls")])
    block["exprimes"] = parse_int(data[col("Exprimés")])
    # Repeating candidate groups: N°Panneau, Sexe, Nom, Prénom, Voix, % Voix/Ins, % Voix/Exp
    start = col("N°Panneau")
    width = 7
    i = start
    while i + 6 < len(data) and data[i + 2]:
        nom, prenom = data[i + 2], data[i + 3]
        voix = parse_int(data[i + 4])
        pct_ins = parse_pct(data[i + 5])
        pct_exp = parse_pct(data[i + 6])
        block["candidats"].append(
            candidate(nom, prenom, voix, pct_exp, pct_ins, year, official, "fichier")
        )
        i += width
    return block


def parse_fe_sheet_single(path: Path, sheet_name: str, year: int, tour: int, source, official):
    book = xlrd.open_workbook(str(path))
    sheet = book.sheet_by_name(sheet_name)
    block = tour_shell(year, tour, source)
    # France entière block starts at the first "Inscrits" before "Métropole".
    for r in range(sheet.nrows):
        label = str(sheet.cell_value(r, 0)).strip()
        if label == "Métropole":
            break
        amount = sheet.cell_value(r, 1)
        if label == "Inscrits":
            block["inscrits"] = parse_int(amount)
        elif label == "Abstentions":
            block["abstentions"] = parse_int(amount)
        elif label == "Votants":
            block["votants"] = parse_int(amount)
        elif label == "Blancs":
            block["blancs"] = parse_int(amount)
        elif label == "Nuls":
            block["nuls"] = parse_int(amount)
        elif label == "Exprimés":
            block["exprimes"] = parse_int(amount)
        name = str(sheet.cell_value(r, 5)).strip()
        voix = sheet.cell_value(r, 6)
        if name and name not in {"Candidat", "."} and voix != "":
            nom, prenom = split_label(name)
            block["candidats"].append(
                candidate(
                    nom,
                    prenom,
                    parse_int(voix),
                    parse_pct(sheet.cell_value(r, 8)),
                    parse_pct(sheet.cell_value(r, 7)),
                    year,
                    official,
                    "fichier",
                )
            )
    return block


def parse_fe_sheet_both(path: Path, year: int, source, official):
    book = xlrd.open_workbook(str(path))
    sheet = book.sheet_by_name("France entière T1T2")
    blocks = {1: tour_shell(year, 1, source), 2: tour_shell(year, 2, source)}
    for tour, block in blocks.items():
        block["blancs_et_nuls_non_separes"] = True
    for r in range(sheet.nrows):
        label = str(sheet.cell_value(r, 0)).strip()
        if label == "Inscrits":
            blocks[1]["inscrits"] = parse_int(sheet.cell_value(r, 1))
            blocks[2]["inscrits"] = parse_int(sheet.cell_value(r, 5))
        elif label == "Abstentions":
            blocks[1]["abstentions"] = parse_int(sheet.cell_value(r, 1))
            blocks[2]["abstentions"] = parse_int(sheet.cell_value(r, 5))
        elif label == "Votants":
            blocks[1]["votants"] = parse_int(sheet.cell_value(r, 1))
            blocks[2]["votants"] = parse_int(sheet.cell_value(r, 5))
        elif label == "Blancs et nuls":
            blocks[1]["blancs_et_nuls"] = parse_int(sheet.cell_value(r, 1))
            blocks[2]["blancs_et_nuls"] = parse_int(sheet.cell_value(r, 5))
        elif label == "Exprimés":
            blocks[1]["exprimes"] = parse_int(sheet.cell_value(r, 1))
            blocks[2]["exprimes"] = parse_int(sheet.cell_value(r, 5))
        name = str(sheet.cell_value(r, 9)).strip()
        if not name or name in {"Candidat", "."}:
            continue
        nom, prenom = split_label(name)
        v1 = sheet.cell_value(r, 10)
        if v1 != "":
            blocks[1]["candidats"].append(
                candidate(
                    nom, prenom, parse_int(v1),
                    parse_pct(sheet.cell_value(r, 12)),
                    parse_pct(sheet.cell_value(r, 11)),
                    year, official, "fichier",
                )
            )
        v2 = sheet.cell_value(r, 14)
        if v2 != "":
            blocks[2]["candidats"].append(
                candidate(
                    nom, prenom, parse_int(v2),
                    parse_pct(sheet.cell_value(r, 16)),
                    parse_pct(sheet.cell_value(r, 15)),
                    year, official, "fichier",
                )
            )
    return [blocks[1], blocks[2]]


def parse_communes(path: Path, sheet_name: str, year: int, tour: int, source, official):
    book = xlrd.open_workbook(str(path))
    sheet = book.sheet_by_name(sheet_name)
    header = [sheet.cell_value(0, c) for c in range(sheet.ncols)]
    groups = []
    col = 15
    while col + 5 < sheet.ncols and header[col] == "Sexe":
        groups.append(col)
        col += 6
    if not groups:
        raise SystemExit(f"candidats introuvables dans {sheet_name}")
    sample = 1
    names = []
    for col in groups:
        names.append((str(sheet.cell_value(sample, col + 1)).strip(), str(sheet.cell_value(sample, col + 2)).strip()))
    totals = {"inscrits": 0, "abstentions": 0, "votants": 0, "blancs_et_nuls": 0, "exprimes": 0}
    voix = [0] * len(groups)
    seen = set()
    for r in range(1, sheet.nrows):
        dept = sheet.cell_value(r, 0)
        commune = sheet.cell_value(r, 2)
        if dept == "" or commune == "":
            raise SystemExit(f"ligne sans commune {sheet_name} ligne {r}")
        key = (dept, commune)
        if key in seen:
            raise SystemExit(f"commune en double {key}")
        seen.add(key)
        totals["inscrits"] += parse_int(sheet.cell_value(r, 4))
        totals["abstentions"] += parse_int(sheet.cell_value(r, 5))
        totals["votants"] += parse_int(sheet.cell_value(r, 7))
        totals["blancs_et_nuls"] += parse_int(sheet.cell_value(r, 9))
        totals["exprimes"] += parse_int(sheet.cell_value(r, 12))
        for i, col in enumerate(groups):
            voix[i] += parse_int(sheet.cell_value(r, col + 3))
    if sum(voix) != totals["exprimes"]:
        raise SystemExit(f"somme des voix {sum(voix)} != exprimés {totals['exprimes']} ({year} T{tour})")
    block = tour_shell(year, tour, source)
    block.update(totals)
    block["blancs_et_nuls_non_separes"] = True
    block["n_communes"] = len(seen)
    for (nom, prenom), votes in zip(names, voix):
        block["candidats"].append(
            candidate(
                nom,
                prenom,
                votes,
                pct_from_ratio(votes, totals["exprimes"]),
                pct_from_ratio(votes, totals["inscrits"]),
                year,
                official,
                "calcule_voix_sur_exprimes_apres_somme_des_communes",
            )
        )
    return block


def check(block):
    expect = CHECKS[(block["annee"], block["tour"])]
    if "inscrits" in expect and block["inscrits"] != expect["inscrits"]:
        raise SystemExit(f"inscrits {block['annee']} T{block['tour']}: {block['inscrits']}")
    if block["exprimes"] != expect["exprimes"]:
        raise SystemExit(f"exprimes {block['annee']} T{block['tour']}: {block['exprimes']}")
    by_nom = {norm(c["nom"]).split()[-1] if False else norm(c["nom"]): c["voix"] for c in block["candidats"]}
    # Match on the surname token used in CHECKS (last name, possibly compound stored in full nom).
    for surname, voix in expect["voix"].items():
        hits = [c for c in block["candidats"] if surname in norm(c["nom"]).upper() or norm(surname) in norm(c["nom"])]
        # surname keys are unaccented uppercase words; norm() lowercases.
        needle = norm(surname)
        hits = [c for c in block["candidats"] if needle in norm(c["nom"])]
        if len(hits) != 1 or hits[0]["voix"] != voix:
            raise SystemExit(f"voix {block['annee']} T{block['tour']} {surname}: {hits}")
    total = sum(c["voix"] for c in block["candidats"])
    if total != block["exprimes"]:
        raise SystemExit(f"voix != exprimés {block['annee']} T{block['tour']} {total} {block['exprimes']}")
    counted = (block["exprimes"] or 0) + (block["blancs"] or 0) + (block["nuls"] or 0) + (block["blancs_et_nuls"] or 0)
    if block["votants"] is not None and counted != block["votants"]:
        raise SystemExit(f"votants {block['annee']} T{block['tour']}: {counted} != {block['votants']}")
    if block["inscrits"] is not None and block["abstentions"] is not None:
        if block["votants"] + block["abstentions"] != block["inscrits"]:
            raise SystemExit(f"inscrits {block['annee']} T{block['tour']}")


def main():
    official = load_official()
    sources = {
        "2022t1": {
            "url": "https://static.data.gouv.fr/resources/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-1er-tour/20220414-152200/resultats-par-niveau-fe-t1-france-entiere.txt",
            "dataset": "https://www.data.gouv.fr/datasets/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-1er-tour",
            "page": "https://www.data.gouv.fr/datasets/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-1er-tour",
            "methode": "Fichier national « France entière » du 1er tour, une ligne. Pourcentages ceux du fichier.",
            "file": "2022t1.txt",
        },
        "2022t2": {
            "url": "https://static.data.gouv.fr/resources/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-2nd-tour/20220428-141900/resultats-par-niveau-fe-t2-france-entiere.txt",
            "dataset": "https://www.data.gouv.fr/datasets/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-2nd-tour",
            "page": "https://www.data.gouv.fr/datasets/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-2nd-tour",
            "methode": "Fichier national « France entière » du 2nd tour, une ligne. Pourcentages ceux du fichier.",
            "file": "2022t2.txt",
        },
        "2017t1": {
            "url": "https://static.data.gouv.fr/resources/election-presidentielle-des-23-avril-et-7-mai-2017-resultats-definitifs-du-1er-tour-1/20170427-100131/Presidentielle_2017_Resultats_Tour_1_c.xls",
            "dataset": "https://www.data.gouv.fr/datasets/election-presidentielle-des-23-avril-et-7-mai-2017-resultats-definitifs-du-1er-tour-1",
            "page": "https://www.data.gouv.fr/datasets/election-presidentielle-des-23-avril-et-7-mai-2017-resultats-definitifs-du-1er-tour-1",
            "methode": "Feuille « FE Metro OM Tour 1 », bloc France entière uniquement (avant Métropole et Outre-mer).",
            "file": "2017t1.xls",
        },
        "2017t2": {
            "url": "https://static.data.gouv.fr/resources/election-presidentielle-des-23-avril-et-7-mai-2017-resultats-definitifs-du-2nd-tour/20170511-092258/Presidentielle_2017_Resultats_Tour_2_c.xls",
            "dataset": "https://www.data.gouv.fr/datasets/election-presidentielle-des-23-avril-et-7-mai-2017-resultats-definitifs-du-2nd-tour",
            "page": "https://www.data.gouv.fr/datasets/election-presidentielle-des-23-avril-et-7-mai-2017-resultats-definitifs-du-2nd-tour",
            "methode": "Feuille « FE Metro OM Tour 2 », bloc France entière uniquement.",
            "file": "2017t2.xls",
        },
        "2012": {
            "url": "https://static.data.gouv.fr/ff/e9c9483d39e00030815089aca1e2939f9cb99a84b0136e43056790e47bb4f0.xls",
            "dataset": "https://www.data.gouv.fr/datasets/election-presidentielle-2012-resultats-572124",
            "page": "https://www.data.gouv.fr/datasets/election-presidentielle-2012-resultats-572124",
            "methode": "Feuille « France entière T1T2 ». Blancs et nuls ne sont pas séparés dans ce fichier.",
            "file": "2012.xls",
        },
        "2007": {
            "url": "https://static.data.gouv.fr/88/523001571e33cd204af5959a5387961121f2a1f765d2ea9197190fcdf02778.xls",
            "dataset": "https://www.data.gouv.fr/datasets/election-presidentielle-2007-resultats-572122",
            "page": "https://www.data.gouv.fr/datasets/election-presidentielle-2007-resultats-572122",
            "methode": "Pas de feuille France entière. Somme des lignes communales des feuilles Tour 1 et Tour 2. Le total des voix égale les exprimés. Les pourcentages sont voix/exprimés et voix/inscrits, arrondis au centième (half up) : le fichier ne publie pas le pourcentage national.",
            "file": "2007.xls",
        },
        "2002": {
            "url": "https://static.data.gouv.fr/18/ca642c03c03b775fa08c48d200702048e9c68631e6851ffa34014af8195991.xls",
            "dataset": "https://www.data.gouv.fr/datasets/election-presidentielle-2002-resultats-572114",
            "page": "https://www.data.gouv.fr/datasets/election-presidentielle-2002-resultats-572114",
            "methode": "Feuille « France entière T1T2 » du jeu ministère (pas la somme des communes). Blancs et nuls ne sont pas séparés.",
            "file": "2002-fe.xls",
        },
    }
    for source in sources.values():
        print("fetch", source["file"])
        download(source["url"], CACHE / source["file"])

    tours = []
    tours.append(parse_fe_txt(CACHE / sources["2022t1"]["file"], 2022, 1, sources["2022t1"], official))
    tours.append(parse_fe_txt(CACHE / sources["2022t2"]["file"], 2022, 2, sources["2022t2"], official))
    tours.append(parse_fe_sheet_single(CACHE / sources["2017t1"]["file"], "FE Metro OM Tour 1", 2017, 1, sources["2017t1"], official))
    tours.append(parse_fe_sheet_single(CACHE / sources["2017t2"]["file"], "FE Metro OM Tour 2", 2017, 2, sources["2017t2"], official))
    tours.extend(parse_fe_sheet_both(CACHE / sources["2012"]["file"], 2012, sources["2012"], official))
    tours.append(parse_communes(CACHE / sources["2007"]["file"], "Tour 1", 2007, 1, sources["2007"], official))
    tours.append(parse_communes(CACHE / sources["2007"]["file"], "Tour 2", 2007, 2, sources["2007"], official))
    tours.extend(parse_fe_sheet_both(CACHE / sources["2002"]["file"], 2002, sources["2002"], official))

    for block in tours:
        check(block)
        print(block["annee"], "T"+str(block["tour"]), "candidats", len(block["candidats"]), "exprimes", block["exprimes"])

    payload = {
        "meta": {
            "description": "Résultats présidentiels, France entière, lus dans les fichiers ouverts du ministère de l'Intérieur. Aucun suffrage saisi à la main.",
            "generated_at": "2026-09-23 (Europe/Paris, UTC+2)",
            "consultation": "2026-09-23",
            "scrutins": ["presidentielle"],
            "annees": sorted({block["annee"] for block in tours}),
            "parti_id": "Renseigné pour 2017 et 2022 depuis partis.json (listes du Conseil constitutionnel déjà versées). Pour 2002, 2007 et 2012, uniquement si la même personne est déjà rattachée à un parti dans ce fichier. Jean-Marie Le Pen n'est pas Marine Le Pen. Mélenchon 2012 n'est pas codé LFI.",
            "legislatives": {
                "integre": False,
                "raison": "Les fichiers ouverts des législatives sont au grain circonscription et portent une nuance, pas le code CNCCFP des partis suivis. Sans table officielle nuance → parti, un total national serait reconstruit. Il n'est pas produit.",
            },
            "comparaison_voix_depenses": {
                "graphique": False,
                "raison": "Les comptes annuels de parti ne sont pas les comptes de campagne. Au 2026-09-23, la recherche data.gouv « comptes de campagne présidentielle », ainsi que les variantes 2017 et 2022, renvoie 0 jeu de données. Aucun montant de campagne n'est dans ce fichier.",
                "recherches": [
                    {
                        "q": "comptes de campagne présidentielle",
                        "total": 0,
                        "url": "https://www.data.gouv.fr/datasets?q=comptes%20de%20campagne%20pr%C3%A9sidentielle",
                    },
                    {
                        "q": "comptes de campagne election presidentielle 2022",
                        "total": 0,
                        "url": "https://www.data.gouv.fr/datasets?q=comptes%20de%20campagne%20election%20presidentielle%202022",
                    },
                    {
                        "q": "comptes de campagne election presidentielle 2017",
                        "total": 0,
                        "url": "https://www.data.gouv.fr/datasets?q=comptes%20de%20campagne%20election%20presidentielle%202017",
                    },
                ],
                "pages_cnccfp_non_extraites": [
                    "https://cnccfp.fr/election-presidentielle-2022-publication-des-comptes-de-campagne-des-candidats/",
                    "https://cnccfp.fr/wp-content/uploads/2022/04/De%CC%81cisions_pre%CC%81sidentielle_2017.pdf",
                ],
            },
            "sources": [
                {k: source[k] for k in ("url", "dataset", "page", "methode")}
                for source in sources.values()
            ],
        },
        "tours": sorted(tours, key=lambda item: (item["annee"], item["tour"])),
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print("wrote", OUT_PATH, "tours", len(payload["tours"]))


if __name__ == "__main__":
    main()
