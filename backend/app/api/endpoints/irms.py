from __future__ import annotations

import json
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.services.irms_ingest import (
    build_digest,
    generate_job_id,
    parse_information_column,
    read_irms_excel,
)
from app.services.state import get_dataframe_for_job, set_dataframe_for_job
from app.services.diagnostics import create_diagnostic_figure


router = APIRouter()


class ProcessIRMSResponse(BaseModel):
    job_id: str
    digest: dict


@router.post("/process_irms", response_model=ProcessIRMSResponse)
async def process_irms(file: UploadFile = File(...)):
    """Upload and process an IRMS Excel file. Returns a job_id and a quick digest."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Please upload an Excel file (.xlsx/.xls)")

    raw_bytes = await file.read()
    try:
        df = read_irms_excel(raw_bytes, filename=file.filename)
        df = parse_information_column(df)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse Excel: {e}")

    job_id = generate_job_id()
    set_dataframe_for_job(job_id, df)

    digest = build_digest(df)
    return ProcessIRMSResponse(job_id=job_id, digest=digest)


class DiagnosticsRequest(BaseModel):
    job_id: str = Field(..., description="Job ID returned by /process_irms")
    color_param: str = Field(..., description="Column name used for coloring markers")
    identifiers: Optional[List[str]] = Field(None, description="Optional filter for Identifier 1 values")
    d13c_range: Optional[List[float]] = Field(None, description="Optional [min,max] filter for d 13C/12C  Mean")
    d18o_range: Optional[List[float]] = Field(None, description="Optional [min,max] filter for d 18O/16O  Mean")


class DiagnosticsResponse(BaseModel):
    figure: str


@router.post("/diagnostics/figure", response_model=DiagnosticsResponse)
async def diagnostics_figure(payload: DiagnosticsRequest):
    df = get_dataframe_for_job(payload.job_id)
    if df is None:
        raise HTTPException(status_code=404, detail="job_id not found")

    # Apply filters if provided
    filtered = df.copy()

    if payload.identifiers:
        if "Identifier 1" not in filtered.columns:
            raise HTTPException(status_code=400, detail="Data missing 'Identifier 1' column")
        filtered = filtered[filtered["Identifier 1"].isin(payload.identifiers)]

    if payload.d13c_range and len(payload.d13c_range) == 2 and "d 13C/12C  Mean" in filtered.columns:
        lo, hi = payload.d13c_range
        s = pd.to_numeric(filtered["d 13C/12C  Mean"], errors="coerce")
        filtered = filtered[(s >= lo) & (s <= hi)]

    if payload.d18o_range and len(payload.d18o_range) == 2 and "d 18O/16O  Mean" in filtered.columns:
        lo, hi = payload.d18o_range
        s = pd.to_numeric(filtered["d 18O/16O  Mean"], errors="coerce")
        filtered = filtered[(s >= lo) & (s <= hi)]

    try:
        fig = create_diagnostic_figure(
            filtered,
            color_param=payload.color_param,
            standards_path=None,  # set to assets path if available
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to build diagnostics: {e}")

    return DiagnosticsResponse(figure=fig.to_json())
