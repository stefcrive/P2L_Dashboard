from __future__ import annotations

import io
import re
import uuid
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd


def generate_job_id() -> str:
    return uuid.uuid4().hex


def read_irms_excel(
    file_bytes: bytes, sheet_name: Optional[str] = None, filename: Optional[str] = None
) -> pd.DataFrame:
    """
    Read an IRMS Excel file into a DataFrame. Attempts openpyxl, falls back to xlrd.
    """
    bio = io.BytesIO(file_bytes)
    # Choose engine based on filename extension if available
    engine: Optional[str] = None
    if filename:
        lower = filename.lower()
        if lower.endswith((".xlsx", ".xlsm", ".xltx", ".xltm")):
            engine = "openpyxl"
        elif lower.endswith(".xls"):
            engine = "xlrd"

    # Try selected engine, fall back to other common engine
    try:
        if engine:
            df = pd.read_excel(bio, sheet_name=sheet_name, engine=engine)
        else:
            df = pd.read_excel(bio, sheet_name=sheet_name)
    except Exception:
        bio.seek(0)
        alt_engine = "xlrd" if engine == "openpyxl" else "openpyxl"
        df = pd.read_excel(bio, sheet_name=sheet_name, engine=alt_engine)

    # Ensure expected text columns are str where needed (avoid mixed dtypes)
    for col in [
        "Information",
        "Identifier 1",
        "Identifier 2",
        "Comment",
    ]:
        if col in df.columns:
            df[col] = df[col].astype("string").astype("object")

    return df


def parse_information_column(df: pd.DataFrame) -> pd.DataFrame:
    """
    Parse the legacy IRMS 'Information' column to extract numeric fields.

    Adds columns: acid_temp, leak_rate, p_no_acid, p_gases, total_co2, co2_after_exp,
    left_mbar, right_mbar, left_pos, right_pos, vm1_after_transfer

    Ported from Legacy code/IRMS_output_analyzer.py: extract_info_values
    """
    if "Information" not in df.columns:
        return df

    # Initialize new columns
    for col in [
        "acid_temp",
        "leak_rate",
        "p_no_acid",
        "p_gases",
        "total_co2",
        "co2_after_exp",
        "left_mbar",
        "right_mbar",
        "left_pos",
        "right_pos",
        "vm1_after_transfer",
    ]:
        if col not in df.columns:
            df[col] = np.nan

    patterns = {
        "acid_temp": r"Acid:\s*([\d.]+)",
        "leak_rate": r"LeakRate.*?:\s*([\d.]+)",
        "p_no_acid": r"P no Acid\s*:\s*([\d.]+)",
        "p_gases": r"P gases:\s*([\d.]+)",
        "total_co2": r"Total CO2\s*:\s*([\d.]+)",
        "co2_after_exp": r"CO2 after Exp\.:\s*([\d.]+)",
        "left_mbar": r"RefRe skipped: L mBar\s*([\d.]+)",
        "right_mbar": r"RefRe skipped: R mBar\s*([\d.]+)",
        "left_pos": r"L.*?Pos\s*([\d.]+)",
        "right_pos": r"R.*?Pos\s*([\d.]+)",
        "vm1_after_transfer": r"VM1 aftr Trfr\.:\s*([-\d.]+)",
    }

    for idx, info in df["Information"].fillna("").astype(str).items():
        for col, pattern in patterns.items():
            m = re.search(pattern, info)
            if m:
                try:
                    df.at[idx, col] = float(m.group(1))
                except ValueError:
                    # Leave as NaN on parse errors
                    pass
    # Coerce key numeric columns
    _coerce_numeric_columns(df)
    return df


def build_digest(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Produce a lightweight summary digest of the IRMS dataset.
    """
    digest: Dict[str, Any] = {
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": list(map(str, df.columns.tolist())),
    }

    # Identifier breakdown
    if {"Identifier 1", "Identifier 2"}.issubset(df.columns):
        grp = df.groupby("Identifier 1").agg(
            unique_samples=("Identifier 2", "nunique"),
            total_measurements=("Identifier 1", "count"),
        )
        digest["identifiers"] = (
            grp.reset_index()
            .sort_values("total_measurements", ascending=False)
            .to_dict(orient="records")
        )

    # Numeric ranges (only if present)
    range_cols = [
        "d 13C/12C  Mean",
        "d 18O/16O  Mean",
        "1  Cycle Int  Samp  44",
        "leak_rate",
        "p_no_acid",
        "p_gases",
        "total_co2",
    ]
    ranges: Dict[str, Dict[str, Optional[float]]] = {}
    for col in range_cols:
        if col in df.columns:
            s = pd.to_numeric(df[col], errors="coerce")
            if s.notna().any():
                ranges[col] = {
                    "min": float(np.nanmin(s.values)),
                    "max": float(np.nanmax(s.values)),
                }
    if ranges:
        digest["ranges"] = ranges

    return digest


def _coerce_numeric_columns(df: pd.DataFrame) -> None:
    num_cols = [
        "d 13C/12C  Mean",
        "d 18O/16O  Mean",
        "1  Cycle Int  Samp  44",
        "leak_rate",
        "p_no_acid",
        "p_gases",
        "total_co2",
        "Line",
        "co2_after_exp",
        "acid_temp",
        "left_mbar",
        "right_mbar",
        "left_pos",
        "right_pos",
        "vm1_after_transfer",
    ]
    for col in num_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
