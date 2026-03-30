"""
Molecule Name Normalizer
========================
Strips salt forms, normalises casing, and handles combination drug separators
so that "Metformin HCl", "metformin hydrochloride", and "METFORMIN" all resolve
to the same canonical name before any database lookup.

Adapted from Pharmozi/molecule_normalizer.py.
"""

import re
from typing import List, Optional, Set, Tuple

# ─────────────────────────────────────────────────────────────
# Salt forms and suffixes to strip before matching
# ─────────────────────────────────────────────────────────────

SALT_FORMS = [
    r'\s*hydrochloride\b', r'\s*hcl\b', r'\s*hydro\s*chloride\b',
    r'\s*sodium\b', r'\s*na\b(?!\w)',
    r'\s*maleate\b', r'\s*tartrate\b', r'\s*fumarate\b',
    r'\s*besylate\b', r'\s*besilate\b', r'\s*succinate\b',
    r'\s*acetate\b', r'\s*phosphate\b', r'\s*sulfate\b',
    r'\s*sulphate\b', r'\s*citrate\b', r'\s*mesylate\b',
    r'\s*mesilate\b', r'\s*propanediol\b',
    r'\s*monohydrate\b', r'\s*dihydrate\b', r'\s*trihydrate\b',
    r'\s*hemihydrate\b', r'\s*anhydrous\b',
    r'\s*base\b', r'\s*free\s*base\b',
    r'\s*bromide\b', r'\s*chloride\b', r'\s*iodide\b',
    r'\s*nitrate\b', r'\s*oxide\b', r'\s*carbonate\b',
    r'\s*bicarbonate\b', r'\s*gluconate\b', r'\s*lactate\b',
    r'\s*malate\b', r'\s*stearate\b', r'\s*palmitate\b',
    r'\s*propionate\b', r'\s*valerate\b', r'\s*butyrate\b',
    r'\s*benzoate\b', r'\s*salicylate\b', r'\s*tosylate\b',
    r'\s*tosilate\b', r'\s*ethanolate\b',
    r'\s*potassium\b', r'\s*calcium\b', r'\s*magnesium\b',
    r'\s*aluminum\b', r'\s*aluminium\b', r'\s*zinc\b', r'\s*iron\b',
    r'\s*\(as\s+[^)]+\)',  # e.g. "(as propanediol H2O)"
]

# Separators that indicate a combination drug
COMBINATION_SEPARATORS = [
    r'\s*/\s*',
    r'\s*\+\s*',
    r'\s*&\s*',
    r'\s+AND\s+',
    r'\s*,\s*',
    r'\s*;\s*',
]


# ─────────────────────────────────────────────────────────────
# Core normalisation
# ─────────────────────────────────────────────────────────────

def strip_salt_forms(molecule_name: str) -> str:
    """Remove salt/hydrate suffixes and return uppercase base name."""
    if not molecule_name:
        return ""
    cleaned = molecule_name.strip().upper()
    for pattern in SALT_FORMS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", cleaned).strip()


def normalize_combination(text: str) -> str:
    """
    Normalise any combination separator to ' + '.
    'Dapagliflozin/Metformin' → 'DAPAGLIFLOZIN + METFORMIN'
    """
    if not text:
        return ""
    text_upper = text.strip().upper()
    for sep in COMBINATION_SEPARATORS:
        text_upper = re.sub(sep, " + ", text_upper, flags=re.IGNORECASE)
    text_upper = re.sub(r"\s*\+\s*\+\s*", " + ", text_upper)
    return re.sub(r"\s+", " ", text_upper).strip()


def split_combination(text: str) -> List[str]:
    """Split a combination string into its constituent molecule names."""
    normalized = normalize_combination(text)
    if " + " in normalized:
        parts = [p.strip() for p in normalized.split(" + ") if p.strip()]
        seen: Set[str] = set()
        unique = []
        for p in parts:
            if p not in seen:
                seen.add(p)
                unique.append(p)
        return unique
    return [normalized] if normalized else []


def is_combination(text: str) -> bool:
    """Return True if the text contains a combination separator."""
    if not text:
        return False
    for sep in COMBINATION_SEPARATORS:
        if re.search(sep, text, flags=re.IGNORECASE):
            return True
    return False


# ─────────────────────────────────────────────────────────────
# IQVIA matching helpers
# ─────────────────────────────────────────────────────────────

def build_normalized_lookup(known_molecules: Set[str]) -> dict:
    """
    Build a dict mapping salt-stripped names back to their IQVIA canonical names.
    Allows 'SERTRALINE HYDROCHLORIDE' to resolve to 'SERTRALINE'.
    """
    lookup = {}
    for molecule in known_molecules:
        normalized = strip_salt_forms(molecule)
        if normalized not in lookup:
            lookup[normalized] = molecule
    return lookup


def find_best_molecule_match(
    candidate: str,
    known_molecules: Set[str],
    normalized_lookup: Optional[dict] = None,
) -> Tuple[Optional[str], str]:
    """
    Try exact match first, then salt-stripped match.
    Returns (matched_name_or_None, match_type).
    match_type: 'exact' | 'normalized' | 'none'
    """
    candidate_upper = candidate.strip().upper()

    if candidate_upper in known_molecules:
        return candidate_upper, "exact"

    candidate_normalized = strip_salt_forms(candidate_upper)
    if candidate_normalized in known_molecules:
        return candidate_normalized, "normalized"

    if normalized_lookup and candidate_normalized in normalized_lookup:
        return normalized_lookup[candidate_normalized], "normalized"

    return None, "none"


def find_combination_match(
    candidate: str,
    known_molecules: Set[str],
) -> Tuple[Optional[str], List[str]]:
    """
    Try to match a combination string to IQVIA.
    Tries original order, alphabetical order, and reversed order.
    Returns (combination_match_or_None, list_of_individual_matches).
    """
    parts = split_combination(candidate)
    parts_cleaned = [strip_salt_forms(p) for p in parts]

    for ordered in [parts_cleaned, sorted(parts_cleaned), list(reversed(parts_cleaned))]:
        candidate_combo = " + ".join(ordered)
        if candidate_combo in known_molecules:
            return candidate_combo, []

    individual_matches = [p for p in parts_cleaned if p in known_molecules]
    return None, individual_matches


# ─────────────────────────────────────────────────────────────
# PDF / document molecule extraction
# ─────────────────────────────────────────────────────────────

def smart_molecule_search(
    extracted_text: str,
    known_molecules: Set[str],
) -> Tuple[List[str], dict]:
    """
    Three-pass molecule search over raw extracted text.

    Pass 1 — exact word-boundary match against every IQVIA molecule.
    Pass 2 — combination detection (Drug/Drug, Drug+Drug, Drug AND Drug).
    Pass 3 — salt form stripping (SERTRALINE HYDROCHLORIDE → SERTRALINE).

    Returns:
        found_molecules : deduplicated list of IQVIA canonical molecule names
        contexts        : {molecule: snippet of surrounding text}
    """
    found: List[str] = []
    contexts: dict = {}
    matched: Set[str] = set()

    text_upper = extracted_text.upper()
    normalized_lookup = build_normalized_lookup(known_molecules)

    # Pass 1: exact matches
    for molecule in known_molecules:
        escaped = re.escape(molecule)
        if re.search(rf'\b{escaped}\b', text_upper):
            if molecule not in matched:
                found.append(molecule)
                matched.add(molecule)
                m = re.search(rf'.{{0,50}}{escaped}.{{0,50}}', text_upper)
                if m:
                    contexts[molecule] = m.group(0).strip()

    # Pass 2: combination patterns
    combo_patterns = [
        r'([A-Z][A-Z0-9\-]+)\s*/\s*([A-Z][A-Z0-9\-]+)',
        r'([A-Z][A-Z0-9\-]+)\s*\+\s*([A-Z][A-Z0-9\-]+)',
        r'([A-Z][A-Z0-9\-]+)\s+AND\s+([A-Z][A-Z0-9\-]+)',
        r'([A-Z][A-Z0-9\-]+)\s*&\s*([A-Z][A-Z0-9\-]+)',
    ]
    for pattern in combo_patterns:
        for m in re.finditer(pattern, text_upper):
            original = m.group(0)
            combo_match, individual_matches = find_combination_match(original, known_molecules)
            if combo_match and combo_match not in matched:
                found.append(combo_match)
                matched.add(combo_match)
                for part in split_combination(combo_match):
                    matched.add(part)
                contexts[combo_match] = original
            elif individual_matches:
                for mol in individual_matches:
                    if mol not in matched:
                        found.append(mol)
                        matched.add(mol)
                        contexts[mol] = original

    # Pass 3: salt form stripping
    salt_pattern = (
        r'\b([A-Z][A-Z0-9\-]+(?:\s+(?:HYDROCHLORIDE|HCL|SODIUM|MALEATE|'
        r'TARTRATE|FUMARATE|BESYLATE|SUCCINATE|ACETATE|PHOSPHATE|SULFATE|'
        r'CITRATE|MESYLATE))?)\b'
    )
    for m in re.finditer(salt_pattern, text_upper):
        candidate = m.group(1)
        normalized = strip_salt_forms(candidate)
        if normalized in matched or len(normalized) < 4:
            continue
        if normalized in known_molecules:
            found.append(normalized)
            matched.add(normalized)
            contexts[normalized] = candidate
        elif normalized in normalized_lookup:
            original = normalized_lookup[normalized]
            if original not in matched:
                found.append(original)
                matched.add(original)
                contexts[original] = candidate

    return found, contexts
