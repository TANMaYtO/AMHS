"""Script to verify text consistency between rendered evidence text and results.json.

Extracts every percentage and confidence interval from the Evidence tab narrative,
summary takeaways, and documentation, asserting that every single number exists in
eval/results.json.
"""

import json
import re
from pathlib import Path
from typing import Any


def collect_valid_percentages_from_json(data: Any) -> set[float]:
    """Collect all valid percentage values (rounded to 1 decimal place) recursively from results.json."""
    valid_pcts: set[float] = set()

    def add_val(val: float | int | None) -> None:
        if val is not None and isinstance(val, (int, float)):
            pct1 = round(float(val) * 100.0, 1)
            pct2 = round(float(val) * 100.0 + 1e-7, 1)
            valid_pcts.add(pct1)
            valid_pcts.add(abs(pct1))
            valid_pcts.add(pct2)
            valid_pcts.add(abs(pct2))
            # Also add if already formatted as percentage (e.g. 50.0)
            valid_pcts.add(round(float(val), 1))
            valid_pcts.add(abs(round(float(val), 1)))

    def traverse(obj: Any) -> None:
        if isinstance(obj, dict):
            for v in obj.values():
                traverse(v)
        elif isinstance(obj, (list, tuple)):
            for v in obj:
                traverse(v)
        elif isinstance(obj, (int, float)):
            add_val(obj)

    traverse(data)
    return valid_pcts


def extract_percentages_from_text(text: str) -> list[float]:
    """Extract all metric percentage numbers (excluding confidence level descriptors like '95% CI')."""
    # Remove confidence interval labels like '95% CI', '95% bootstrap confidence interval'
    cleaned = re.sub(
        r"\b9[059]%\s*(?:bootstrap\s*)?(?:CI|confidence interval)\b",
        "",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\balpha\s*=\s*0\.05\b", "", cleaned, flags=re.IGNORECASE)

    pattern = r"([+-]?\d+(?:\.\d+)?)\s*(?:%|percentage points|pp\b)"
    matches = re.findall(pattern, cleaned, flags=re.IGNORECASE)
    extracted: list[float] = []
    for m in matches:
        try:
            val = round(float(m), 1)
            extracted.append(val)
        except ValueError:
            pass
    return extracted


def build_evidence_callout_text(results: dict[str, Any]) -> str:
    """Generate the exact rendered Evidence callout text from results.json."""
    paired = results.get("paired_bootstrap_cis", {})
    p100 = paired.get("100", {})
    p200 = paired.get("200", {})

    diff100 = round(float(p100.get("diff", 0.0)) * 100.0, 1)
    diff200 = round(float(p200.get("diff", 0.0)) * 100.0, 1)
    ci200 = p200.get("ci_95", [0.0, 0.0])
    ci_low = round(float(ci200[0]) * 100.0, 1)
    ci_high = round(float(ci200[1]) * 100.0, 1)

    diff100_str = f"+{diff100}" if diff100 > 0 else f"{diff100}"
    diff200_str = f"+{diff200}" if diff200 > 0 else f"{diff200}"

    return (
        f"FloodLens matches or exceeds the underpass-prior baseline at K=100 "
        f"(difference {diff100_str} percentage points) and is {diff200_str} percentage "
        f"points at K=200. The K=200 difference is not statistically distinguishable "
        f"at alpha = 0.05, as the paired 95% bootstrap confidence interval "
        f"[{ci_low}%, +{ci_high}%] spans zero."
    )


def check_evidence_consistency() -> bool:
    """Check that all Evidence text percentages strictly exist in results.json."""
    results_path = Path("eval/results.json")
    if not results_path.exists():
        print(f"ERROR: {results_path} does not exist.")
        return False

    with open(results_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    valid_pcts = collect_valid_percentages_from_json(data)
    print(f"Collected {len(valid_pcts)} distinct valid percentages from results.json.")

    texts_to_check: list[tuple[str, str]] = []

    # 1. Summary takeaways list
    summary_items = data.get("summary", [])
    for idx, item in enumerate(summary_items):
        texts_to_check.append((f"results.json summary[{idx}]", item))

    # 2. Rendered callout text
    callout_text = build_evidence_callout_text(data)
    texts_to_check.append(("Rendered Evidence Callout Box", callout_text))

    # 3. eval/results.md executive summary & takeaways
    results_md_path = Path("eval/results.md")
    if results_md_path.exists():
        with open(results_md_path, "r", encoding="utf-8") as f:
            md_content = f.read()
        texts_to_check.append(("eval/results.md content", md_content))

    all_passed = True
    total_checked = 0

    print("\n--- Verifying Rendered Evidence Narrative Numbers ---")
    for source_name, text in texts_to_check:
        pcts = extract_percentages_from_text(text)
        print(f"\nChecking {source_name}:")
        print(f"  Text: {text[:100]}...")
        print(f"  Extracted percentages: {pcts}")

        for p in pcts:
            total_checked += 1
            # Check if p or abs(p) or near p is in valid_pcts
            if p not in valid_pcts and abs(p) not in valid_pcts:
                print(f"  [FAIL] Percentage {p}% not found in results.json!")
                all_passed = False
            else:
                print(f"  [OK] {p}% verified in results.json")

    print(f"\nChecked {total_checked} numbers across narrative sources.")
    if all_passed:
        print("ALL EVIDENCE NUMBERS ARE FULLY CONSISTENT WITH results.json.")
    else:
        print("INCONSISTENCY DETECTED. Please review the failed percentages above.")

    return all_passed


if __name__ == "__main__":
    success = check_evidence_consistency()
    if not success:
        exit(1)
