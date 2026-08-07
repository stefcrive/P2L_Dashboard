from __future__ import annotations

from typing import Dict, Optional

import pandas as pd


_STATE: Dict[str, pd.DataFrame] = {}


def set_dataframe_for_job(job_id: str, df: pd.DataFrame) -> None:
    _STATE[job_id] = df


def get_dataframe_for_job(job_id: str) -> Optional[pd.DataFrame]:
    return _STATE.get(job_id)


def has_job(job_id: str) -> bool:
    return job_id in _STATE


def clear_job(job_id: str) -> None:
    _STATE.pop(job_id, None)

