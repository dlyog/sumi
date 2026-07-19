from __future__ import annotations

import hashlib
import math
import re


def _fallback_score(smiles: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9@+\-\[\]\(\)=#$\\/%.]+", smiles) or "-" in smiles:
        return {"valid": False, "error": "Invalid SMILES; could not parse molecule."}
    atoms = re.findall(r"Cl|Br|[CNOSPFIcnosp]", smiles)
    if not atoms:
        return {"valid": False, "error": "Invalid SMILES; no supported atoms found."}
    hetero = sum(1 for atom in atoms if atom.upper() not in {"C", "CL", "BR", "I"})
    rings = sum(ch.isdigit() for ch in smiles) // 2
    digest = int(hashlib.sha256(smiles.encode()).hexdigest()[:8], 16)
    qed = max(0.05, min(0.95, 0.38 + 0.035 * hetero + 0.025 * rings - 0.004 * max(len(atoms) - 24, 0)))
    sa_score = max(1.0, min(10.0, 1.6 + 0.055 * len(atoms) + 0.28 * rings + (digest % 9) / 20))
    tox_alerts = len(re.findall(r"N\(=O\)=O|NO2|Cl|Br|I", smiles))
    lipinski_pass = len(atoms) <= 70 and hetero <= 20
    binding = max(0.0, min(1.0, 0.45 + 0.02 * rings + 0.015 * hetero - 0.01 * tox_alerts))
    convergence = [round(-binding * (1 - math.exp(-step / 2.6)), 5) for step in range(12)]
    mw = round(len(atoms) * 12.5 + hetero * 2.0, 2)
    logp = round(max(-1.0, min(6.0, len(atoms) / 12 - hetero / 8)), 3)
    donors = min(hetero, 5)
    acceptors = hetero
    lipinski = _lipinski_rules(mw, logp, donors, acceptors)
    return {
        "valid": True,
        "qed": round(qed, 4),
        "sa_score": round(sa_score, 3),
        "tox_alerts": tox_alerts,
        "lipinski_pass": lipinski_pass,
        "lipinski": lipinski,
        "binding": round(binding, 4),
        "convergence": convergence,
        "descriptors": {"mw": mw, "logp": logp, "donors": donors, "acceptors": acceptors, "rotatable": 0},
        "educational_banner": "Educational / not for clinical use.",
    }


def _lipinski_rules(mw: float, logp: float, donors: int, acceptors: int) -> dict:
    return {
        "molecular_weight": {"label": "MW", "value": round(mw, 2), "limit": "<= 500 Da", "pass": mw <= 500},
        "logp": {"label": "LogP", "value": round(logp, 3), "limit": "<= 5", "pass": logp <= 5},
        "h_bond_donors": {"label": "HBD", "value": donors, "limit": "<= 5", "pass": donors <= 5},
        "h_bond_acceptors": {"label": "HBA", "value": acceptors, "limit": "<= 10", "pass": acceptors <= 10},
    }


def score_molecule(smiles: str) -> dict:
    """Score a SMILES string deterministically for the teaching scorecard.

    RDKit is used when available. A deterministic parser fallback keeps the local
    demo usable on fresh Macs before scientific wheels are installed.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import Crippen, Descriptors, Lipinski, QED
        from rdkit.Chem.Draw import rdMolDraw2D
    except Exception:
        return _fallback_score(smiles)

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {"valid": False, "error": "Invalid SMILES; could not parse molecule."}
    qed = float(QED.qed(mol))
    mw = float(Descriptors.MolWt(mol))
    logp = float(Crippen.MolLogP(mol))
    donors = int(Lipinski.NumHDonors(mol))
    acceptors = int(Lipinski.NumHAcceptors(mol))
    rotatable = int(Lipinski.NumRotatableBonds(mol))
    rings = int(Lipinski.RingCount(mol))
    sa_score = max(1.0, min(10.0, 1.0 + 0.012 * mw + 0.18 * rings + 0.08 * rotatable))
    tox_alerts = len(mol.GetSubstructMatches(Chem.MolFromSmarts("[N+](=O)[O-]") or mol))
    lipinski_pass = mw <= 500 and logp <= 5 and donors <= 5 and acceptors <= 10
    lipinski = _lipinski_rules(mw, logp, donors, acceptors)
    binding = 1 / (1 + math.exp(-(0.8 * qed + 0.04 * rings + 0.02 * acceptors - 0.1 * tox_alerts)))
    convergence = [round(-binding * (1 - math.exp(-step / 2.6)), 5) for step in range(12)]
    drawer = rdMolDraw2D.MolDraw2DSVG(480, 300)
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return {
        "valid": True,
        "qed": round(qed, 4),
        "sa_score": round(sa_score, 3),
        "tox_alerts": int(tox_alerts),
        "lipinski_pass": bool(lipinski_pass),
        "lipinski": lipinski,
        "binding": round(binding, 4),
        "convergence": convergence,
        "molecule_svg": drawer.GetDrawingText(),
        "descriptors": {"mw": round(mw, 2), "logp": round(logp, 3), "donors": donors, "acceptors": acceptors, "rotatable": rotatable},
        "educational_banner": "Educational / not for clinical use.",
    }
