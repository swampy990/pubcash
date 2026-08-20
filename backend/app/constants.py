from decimal import Decimal

# Standard GBP note & coin denominations, keyed by string (used as JSON object keys).
# Values are the face value of each denomination.
GBP_DENOMINATIONS: dict[str, Decimal] = {
    "50.00": Decimal("50.00"),
    "20.00": Decimal("20.00"),
    "10.00": Decimal("10.00"),
    "5.00": Decimal("5.00"),
    "2.00": Decimal("2.00"),
    "1.00": Decimal("1.00"),
    "0.50": Decimal("0.50"),
    "0.20": Decimal("0.20"),
    "0.10": Decimal("0.10"),
    "0.05": Decimal("0.05"),
    "0.02": Decimal("0.02"),
    "0.01": Decimal("0.01"),
}


def compute_breakdown_total(breakdown: dict) -> Decimal:
    """Compute the total cash value from a {denomination: count} breakdown.

    Unknown denomination keys are ignored; negative or non-integer counts are rejected
    by the calling Pydantic schema before this is invoked.
    """
    total = Decimal("0.00")
    for denom_key, count in (breakdown or {}).items():
        face_value = GBP_DENOMINATIONS.get(str(denom_key))
        if face_value is None:
            continue
        total += face_value * int(count)
    return total.quantize(Decimal("0.01"))
