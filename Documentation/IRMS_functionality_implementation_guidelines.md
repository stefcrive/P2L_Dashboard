# IRMS Output Analyzer → Next.js + FastAPI

This is the single source of truth for migrating and operating the IRMS Output Analyzer as a FastAPI backend with a Next.js (TS) frontend. It merges and reconciles the two previous docs ("Guide" and "Codex") without losing any detail.

---

## 1) Scope & Goals

* Preserve all Streamlit functionality (diagnostics, calibration, processing, charts, Excel export) while moving to a typed API + React UI.
* Production‑ready: explicit routes, request/response models, streaming exports, and a transient `job_id` state layer for multi-user sessions.
* Clear UI contracts for each feature; front/back responsibilities spelled out.

---

## 2) High‑Level Architecture

* **Monorepo suggestion**

  * `apps/web` → Next.js (TypeScript) frontend (React, Tailwind/shadcn, react-query, axios, react-plotly)
  * `apps/api` → FastAPI backend (routers under `app/api/v1`, services under `app/services`)
  * `packages/shared` → shared types (TS) and schemas (OpenAPI/JSON Schema)
* **State**: in-memory (or Redis) `job_id → DataFrame` mapping with `get_dataframe_for_job`, `set_dataframe_for_job`.
* **Persistence**: initial versions can avoid DB; if needed, use Postgres for uploads metadata and audits.
* **Files**: Excel uploads parsed server-side; standards CSV read-only (`standards.csv`).

---

## 3) Data & Domains

* **Core columns** (examples): `Date`, `Line`, `Identifier 1`, `Identifier 2`, `Comment`, `d 13C/12C  Mean`, `d 18O/16O  Mean`, `1  Cycle Int  Samp  44`, `Information`, `leak_rate`, `p_no_acid`, `total_co2`, `p_gases`.
* **Derived**: `Date_ordinal`, sequence index, masks for ranges (signal/leak/d13c/d18o), statistical outliers mask.
* **Calibration outputs**: `d13C_calibrated`, `d18O_calibrated` (single-point / double-point).

---

## 4) API Surface (FastAPI, prefix `/irms`)

All endpoints expect/return JSON unless noted.

### 4.1 Upload / Initialize (existing)

* `POST /irms/process_irms` (kept from current router). Returns a `job_id` and basic summary. Stores raw DataFrame in state.

### 4.2 Diagnostics

* `POST /irms/diagnostics/figure`

  * **Request** `{ job_id: string, color_param: string, identifiers?: string[], d13c_range?: [number,number], d18o_range?: [number,number] }`
  * **Response** `{ figure: string }` where `figure` is Plotly figure JSON representing a **7×3 grid** (see §6).

### 4.3 Calibration

* `POST /irms/calibrate`

  * **Request** `{ job_id: string, selected_standards: string[], outlier_method: 'Z-Score'|'IQR', sigma_level: number=1.0, iqr_multiplier: number=1.5, color_param: string }`
  * **Flow**: filter standards outliers → build calibration plots JSON → apply single or double anchor calibration → persist calibrated DataFrame to state.
  * **Response** `{ figures: string | object, columns: string[] }` where `figures` is Plotly JSON for before/after and anchor fits.

### 4.4 Processing (Filters, Outliers, Summaries)

* `POST /irms/process`

  * **Request** `{ job_id, color_param, signal_range:[lo,hi], leak_range:[lo,hi], d13c_range:[lo,hi], d18o_range:[lo,hi], sigma_level:number=4.0, include_outliers:boolean=false }`
  * **Response** `{ stats, figures }` with high-level counts, outliers breakdown, and species/identifier summary figures.

### 4.5 Summary Charts (alt path)

* `GET /irms/summary-charts/{job_id}?selected_identifier=…&color_param=…&x_axis_option=…&sigma_level=…&show_statistical_outliers=bool&show_range_outliers=bool`

  * Returns multiple Plotly charts keyed by name (JSON strings) for the summary view.

### 4.6 Export

* `POST /irms/export` → Excel download

  * **Request** `{ job_id: string, include_outliers: boolean=false, selected_standards?: string[] }`
  * **Response**: `StreamingResponse` with header `Content-Disposition: attachment; filename="<generated>.xlsx"`

---

## 5) Backend Services (Implementations)

* `services/state.py`: `get_dataframe_for_job(job_id)`, `set_dataframe_for_job(job_id, df)`
* `services/diagnostics.py`: `build_diagnostic_figure_json(df, color_param)` (7×3 grid), optional PCA loader
* `services/calibration.py`:

  * `filter_standards_outliers(df, selected_standards, outlier_method, sigma_level, iqr_multiplier)`
  * `build_calibration_plots_json(standards_df, filtered_df, selected_standards, color_param)`
  * `calibrate_results(standards_df, full_df, selected_standards)` → adds `d13C_calibrated`, `d18O_calibrated`
* `services/processing.py`:

  * `add_sequence(df)`, `build_range_masks(df, signal_range, leak_range, d13c_range, d18o_range)`
  * `build_statistical_outliers(df, sigma_level)` (grouped by `Identifier 1`)
  * `summarize_outlier_counts(df, masks, stat_mask)`
  * `build_species_summary_figures(df, color_param, show_stat_outliers, show_range_outliers, ranges)`
* `services/export.py`:

  * `build_export_excel_bytes(main_data, outliers_df, selected_standards)` → builds multi-sheet XLSX and returns bytes
  * `generate_filename(selected_ids, include_outliers)` → `dataset_ID…_{with|without}_outliers.xlsx`

---

## 6) Diagnostics Plot Spec (7×3 Grid)

**Rows** (typical x → y; adapt as needed):

1. `leak_rate → δ13C`, `p_no_acid → δ13C`, `total_co2 → δ13C`
2. `leak_rate → δ18O`, `p_no_acid → δ18O`, `total_co2 → δ18O`
3. `Line → leak_rate` (box), `signal → total_co2` (with quadratic fit), box
4. Signal/intensity vs δ13C/δ18O boxes
   5–6. Isotope vs Line; `leak_rate vs pCO2`; `δ13C vs δ18O`
5. PCA (2D components + loadings)

**Builder contract**: returns a single Plotly figure JSON; validates required columns; supports `color_param`; optional marker symbol for standards.

---

## 7) Outliers & Masks

* **Range masks** built from slider inputs: `signal`, `leak`, `d13c`, `d18o`.
* **Statistical outliers**: per‑group (e.g., by `Identifier 1`) using σ thresholds independently on `d 13C/12C  Mean` and `d 18O/16O  Mean`.
* **Include/Exclude logic**: if `include_outliers=false`, intersect all range masks and invert `stat_mask`.
* **Summaries**: count per category (Statistical / Range / other) and percentage of total.

---

## 8) Calibration System

* **Supported**: Single‑anchor and Double‑anchor.
* **True values**: read from `standards.csv` by `(Standard, Isotopic_Value_Type)`.
* **Single‑point formula** (concept): scale raw sample relative to anchor; **Double‑point**: linear map between two raw anchors to true anchors.
* **Outputs**: new columns `d13C_calibrated`, `d18O_calibrated` added to the working DataFrame.

---

## 9) Excel Export Spec

Generates a multi‑sheet workbook:

* **Statistics**: totals; outliers by category with counts and % of total.
* **Data**: main (filtered or full) dataset.
* **Outliers – <Category>**: one sheet per category (truncate name ≤31 chars).
* **Standards Measurements**: raw rows where `Identifier 1 ∈ selected_standards`.
* **Standards Results**: per‑standard precision/average for δ13C and δ18O plus sample count (and optional notes: calibration type, standards used).

**Filename**

* If small selection: `dataset_ID<joined>_{with|without}_outliers.xlsx`
* If many IDs: `dataset_ID<N>selected_{with|without}_outliers.xlsx`

**Streaming**: Excel returned as `StreamingResponse` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).

---

## 10) Frontend Integration Checklist (Next.js)

* **Upload**: drag‑and‑drop (react-dropzone), progress bar, post to `/irms/process_irms`, show basic stats.
* **Diagnostics dashboard**: controls for `color_param`, δ sliders, Identifier multi-select; render 7×3 Plotly figure (react-plotly.js).
* **Calibration tab**: multiselect standards; outlier method (Z‑Score/IQR) with σ/IQR params; render calibration figures; apply & persist calibration.
* **Processing**: range sliders (signal/leak/δ13C/δ18O), statistical σ, toggles to show/hide outliers; display summary figures and counts.
* **Charts**: alternative summary charts route supports x‑axis options and outlier overlays.
* **Export**: options for include outliers & standards list; hit `/irms/export` and trigger browser download.
* **Data fetching**: `@tanstack/react-query` for caching; `axios` for typed requests; optimistic UI on tab switches using `job_id`.

---

## 11) Dependencies

**Backend (Python)**: FastAPI, Uvicorn, Pandas, NumPy, Plotly, SciPy, scikit‑learn, openpyxl/xlrd/xlsxwriter, Pydantic v2, python‑multipart.

**Frontend (Next.js)**: `@plotly/plotly.js`, `react-plotly.js`, `@tanstack/react-query`, `axios`, `react-dropzone`, Radix UI sliders/select, `lucide-react`, Tailwind/shadcn.

---

## 12) Edge Cases & Gotchas

* **δ columns**: ensure proper encoding/column names (`d 13C/12C  Mean`, `d 18O/16O  Mean`). Guard for missing columns.
* **Zero/NaN handling**: coerce numeric, handle divide-by-zero in calibration; NaNs propagate in calibrated cols.
* **Excel engines**: attempt `openpyxl`, fallback to `xlrd`.
* **PCA stability**: require sufficient rows and non‑NaN features; standardize before PCA.
* **Excel limits**: sheet name ≤31 chars; sanitize names.

---

## 13) Security, Performance, Testing

* **Security**: validate inputs via Pydantic; limit upload sizes; sanitize filename generation.
* **Performance**: vectorize Pandas ops; avoid copying large frames unnecessarily; consider Redis for `job_id` state in multi-user deployments.
* **Testing**: unit tests for masks/outliers/calibration; API tests for each route; golden files for Excel bytes (hash size + sheet names); snapshot tests for Plotly JSON schema.

---

## 14) Directory Layout (backend)

```
apps/api/app/
  api/v1/
    router.py           # includes /process_irms and mounts subrouters
    diagnostics.py      # /irms/diagnostics/figure
    calibration.py      # /irms/calibrate
    processing.py       # /irms/process
    export.py           # /irms/export
  services/
    state.py
    diagnostics.py
    calibration.py
    processing.py
    export.py
  assets/
    standards.csv
```

---

## 15) Streamlit → API Alignment Map

* **Diagnostics tab** → `/irms/diagnostics/figure` (7×3 Plotly JSON) + alt `/irms/summary-charts`.
* **Calibration tab** → `/irms/calibrate` (figures + state update).
* **Processing tab** → `/irms/process` (stats + figures) and `/irms/export` (streamed workbook).

---

## 16) Example Payloads

**Diagnostics**

```json
{
  "job_id": "abc123",
  "color_param": "Identifier 1",
  "identifiers": ["STD1","STD2"],
  "d13c_range": [-5, 5],
  "d18o_range": [-5, 5]
}
```

**Calibration**

```json
{
  "job_id": "abc123",
  "selected_standards": ["NBS-19", "L-SVEC"],
  "outlier_method": "Z-Score",
  "sigma_level": 1.0,
  "iqr_multiplier": 1.5,
  "color_param": "Identifier 1"
}
```

**Processing**

```json
{
  "job_id": "abc123",
  "color_param": "Identifier 1",
  "signal_range": [1000, 4000],
  "leak_range": [0, 0.2],
  "d13c_range": [-8, 2],
  "d18o_range": [-10, 0],
  "sigma_level": 4.0,
  "include_outliers": false
}
```

**Export**

```json
{
  "job_id": "abc123",
  "include_outliers": false,
  "selected_standards": ["NBS-19", "L-SVEC"]
}
```

---

## 17) Implementation Notes

* Use `make_subplots(rows=7, cols=3)` for diagnostics; tune `vertical_spacing` (\~0.03) and provide informative `subplot_titles`.
* Plotly JSON: return `fig.to_json()` server-side, pass as string to `react-plotly.js`.
* For summary charts, provide toggles to overlay range/statistical outliers (dotted markers) and annotate masks.
* Calibration plotting should display anchors, fit line, before/after scatter; include legend entries for selected standards.
* Excel writer: XlsxWriter preferred; remember to `seek(0)` before returning bytes.

---

## 18) Roadmap (nice-to-have)

* Add persisted sessions (DB or object storage) and background jobs for large files.
* Add OpenAPI client generation to type responses in Next.js.
* Add role-based auth (e.g., clerk/auth.js on frontend; JWT on FastAPI).
* Add downloadable PNG/PDF exports of charts.

---

---

## 19) Annotated Code Samples + Legacy References

Below are concise, production‑oriented code samples for each feature, plus pointers to the exact **legacy Streamlit** functions (name + line numbers) you’ll want to compare against during review.

### 19.1 Upload / Initialize

**FastAPI route (returns `job_id`)**

```python
# app/api/v1/router.py
from fastapi import APIRouter, UploadFile, File, HTTPException
from ..services import state
import pandas as pd

router = APIRouter(prefix="/irms")

@router.post("/process_irms")
def process_irms(file: UploadFile = File(...)):
    try:
        # try multiple engines (openpyxl → xlrd) similar to legacy
        try:
            df = pd.read_excel(file.file, engine="openpyxl")
        except Exception:
            df = pd.read_excel(file.file, engine="xlrd")
        df = df.convert_dtypes().reset_index(drop=True)
        df = df.map(lambda x: None if pd.isna(x) else x)
        # date ordinal like legacy
        df["Date"] = pd.to_datetime(df["Date"], format="%m/%d/%y", errors="coerce")
        df["Date_ordinal"] = pd.to_numeric(df["Date"].map(lambda x: x.toordinal() if pd.notnull(x) else None))
        # parse Information
        from ..services.parsing import extract_info_values
        df = extract_info_values(df)
        job_id = state.set_dataframe_for_job(df)
        return {"job_id": job_id, "rows": int(len(df))}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
```

**Legacy references:** `extract_info_values` (IRMS\_output\_analyzer.py:58); Excel parsing/date ordinal inside `main` (multiple). `Standards.csv` capitalized in legacy when loaded globally.

### 19.2 Diagnostics (7×3 grid → Plotly JSON)

**Service builder**

```python
# app/services/diagnostics.py
import pandas as pd
from plotly.subplots import make_subplots
import plotly.graph_objects as go
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

REQ = ['leak_rate','d 13C/12C  Mean','p_no_acid','total_co2','d 18O/16O  Mean','Line','1  Cycle Int  Samp  44','p_gases','Identifier 1']

def build_diagnostic_figure_json(df: pd.DataFrame, color_param: str) -> str:
    for c in [color_param, *REQ]:
        if c not in df.columns:
            raise ValueError(f"Missing required column: {c}")
    fig = make_subplots(rows=7, cols=3, subplot_titles=(
        'Leak Rate vs δ13C','P no Acid vs δ13C','Total CO2 vs δ13C',
        'Leak Rate vs δ18O','P no Acid vs δ18O','Total CO2 vs δ18O',
        'Leak Rate vs Line','Signal Intensity vs pCO2','Signal Intensity vs δ13C',
        'Signal Intensity vs δ18O','δ13C vs Line','δ18O vs Line',
        'Leak Rate vs pCO2','δ13C vs δ18O','Total CO2 vs Line',
        'Leak Rate vs Signal Intensity','P no Acid vs Leak Rate','P Gases vs Leak Rate',
        'PCA: Principal Components'), vertical_spacing=0.03,
        specs=[[{'type':'scatter'}]*3, [{'type':'scatter'}]*3, [{'type':'box' if (r==3 and c==1) else 'scatter'} for c in range(1,4)],
               [{'type':'box' if (r==4 and c in (2,3)) else 'scatter'} for c in range(1,4)],
               [{'type':'scatter'}]*3, [{'type':'scatter'}]*3, [{'type':'scatter'}]*3])
    def add_scatter(r,c,x,y,show=False):
        fig.add_trace(go.Scatter(x=x, y=y, mode='markers',
                       marker=dict(color=df[color_param], colorscale='Viridis', showscale=show)), row=r, col=c)
    add_scatter(1,1,df['leak_rate'],df['d 13C/12C  Mean'],True)
    add_scatter(1,2,df['p_no_acid'],df['d 13C/12C  Mean'])
    add_scatter(1,3,df['total_co2'],df['d 13C/12C  Mean'])
    add_scatter(2,1,df['leak_rate'],df['d 18O/16O  Mean'])
    # ... replicate remaining traces ...
    X = df[['leak_rate','d 13C/12C  Mean','p_no_acid','total_co2','d 18O/16O  Mean','Line','1  Cycle Int  Samp  44']].dropna()
    if len(X) >= 2:
        comps = min(2, X.shape[0], X.shape[1])
        tr = PCA(n_components=comps).fit_transform(StandardScaler().fit_transform(X))
        fig.add_trace(go.Scatter(x=tr[:,0], y=tr[:,1], mode='markers',
                       marker=dict(color=df.loc[X.index, color_param], colorscale='Viridis', showscale=False)), row=7, col=1)
    fig.update_layout(title_text='Diagnostic Plots', height=2000, showlegend=False, margin=dict(r=150))
    return fig.to_json()
```

**Legacy references:** `create_diagnostic_plots` (IRMS\_output\_analyzer.py:406).

### 19.3 Calibration (filter outliers → plots → apply values)

**Service**

```python
# app/services/calibration.py
import pandas as pd, numpy as np
from scipy.stats import linregress

ISOTOPIC_TYPES = { 'δVPDB(13C)': ('d 13C/12C  Mean','d13C_calibrated'), 'δVSMOW(18O)': ('d 18O/16O  Mean','d18O_calibrated') }

def identify_outliers_sigma(series: pd.Series, sigma_level: float) -> pd.Series:
    mu, sd = series.mean(), series.std()
    if pd.isna(mu) or pd.isna(sd) or sd == 0: return pd.Series(False, index=series.index)
    return (series > mu + sigma_level*sd) | (series < mu - sigma_level*sd)

def identify_outliers_iqr(series: pd.Series, iqr_multiplier: float = 1.5) -> pd.Series:
    q1, q3 = series.quantile(0.25), series.quantile(0.75); iqr = q3 - q1
    base = pd.Series(False, index=series.index)
    if pd.isna(iqr) or iqr == 0: return base
    mask = series.notna(); lower, upper = q1 - iqr_multiplier*iqr, q3 + iqr_multiplier*iqr
    base.loc[mask] = (series.loc[mask] < lower) | (series.loc[mask] > upper); return base

def get_true_value(standards_df: pd.DataFrame, standard: str, iso: str) -> float:
    row = standards_df[(standards_df['Standard']==standard)&(standards_df['Isotopic_Value_Type']==iso)]
    if row.empty: raise ValueError(f"True value not found for {standard} / {iso}")
    return float(row['Value'].iloc[0])

def single_point_calibration(raw_sample: float, raw_std: float, true_std: float) -> float:
    return ((raw_sample + 1000.0) * (true_std + 1000.0)) / (raw_std + 1000.0) - 1000.0

def double_point_calibration(raw_sample: float, raw_rm1: float, true_rm1: float, raw_rm2: float, true_rm2: float) -> float:
    m = (true_rm2 - true_rm1) / (raw_rm2 - raw_rm1); b = true_rm1 - m*raw_rm1; return m*raw_sample + b

def calibrate_results(standards_df: pd.DataFrame, full_df: pd.DataFrame, selected_standards: list[str]) -> pd.DataFrame:
    out = full_df.copy()
    for iso, (raw_col, cal_col) in ISOTOPIC_TYPES.items():
        if len(selected_standards) == 1:
            std = selected_standards[0]
            raw_std = pd.to_numeric(standards_df.loc[standards_df['Identifier 1']==std, raw_col], errors='coerce').mean()
            true_std = get_true_value(standards_df, std, iso)
            out[cal_col] = pd.to_numeric(out[raw_col], errors='coerce').apply(lambda x: single_point_calibration(x, raw_std, true_std) if pd.notna(x) else np.nan)
        elif len(selected_standards) == 2:
            s1, s2 = selected_standards
            rm1 = pd.to_numeric(standards_df.loc[standards_df['Identifier 1']==s1, raw_col], errors='coerce').mean()
            rm2 = pd.to_numeric(standards_df.loc[standards_df['Identifier 1']==s2, raw_col], errors='coerce').mean()
            t1, t2 = get_true_value(standards_df, s1, iso), get_true_value(standards_df, s2, iso)
            out[cal_col] = pd.to_numeric(out[raw_col], errors='coerce').apply(lambda x: double_point_calibration(x, rm1, t1, rm2, t2) if pd.notna(x) else np.nan)
        else:
            raise ValueError("Select one or two standards for calibration")
    return out
```

**Legacy references:** `identify_outliers` (IRMS\_output\_analyzer.py:99), `identify_outliers_iqr` (IRMS\_output\_analyzer.py:125), `get_true_value` (IRMS\_output\_analyzer.py:173), `single_point_calibration` (IRMS\_output\_analyzer.py:184), `double_point_calibration` (IRMS\_output\_analyzer.py:189), `calibrate_results` (IRMS\_output\_analyzer.py:196), `create_calibration_plots` for visuals (IRMS\_output\_analyzer.py:247).

### 19.4 Processing (range masks + statistical mask + summaries)

**Service**

```python
# app/services/processing.py
import pandas as pd

def build_range_masks(df, signal_range, leak_range, d13c_range, d18o_range):
    return {
        'signal': (df['1  Cycle Int  Samp  44'].between(*signal_range)),
        'leak':   (df['leak_rate'].between(*leak_range)),
        'd13c':   (df['d 13C/12C  Mean'].between(*d13c_range)),
        'd18o':   (df['d 18O/16O  Mean'].between(*d18o_range)),
    }

def detect_statistical_outliers_by_group(df, sigma_level, group_by=('Identifier 1','Comment')):
    mask = pd.Series(False, index=df.index)
    for ident in df['Identifier 1'].unique():
        sub = df[df['Identifier 1']==ident]
        for comment in sub['Comment'].unique():
            g = df[(df['Identifier 1']==ident) & (df['Comment']==comment)]
            if len(g) > 1:
                m13, s13 = g['d 13C/12C  Mean'].mean(), g['d 13C/12C  Mean'].std()
                m18, s18 = g['d 18O/16O  Mean'].mean(), g['d 18O/16O  Mean'].std()
                mask.loc[g.index] = (
                    (g['d 13C/12C  Mean'] < m13 - sigma_level*s13) |
                    (g['d 13C/12C  Mean'] > m13 + sigma_level*s13) |
                    (g['d 18O/16O  Mean'] < m18 - sigma_level*s18) |
                    (g['d 18O/16O  Mean'] > m18 + sigma_level*s18)
                )
    return mask

def summarize_outlier_counts(df, masks, stat_mask):
    out = {}
    if masks:
        out['δ13C Range'] = int((~masks['d13c']).sum())
        out['δ18O Range'] = int((~masks['d18o']).sum())
        out['Signal Intensity'] = int((~masks['signal']).sum())
        out['Leak Rate'] = int((~masks['leak']).sum())
    out['Statistical'] = int(stat_mask.sum())
    return out
```

**Legacy references:** statistical grouping and mask logic inside **Data Processing** tab (IRMS\_output\_analyzer.py: many; see outlier categorization and filename generation around \~lines 1100–1160), plus per‑filter exclusions and category labels before `download_excel` call.

### 19.5 Summary Charts (alt route)

**FastAPI endpoint**

```python
# app/api/v1/summary.py
from fastapi import APIRouter, HTTPException
from ..services import state, processing

router = APIRouter(prefix="/irms")

@router.get("/summary-charts/{job_id}")
def get_summary(job_id: str, selected_identifier: str | None = None, color_param: str = 'Identifier 1',
                x_axis_option: str = 'Sequence', sigma_level: float = 4.0,
                show_statistical_outliers: bool = False, show_range_outliers: bool = False):
    df = state.get_dataframe_for_job(job_id)
    if df is None: raise HTTPException(status_code=404, detail="job not found")
    # produce Plotly-ready series or figure JSONs as needed
    return {"charts": {"by_identifier": "<plotly-json>", "by_line": "<plotly-json>"}}
```

**Legacy references:** summary visuals are derived from the diagnostics + processing sections used in Streamlit tabs; no single function, but see `create_diagnostic_plots` and the processing tab logic.

### 19.6 Export (stream Excel, multi‑sheet)

**Service + endpoint**

```python
# app/services/export.py
import pandas as pd, io

def generate_filename(selected_ids: list[str], include_outliers: bool) -> str:
    parts = []
    if selected_ids and selected_ids != ['All']:
        parts.append(f"ID{'_'.join(selected_ids)}" if len(selected_ids) <= 3 else f"ID{len(selected_ids)}selected")
    parts.append('with_outliers' if include_outliers else 'without_outliers')
    return f"dataset_{'_'.join(parts)}.xlsx"


def build_export_excel_bytes(main_data: pd.DataFrame, outliers_df: pd.DataFrame | None, selected_standards: list[str] | None) -> bytes:
    towrite = io.BytesIO()
    with pd.ExcelWriter(towrite, engine="xlsxwriter") as writer:
        # Statistics sheet (counts + %)
        total = len(main_data) + (0 if outliers_df is None else len(outliers_df))
        stats_rows = [["Total Samples", total]]
        # ... add outlier category stats if provided ...
        pd.DataFrame(stats_rows, columns=["Metric","Value"]).to_excel(writer, index=False, sheet_name="Statistics")
        # Data
        main_data.to_excel(writer, index=False, sheet_name="Data")
        # Outliers by category (optional)
        if outliers_df is not None and not outliers_df.empty:
            for cat in outliers_df['Category'].dropna().unique():
                sheet = f"Outliers - {cat}"[:31]
                outliers_df[outliers_df['Category']==cat].to_excel(writer, index=False, sheet_name=sheet)
        # Standards Measurements / Results (optional)
        if selected_standards:
            mask = main_data['Identifier 1'].isin(selected_standards)
            main_data[mask].to_excel(writer, index=False, sheet_name="Standards Measurements")
            # compute precision/average summary, then write to "Standards Results"
    towrite.seek(0)
    return towrite.read()
```

```python
# app/api/v1/export.py
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from ..services import state
from ..services.export import build_export_excel_bytes, generate_filename

router = APIRouter(prefix="/irms")

@router.post("/export")
def export_excel(payload: dict):
    job_id = payload.get('job_id'); include_outliers = payload.get('include_outliers', False)
    selected_standards = payload.get('selected_standards', [])
    df = state.get_dataframe_for_job(job_id)
    if df is None: raise HTTPException(404, "job not found")
    # Build main/outliers per the processing masks (omitted for brevity)
    content = build_export_excel_bytes(df, outliers_df=None, selected_standards=selected_standards)
    filename = generate_filename(payload.get('selected_ids', ['All']), include_outliers)
    return StreamingResponse(io.BytesIO(content), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': f'attachment; filename="{filename}"'})
```

**Legacy references:** `download_excel` workbook construction (IRMS\_output\_analyzer.py:624) and filename generation logic near its caller in the processing tab.

---

**End of unified specification.**
