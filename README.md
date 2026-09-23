# Finances des partis politiques français

Site statique GitHub Pages sur les comptes d’ensemble des partis liés aux présidentielles **2017**, **2022** et **2027** (annonces seulement).

**URL :** https://knoel99.github.io/finances-partis-fr/

Publication : branche `main`, dossier `/docs`.

## Contenu

- `docs/index.html` — graphiques Chart.js (emprunts financiers et dettes au bilan, Total III), point UPR, listes de candidats
- `docs/sources.html` — inventaire des URL et dates de consultation
- `docs/data/*.json` — seules sources de chiffres du site (`partis.json`, `series_dette.json`, `comptes_annuels.json`)

Les graphiques et le tableau UPR chargent ces JSON au navigateur. Aucun montant n’est saisi à la main dans le code des graphiques. Les années absentes d’une série restent vides (`n/a`), elles ne sont pas remplacées par zéro.

## Provenance des données

Producteur : **Commission nationale des comptes de campagne et des financements politiques (CNCCFP)**, diffusés sur [data.gouv.fr — Comptes des partis et groupements politiques](https://www.data.gouv.fr/datasets/comptes-des-partis-et-groupements-politiques) (Licence Ouverte).

| Exercice | Format | Fichier source |
|---|---|---|
| 2024–2021 | CSV | `comptes-partis-exercice-AAAA.csv` |
| 2020–2018 | XLSX | `comptes-partis-exercice-AAAA.xlsx` |
| 2017 | ODS | `comptes-partis-exercice-2017.ods` |

Consultation : **2026-09-23** (Europe/Paris). Les URL exactes sont dans [docs/sources.html](docs/sources.html).

- `debt_eur` / `somme_emprunts_eur` : emprunts financiers (établissements de crédit, personnes physiques, autres partis). En 2017, ancien plan comptable : crédit + « emprunts et dettes financières divers ».
- `debt_total_bilan_III_eur` : total des dettes au passif (Total III), qui inclut aussi fournisseurs et dettes fiscales/sociales. Les deux métriques ne s’additionnent pas.
- Candidats 2017 et 2022 : listes du Conseil constitutionnel. Candidats 2027 : annonces presse ou sites, statut `prévisionnel / non officiel`.

Les comptes de campagne présidentielle ne sont pas extraits dans ces JSON.
