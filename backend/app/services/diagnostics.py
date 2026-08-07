from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from plotly.subplots import make_subplots
import plotly.graph_objects as go


REQUIRED_COLUMNS = [
    "leak_rate",
    "d 13C/12C  Mean",
    "p_no_acid",
    "total_co2",
    "d 18O/16O  Mean",
    "Line",
    "1  Cycle Int  Samp  44",
    "p_gases",
    "Identifier 1",
]


def _ensure_required_columns(df: pd.DataFrame) -> None:
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")


def _marker_symbols(df: pd.DataFrame, standards_path: Optional[str]) -> list[str]:
    symbols = ["circle"] * len(df)
    if standards_path:
        try:
            std = pd.read_csv(standards_path)
            std_list = set(std["Standard"].unique().tolist())
            symbols = [
                "circle-open" if (id1 in std_list) else "circle"
                for id1 in df["Identifier 1"].astype(str)
            ]
        except Exception:
            pass
    return symbols


def create_diagnostic_figure(df: pd.DataFrame, color_param: str, standards_path: Optional[str] = None) -> go.Figure:
    """
    Build the 7x3 diagnostic grid as a Plotly figure.
    Ported/adapted from Legacy code/IRMS_output_analyzer.py::create_diagnostic_plots
    """
    _ensure_required_columns(df)

    if color_param not in df.columns:
        raise ValueError(f"Selected color parameter '{color_param}' is missing from the DataFrame.")

    marker_symbols = _marker_symbols(df, standards_path)
    hover_text = df.get("Identifier 2", pd.Series([None] * len(df)))

    fig = make_subplots(
        rows=7,
        cols=3,
        subplot_titles=(
            "Leak Rate vs δ13C",
            "P no Acid vs δ13C",
            "Total CO2 vs δ13C",
            "Leak Rate vs δ18O",
            "P no Acid vs δ18O",
            "Total CO2 vs δ18O",
            "Leak Rate vs Line",
            "Signal Intensity vs pCO2",
            "Signal Intensity vs δ13C",
            "Signal Intensity vs δ18O",
            "δ13C vs Line",
            "δ18O vs Line",
            "Leak Rate vs pCO2",
            "δ13C vs δ18O",
            "Total CO2 vs Line",
            "Leak Rate vs Signal Intensity",
            "P no Acid vs Leak Rate",
            "P Gasses vs Leak Rate",
            "PCA: Principal Components",
        ),
        vertical_spacing=0.03,
        specs=[
            [{"type": "scatter"}] * 3,
            [{"type": "scatter"}] * 3,
            [{"type": "scatter"}, {"type": "scatter"}, {"type": "box"}],
            [{"type": "scatter"}, {"type": "scatter"}, {"type": "box"}],
            [{"type": "scatter"}] * 3,
            [{"type": "scatter"}] * 3,
            [{"type": "scatter"}] * 3,
        ],
    )

    # Convenience
    c = df[color_param]
    line_col = df["Line"]
    sig = df["1  Cycle Int  Samp  44"]
    d13 = df["d 13C/12C  Mean"]
    d18 = df["d 18O/16O  Mean"]

    # Row 1
    fig.add_trace(
        go.Scatter(x=df["leak_rate"], y=d13, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=True, colorbar=dict(title=color_param, thickness=20, len=0.75, y=0.5, yanchor="middle", x=1.15, xanchor="right")), text=hover_text, hoverinfo="text+x+y"),
        row=1,
        col=1,
    )
    fig.add_trace(
        go.Scatter(x=df["p_no_acid"], y=d13, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"),
        row=1,
        col=2,
    )
    fig.add_trace(
        go.Scatter(x=df["total_co2"], y=d13, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"),
        row=1,
        col=3,
    )

    # Row 2
    fig.add_trace(go.Scatter(x=df["leak_rate"], y=d18, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=2, col=1)
    fig.add_trace(go.Scatter(x=df["p_no_acid"], y=d18, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=2, col=2)
    fig.add_trace(go.Scatter(x=df["total_co2"], y=d18, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=2, col=3)

    # Row 3
    fig.add_trace(go.Box(x=line_col, y=df["leak_rate"]), row=3, col=1)
    fig.add_trace(go.Scatter(x=sig, y=df["total_co2"], mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=3, col=2)

    # Quadratic fit of sig vs total_co2
    x_data = pd.to_numeric(sig, errors="coerce")
    y_data = pd.to_numeric(df["total_co2"], errors="coerce")
    valid = np.isfinite(x_data) & np.isfinite(y_data)
    x_clean = x_data[valid]
    y_clean = y_data[valid]
    if len(x_clean) >= 3:
        coeffs = np.polyfit(x_clean, y_clean, 2)
        x_sorted_idx = np.argsort(x_clean)
        x_sorted = x_clean.iloc[x_sorted_idx]
        y_fit = np.polyval(coeffs, x_sorted)
        fig.add_trace(go.Scatter(x=x_sorted, y=y_fit, mode="lines", name="Quadratic Fit", line=dict(color="red", dash="dash")), row=3, col=2)

    fig.add_trace(go.Scatter(x=sig, y=d13, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=3, col=3)

    # Row 4
    fig.add_trace(go.Scatter(x=sig, y=d18, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=4, col=1)
    fig.add_trace(go.Box(x=line_col, y=d13), row=4, col=2)
    fig.add_trace(go.Box(x=line_col, y=d18), row=4, col=3)

    # Row 5
    fig.add_trace(go.Scatter(x=df["leak_rate"], y=df["total_co2"], mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=5, col=1)
    fig.add_trace(go.Scatter(x=d13, y=d18, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=5, col=2)
    fig.add_trace(go.Box(x=line_col, y=df["total_co2"]), row=5, col=3)

    # Row 6
    fig.add_trace(go.Scatter(x=df["leak_rate"], y=sig, mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=6, col=1)
    fig.add_trace(go.Scatter(x=df["p_no_acid"], y=df["leak_rate"], mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=6, col=2)
    fig.add_trace(go.Scatter(x=df["p_gases"], y=df["leak_rate"], mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text, hoverinfo="text+x+y"), row=6, col=3)

    # Row 7 (placeholder for PCA axes if needed later) - keep empty or reuse scatter
    fig.add_trace(go.Scatter(x=df["leak_rate"], y=df["p_no_acid"], mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text), row=7, col=1)
    fig.add_trace(go.Scatter(x=df["p_gases"], y=df["p_no_acid"], mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text), row=7, col=2)
    fig.add_trace(go.Scatter(x=df["total_co2"], y=df["p_gases"], mode="markers", marker=dict(color=c, colorscale="Viridis", symbol=marker_symbols, showscale=False), text=hover_text), row=7, col=3)

    fig.update_layout(height=1800, showlegend=False, margin=dict(l=40, r=40, t=120, b=40))
    return fig

