# IRMS Output Analyzer - NextJS Backend Migration Guide

## Overview

This document provides comprehensive documentation for migrating the IRMS Output Analyzer from a Streamlit application to a Python backend API that serves a NextJS frontend. The original application performs complex isotope ratio mass spectrometry data analysis including data processing, calibration procedures, outlier detection, diagnostic plotting, and Excel export functionality.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Processing Pipeline](#data-processing-pipeline)
3. [Core Functionality Modules](#core-functionality-modules)
   - [Data Extraction and Preprocessing](#data-extraction-and-preprocessing)
   - [Outlier Detection](#outlier-detection)
   - [Calibration System](#calibration-system)
   - [Diagnostic Plots](#diagnostic-plots)
   - [Data Processing and Filtering](#data-processing-and-filtering)
   - [Charting and Visualization](#charting-and-visualization)
   - [Excel Export](#excel-export)
4. [API Endpoints Structure](#api-endpoints-structure)
5. [Frontend Integration Points](#frontend-integration-points)
6. [Dependencies and Libraries](#dependencies-and-libraries)

## Architecture Overview

The application follows a three-tab structure:
1. **Diagnostics Tab**: Data overview, statistics, and comprehensive diagnostic plots
2. **Calibration Tab**: Standards-based calibration with outlier detection and visualization
3. **Data Processing Tab**: Filtering, outlier management, charting, and data export

### Key Technical Requirements
- Python backend with FastAPI or similar framework
- PostgreSQL or similar database for data persistence
- File upload handling for Excel/XLS files
- Real-time data processing and filtering
- Complex statistical analysis and plotting
- Multi-format data export capabilities

## Data Processing Pipeline

### Initial Data Loading and Processing

```python
# File: data_loader.py
import pandas as pd
import numpy as np
import re
from datetime import datetime

class IRMSDataLoader:
    def __init__(self):
        self.required_columns = [
            'Date', 'Line', 'Identifier 1', 'Identifier 2', 'Comment',
            'd 13C/12C  Mean', 'd 18O/16O  Mean', '1  Cycle Int  Samp  44',
            'Information'
        ]

    def load_excel_file(self, file_path):
        """Load and preprocess IRMS Excel file"""
        try:
            # Try multiple engines for Excel reading
            try:
                df = pd.read_excel(file_path, engine='openpyxl')
            except Exception:
                df = pd.read_excel(file_path, engine='xlrd')

            # Standardize data types
            df = df.convert_dtypes()
            df.reset_index(drop=True, inplace=True)

            # Handle missing values
            df = df.map(lambda x: None if pd.isna(x) else x)

            # Convert Date column with explicit format
            df['Date'] = pd.to_datetime(df['Date'], format='%m/%d/%y', errors='coerce')
            df['Date_ordinal'] = pd.to_numeric(
                df['Date'].map(lambda x: x.toordinal() if pd.notnull(x) else None)
            )

            # Extract information values
            df = self.extract_info_values(df)

            return df

        except Exception as e:
            raise ValueError(f"Error loading Excel file: {str(e)}")

    def extract_info_values(self, df):
        """Extract values from Information column using regex patterns"""
        # Initialize new columns
        info_columns = [
            'acid_temp', 'leak_rate', 'p_no_acid', 'p_gases',
            'total_co2', 'co2_after_exp', 'left_mbar', 'right_mbar',
            'left_pos', 'right_pos', 'vm1_after_transfer'
        ]

        for col in info_columns:
            df[col] = np.nan

        # Regex patterns for extraction
        patterns = {
            'acid_temp': r'Acid:\s*([\d.]+)',
            'leak_rate': r'LeakRate.*?:\s*([\d.]+)',
            'p_no_acid': r'P no Acid\s*:\s*([\d.]+)',
            'p_gases': r'P gases:\s*([\d.]+)',
            'total_co2': r'Total CO2\s*:\s*([\d.]+)',
            'co2_after_exp': r'CO2 after Exp\.:\s*([\d.]+)',
            'left_mbar': r'RefRe skipped: L mBar\s*([\d.]+)',
            'right_mbar': r'RefRe skipped: R mBar\s*([\d.]+)',
            'left_pos': r'L.*?Pos\s*([\d.]+)',
            'right_pos': r'R.*?Pos\s*([\d.]+)',
            'vm1_after_transfer': r'VM1 aftr Trfr\.:\s*([-\d.]+)'
        }

        # Extract values using regex
        for idx, row in df.iterrows():
            info = str(row['Information'])
            for col, pattern in patterns.items():
                match = re.search(pattern, info)
                if match:
                    df.at[idx, col] = float(match.group(1))

        return df
```

## Core Functionality Modules

### Data Extraction and Preprocessing

The system includes helper functions for extracting numerical data and processing the Information column:

```python
# File: data_utils.py
import re
import pandas as pd

def extract_number(text):
    """Extract the first number from a string"""
    if pd.isna(text):
        return None
    matches = re.findall(r'\d+', str(text))
    return int(matches[0]) if matches else None

def add_sequence_column(df):
    """Add sequence numbers based on Identifier 2"""
    df['Sequence'] = df['Identifier 2'].apply(
        lambda x: int(re.search(r'\d+', str(x)).group())
        if pd.notnull(x) and isinstance(x, (str, float, int)) and re.search(r'\d+', str(x))
        else None
    )
    return df
```

### Outlier Detection

Two methods are implemented for outlier detection: Z-Score and IQR methods.

```python
# File: outlier_detection.py
import pandas as pd
import numpy as np

class OutlierDetector:

    @staticmethod
    def identify_outliers_zscore(data, column, sigma_level):
        """
        Identify outliers using Z-Score method

        Parameters:
        - data: DataFrame containing the data
        - column: Column name to check for outliers
        - sigma_level: Number of standard deviations for threshold

        Returns:
        - Boolean Series indicating outliers
        """
        column_mean = data[column].mean()
        column_std = data[column].std()

        upper_threshold = column_mean + sigma_level * column_std
        lower_threshold = column_mean - sigma_level * column_std

        outliers = (data[column] > upper_threshold) | (data[column] < lower_threshold)
        return outliers

    @staticmethod
    def identify_outliers_iqr(data, column, iqr_multiplier=1.5):
        """
        Identify outliers using IQR method

        Parameters:
        - data: DataFrame containing the data
        - column: Column name to check for outliers
        - iqr_multiplier: Multiplier for IQR bounds

        Returns:
        - Boolean Series indicating outliers
        """
        q1 = data[column].quantile(0.25)
        q3 = data[column].quantile(0.75)
        iqr = q3 - q1

        upper_bound = q3 + iqr_multiplier * iqr
        lower_bound = q1 - iqr_multiplier * iqr

        outliers = (data[column] > upper_bound) | (data[column] < lower_bound)

        # Align with original data index
        outliers_full_index = pd.Series(False, index=data.index)
        outliers_full_index.loc[data[column].dropna().index] = outliers

        return outliers_full_index

    def detect_statistical_outliers_by_group(self, df, sigma_level, group_by=['Identifier 1', 'Comment']):
        """
        Detect statistical outliers grouped by identifier and comment
        """
        statistical_mask = pd.Series(False, index=df.index)

        for identifier in df['Identifier 1'].unique():
            for comment in df[df['Identifier 1'] == identifier]['Comment'].unique():
                group_mask = (df['Identifier 1'] == identifier) & (df['Comment'] == comment)
                group_data = df[group_mask]

                if len(group_data) > 1:
                    # Calculate thresholds for this group
                    mean_d13C = group_data['d 13C/12C  Mean'].mean()
                    std_d13C = group_data['d 13C/12C  Mean'].std()
                    mean_d18O = group_data['d 18O/16O  Mean'].mean()
                    std_d18O = group_data['d 18O/16O  Mean'].std()

                    # Identify statistical outliers in this group
                    group_stat_outliers = (
                        (group_data['d 13C/12C  Mean'] < mean_d13C - (sigma_level * std_d13C)) |
                        (group_data['d 13C/12C  Mean'] > mean_d13C + (sigma_level * std_d13C)) |
                        (group_data['d 18O/16O  Mean'] < mean_d18O - (sigma_level * std_d18O)) |
                        (group_data['d 18O/16O  Mean'] > mean_d18O + (sigma_level * std_d18O))
                    )
                    statistical_mask[group_mask] = group_stat_outliers

        return statistical_mask
```

### Calibration System

The calibration system supports both single-point and double-point calibration methods:

```python
# File: calibration.py
import pandas as pd
import numpy as np
from scipy.stats import linregress

class CalibrationSystem:
    def __init__(self, standards_csv_path="standards.csv"):
        self.standards_df = pd.read_csv(standards_csv_path)

    def get_true_value(self, standard_name, isotopic_type):
        """Fetch true isotopic value for a standard"""
        match = self.standards_df[
            (self.standards_df['Standard'] == standard_name) &
            (self.standards_df['Isotopic_Value_Type'] == isotopic_type)
        ]
        if not match.empty:
            return match['Value'].values[0]
        else:
            raise ValueError(f"True value not found for {standard_name} with type {isotopic_type}")

    def single_point_calibration(self, raw_sample, raw_std, true_std):
        """Apply single-point calibration formula"""
        calibrated_value = ((raw_sample + 1000) * (true_std + 1000)) / (raw_std + 1000) - 1000
        return calibrated_value

    def double_point_calibration(self, raw_sample, raw_rm1, true_rm1, raw_rm2, true_rm2):
        """Apply double-point calibration formula"""
        m = (true_rm2 - true_rm1) / (raw_rm2 - raw_rm1)
        b = true_rm1 - m * raw_rm1
        calibrated_value = m * raw_sample + b
        return calibrated_value

    def calibrate_results(self, standards_df, full_df, selected_standards):
        """
        Calibrate results based on single or double standards for both d13C and d18O

        Parameters:
        - standards_df: Filtered standards data (without outliers)
        - full_df: Complete raw sample data to be calibrated
        - selected_standards: List of selected standards (1 or 2)

        Returns:
        - DataFrame with calibrated columns added
        """
        calibrated_df = full_df.copy()

        isotopic_types = {
            'Î´VPDB(13C)': ('d 13C/12C  Mean', 'd13C_calibrated'),
            'Î´VSMOW(18O)': ('d 18O/16O  Mean', 'd18O_calibrated')
        }

        for isotopic_type, (raw_column, calibrated_column) in isotopic_types.items():
            if len(selected_standards) == 1:
                # Single Point Calibration
                standard = selected_standards[0]
                raw_std = standards_df.loc[
                    standards_df['Identifier 1'] == standard, raw_column
                ].mean()
                true_std = self.get_true_value(standard, isotopic_type)
                calibrated_df[calibrated_column] = calibrated_df[raw_column].apply(
                    lambda raw_sample: self.single_point_calibration(raw_sample, raw_std, true_std)
                )

            elif len(selected_standards) == 2:
                # Double Point Calibration
                standard1, standard2 = selected_standards
                raw_rm1 = standards_df.loc[
                    standards_df['Identifier 1'] == standard1, raw_column
                ].mean()
                true_rm1 = self.get_true_value(standard1, isotopic_type)
                raw_rm2 = standards_df.loc[
                    standards_df['Identifier 1'] == standard2, raw_column
                ].mean()
                true_rm2 = self.get_true_value(standard2, isotopic_type)
                calibrated_df[calibrated_column] = calibrated_df[raw_column].apply(
                    lambda raw_sample: self.double_point_calibration(
                        raw_sample, raw_rm1, true_rm1, raw_rm2, true_rm2
                    )
                )
            else:
                raise ValueError("Select either 1 or 2 standards for calibration")

        return calibrated_df
```

### Diagnostic Plots

The diagnostic plotting system creates comprehensive visualizations for data analysis:

```python
# File: diagnostic_plots.py
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.express as px
import pandas as pd
import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from scipy.stats import linregress

class DiagnosticPlotter:
    def __init__(self, standards_file='standards.csv'):
        try:
            self.standards_df = pd.read_csv(standards_file)
            self.standards_list = self.standards_df['Standard'].unique()
        except Exception as e:
            raise ValueError(f"Error loading standards from {standards_file}: {e}")

    def create_diagnostic_plots(self, df, color_param):
        """
        Create comprehensive diagnostic plots for IRMS data analysis

        Parameters:
        - df: DataFrame containing the data
        - color_param: Column name for coloring scatter plot markers

        Returns:
        - Plotly figure with multiple subplots
        """
        # Create subplot layout (7 rows, 3 columns)
        fig = make_subplots(
            rows=7, cols=3,
            subplot_titles=(
                'Leak Rate vs Î´13C', 'P no Acid vs Î´13C', 'Total CO2 vs Î´13C',
                'Leak Rate vs Î´18O', 'P no Acid vs Î´18O', 'Total CO2 vs Î´18O',
                'Leak Rate vs Line', 'Signal Intensity vs pCO2', 'Signal Intensity vs Î´13C',
                'Signal Intensity vs Î´18O', 'Î´13C vs Line', 'Î´18O vs Line',
                'Leak Rate vs pCO2', 'Î´13C vs Î´18O', 'Total CO2 vs Line',
                'Leak Rate vs Signal Intensity', 'P no Acid vs Leak Rate', 'P Gasses vs Leak Rate',
                'PCA: Principal Components'
            ),
            vertical_spacing=0.03,
            specs=[
                [{'type': 'scatter'}, {'type': 'scatter'}, {'type': 'scatter'}],
                [{'type': 'scatter'}, {'type': 'scatter'}, {'type': 'scatter'}],
                [{'type': 'scatter'}, {'type': 'scatter'}, {'type': 'box'}],
                [{'type': 'scatter'}, {'type': 'scatter'}, {'type': 'box'}],
                [{'type': 'scatter'}, {'type': 'scatter'}, {'type': 'scatter'}],
                [{'type': 'scatter'}, {'type': 'scatter'}, {'type': 'scatter'}],
                [{'type': 'scatter'}, {'type': 'scatter'}, {'type': 'scatter'}]
            ]
        )

        # Validate required columns
        required_columns = [
            'leak_rate', 'd 13C/12C  Mean', 'p_no_acid', 'total_co2',
            'd 18O/16O  Mean', 'Line', '1  Cycle Int  Samp  44', 'p_gases', 'Identifier 1'
        ]

        if color_param not in df.columns:
            raise ValueError(f"Selected color parameter '{color_param}' missing from DataFrame")

        for col in required_columns:
            if col not in df.columns:
                raise ValueError(f"Missing required column: {col}")

        # Set marker styles based on standards
        marker_symbols = [
            'circle-open' if id in self.standards_list else 'circle'
            for id in df['Identifier 1']
        ]
        hover_text = df['Identifier 2']

        # Row 1: Leak Rate, P no Acid, Total CO2 vs Î´13C
        self._add_scatter_trace(fig, df, 'leak_rate', 'd 13C/12C  Mean',
                               color_param, marker_symbols, hover_text, 1, 1, showscale=True)
        self._add_scatter_trace(fig, df, 'p_no_acid', 'd 13C/12C  Mean',
                               color_param, marker_symbols, hover_text, 1, 2)
        self._add_scatter_trace(fig, df, 'total_co2', 'd 13C/12C  Mean',
                               color_param, marker_symbols, hover_text, 1, 3)

        # Row 2: Same parameters vs Î´18O
        self._add_scatter_trace(fig, df, 'leak_rate', 'd 18O/16O  Mean',
                               color_param, marker_symbols, hover_text, 2, 1)
        self._add_scatter_trace(fig, df, 'p_no_acid', 'd 18O/16O  Mean',
                               color_param, marker_symbols, hover_text, 2, 2)
        self._add_scatter_trace(fig, df, 'total_co2', 'd 18O/16O  Mean',
                               color_param, marker_symbols, hover_text, 2, 3)

        # Row 3: Box plots and scatter plots
        fig.add_trace(go.Box(x=df['Line'], y=df['leak_rate']), row=3, col=1)
        self._add_scatter_with_fit(fig, df, '1  Cycle Int  Samp  44', 'total_co2',
                                  color_param, marker_symbols, hover_text, 3, 2)

        # Continue with remaining plots...
        # [Additional plotting code for all 21 subplots would continue here]

        # PCA Analysis (Row 7, Col 1)
        self._add_pca_plot(fig, df, color_param, 7, 1)

        # Update layout
        fig.update_layout(
            title="IRMS Diagnostic Plots Dashboard",
            showlegend=False,
            height=2000,
            margin=dict(r=150)  # Space for colorbar
        )

        return fig

    def _add_scatter_trace(self, fig, df, x_col, y_col, color_param, marker_symbols,
                          hover_text, row, col, showscale=False):
        """Helper method to add scatter traces"""
        fig.add_trace(
            go.Scatter(
                x=df[x_col], y=df[y_col], mode='markers',
                marker=dict(
                    color=df[color_param], colorscale='Viridis',
                    symbol=marker_symbols, showscale=showscale,
                    colorbar=dict(
                        title=color_param, thickness=20, len=0.75,
                        y=0.5, yanchor='middle', x=1.15, xanchor='right'
                    ) if showscale else None
                ),
                text=hover_text, hoverinfo='text+x+y'
            ),
            row=row, col=col
        )

    def _add_scatter_with_fit(self, fig, df, x_col, y_col, color_param,
                             marker_symbols, hover_text, row, col):
        """Add scatter plot with polynomial fit line"""
        # Clean data for fitting
        valid_mask = df[x_col].notna() & df[y_col].notna() & \
                     np.isfinite(df[x_col]) & np.isfinite(df[y_col])
        x_clean = df.loc[valid_mask, x_col]
        y_clean = df.loc[valid_mask, y_col]

        # Add scatter points
        self._add_scatter_trace(fig, df, x_col, y_col, color_param,
                               marker_symbols, hover_text, row, col)

        # Add polynomial fit if enough data points
        if len(x_clean) >= 3:
            try:
                z = np.polyfit(x_clean, y_clean, 2)
                p = np.poly1d(z)
                x_fit = np.linspace(x_clean.min(), x_clean.max(), 100)
                y_fit = p(x_fit)

                fig.add_trace(
                    go.Scatter(
                        x=x_fit, y=y_fit, mode='lines',
                        line=dict(color='red', width=2),
                        name='Polynomial Fit'
                    ),
                    row=row, col=col
                )
            except Exception:
                pass  # Skip fitting if it fails

    def _add_pca_plot(self, fig, df, color_param, row, col):
        """Add PCA analysis plot"""
        # Select numerical columns for PCA
        pca_columns = ['d 13C/12C  Mean', 'd 18O/16O  Mean', 'leak_rate',
                      'total_co2', 'p_no_acid', '1  Cycle Int  Samp  44']

        # Filter available columns and clean data
        available_columns = [col for col in pca_columns if col in df.columns]
        pca_data = df[available_columns].dropna()

        if len(pca_data) > 2 and len(available_columns) > 1:
            try:
                # Standardize data
                scaler = StandardScaler()
                scaled_data = scaler.fit_transform(pca_data)

                # Perform PCA
                pca = PCA(n_components=2)
                pca_result = pca.fit_transform(scaled_data)

                # Add PCA scatter plot
                fig.add_trace(
                    go.Scatter(
                        x=pca_result[:, 0], y=pca_result[:, 1], mode='markers',
                        marker=dict(
                            color=df.loc[pca_data.index, color_param],
                            colorscale='Viridis', showscale=False
                        ),
                        text=df.loc[pca_data.index, 'Identifier 2'],
                        hoverinfo='text+x+y'
                    ),
                    row=row, col=col
                )

                # Add variance explained annotation
                variance_explained = pca.explained_variance_ratio_
                fig.add_annotation(
                    text=f"PC1: {variance_explained[0]:.1%}<br>PC2: {variance_explained[1]:.1%}",
                    xref=f"x{row*3-3+col}", yref=f"y{row*3-3+col}",
                    x=0.05, y=0.95, xanchor='left', yanchor='top',
                    bgcolor='white', bordercolor='black'
                )
            except Exception:
                # Add placeholder if PCA fails
                fig.add_annotation(
                    text="PCA analysis failed",
                    xref=f"x{row*3-3+col}", yref=f"y{row*3-3+col}",
                    x=0.5, y=0.5, xanchor='center', yanchor='middle'
                )
```

### Calibration Plots

Specialized plotting for calibration visualization:

```python
# File: calibration_plots.py
import plotly.graph_objects as go
from scipy.stats import linregress
import pandas as pd
import numpy as np

class CalibrationPlotter:
    def __init__(self, standards_reference_df):
        self.standards_reference_df = standards_reference_df

    def create_calibration_plots(self, measurement_df, selected_standards, color_param):
        """
        Create calibration plots for Î´13C and Î´18O using Plotly

        Parameters:
        - measurement_df: DataFrame containing measured values
        - selected_standards: List of selected standard names
        - color_param: Column name for point coloring

        Returns:
        - Dictionary containing calibration plots for Î´13C and Î´18O
        """
        figs = {}

        isotopes = {
            'Î´VPDB(13C)': {
                'y_label': 'Î´13C',
                'measurement_col': 'd 13C/12C  Mean'
            },
            'Î´VSMOW(18O)': {
                'y_label': 'Î´18O',
                'measurement_col': 'd 18O/16O  Mean'
            }
        }

        for isotope_type, isotope_data in isotopes.items():
            fig = go.Figure()
            true_values = []
            measured_values = []
            color_values = []

            for standard in selected_standards:
                # Get true value for the standard
                try:
                    true_value = self.standards_reference_df[
                        (self.standards_reference_df['Standard'] == standard) &
                        (self.standards_reference_df['Isotopic_Value_Type'] == isotope_type)
                    ]['Value'].iloc[0]
                except IndexError:
                    continue

                # Get measured values and color parameter
                measured_values_for_standard = measurement_df[
                    measurement_df['Identifier 1'] == standard
                ][isotope_data['measurement_col']].values

                color_values_for_standard = measurement_df[
                    measurement_df['Identifier 1'] == standard
                ][color_param].values

                # Handle missing or NaN color values
                if len(measured_values_for_standard) != len(color_values_for_standard) or \
                   any(pd.isnull(color_values_for_standard)):
                    continue

                # Append values for calibration processing
                true_values.extend([true_value] * len(measured_values_for_standard))
                measured_values.extend(measured_values_for_standard)
                color_values.extend(color_values_for_standard)

                # Add scatter points for this standard
                fig.add_trace(go.Scatter(
                    x=[true_value] * len(measured_values_for_standard),
                    y=measured_values_for_standard,
                    mode='markers',
                    name=f'{standard}',
                    marker=dict(
                        size=10,
                        color=color_values_for_standard,
                        colorscale='Viridis',
                        colorbar=dict(
                            title=color_param,
                            thickness=20, len=0.75, y=0.5, yanchor='middle',
                            x=1.15, xanchor='right'
                        ),
                        showscale=standard == selected_standards[0]
                    )
                ))

            # Determine calibration method and add calibration line
            if len(selected_standards) == 1:
                # Single anchor calibration
                offset = np.mean(np.array(measured_values) - np.array(true_values))
                annotation_text = f"Offset = {offset:.3f}"
                x_min, x_max = min(true_values) - 1, max(true_values) + 1
                y_range = [x_min + offset, x_max + offset]

                fig.add_trace(go.Scatter(
                    x=[x_min, x_max], y=y_range, mode='lines',
                    name='Offset Line', line=dict(color='orange', dash='dash')
                ))
            else:
                # Double anchor calibration
                try:
                    slope, intercept, _, _, _ = linregress(true_values, measured_values)
                    annotation_text = f"y = {slope:.3f}x + {intercept:.3f}"
                    x_min, x_max = min(true_values) - 1, max(true_values) + 1
                    x_range = [x_min, x_max]
                    y_range = [slope * x + intercept for x in x_range]

                    fig.add_trace(go.Scatter(
                        x=x_range, y=y_range, mode='lines',
                        name='Calibration Line', line=dict(color='blue')
                    ))
                except ValueError:
                    annotation_text = "Insufficient data for linear regression"

            # Update layout with annotation and axis labels
            fig.update_layout(
                title=f"{'Single' if len(selected_standards) == 1 else 'Double'} Anchor Calibration for {isotope_type}",
                xaxis_title=f"True {isotope_data['y_label']} value",
                yaxis_title=f"Raw/Measured {isotope_data['y_label']} value",
                showlegend=True,
                width=900, height=600,
                margin=dict(r=150),
                annotations=[
                    dict(
                        x=0.05, y=0.85, xref="paper", yref="paper",
                        text=annotation_text, showarrow=False,
                        font=dict(size=12, color="black"),
                        align="left", bordercolor="black",
                        borderwidth=1, borderpad=4, bgcolor="white"
                    )
                ]
            )

            figs[isotope_type] = fig

        return figs
```

### Data Processing and Filtering

The data processing module handles complex filtering and statistical analysis:

```python
# File: data_processing.py
import pandas as pd
import numpy as np

class DataProcessor:
    def __init__(self):
        self.filter_ranges = {
            'signal_range': (1000.0, 10000.0),
            'leak_range': (0.0, 1000.0),
            'd13c_range': (-10.0, 10.0),
            'd18o_range': (-10.0, 10.0)
        }

    def update_filter_ranges(self, **ranges):
        """Update filter ranges with new values"""
        for key, value in ranges.items():
            if key in self.filter_ranges:
                self.filter_ranges[key] = value

    def apply_range_filters(self, df):
        """Apply all range filters to the dataframe"""
        # Create masks for each filter
        signal_mask = (
            (df['1  Cycle Int  Samp  44'] >= self.filter_ranges['signal_range'][0]) &
            (df['1  Cycle Int  Samp  44'] <= self.filter_ranges['signal_range'][1])
        )
        leak_mask = (
            (df['leak_rate'] >= self.filter_ranges['leak_range'][0]) &
            (df['leak_rate'] <= self.filter_ranges['leak_range'][1])
        )
        d13c_mask = (
            (df['d 13C/12C  Mean'] >= self.filter_ranges['d13c_range'][0]) &
            (df['d 13C/12C  Mean'] <= self.filter_ranges['d13c_range'][1])
        )
        d18o_mask = (
            (df['d 18O/16O  Mean'] >= self.filter_ranges['d18o_range'][0]) &
            (df['d 18O/16O  Mean'] <= self.filter_ranges['d18o_range'][1])
        )

        # Combine all masks
        combined_mask = signal_mask & leak_mask & d13c_mask & d18o_mask

        return df[combined_mask], {
            'signal_outliers': sum(~signal_mask),
            'leak_outliers': sum(~leak_mask),
            'd13c_outliers': sum(~d13c_mask),
            'd18o_outliers': sum(~d18o_mask),
            'total_excluded': sum(~combined_mask)
        }

    def calculate_statistics(self, df, excluded_standards=None):
        """Calculate comprehensive statistics for the dataset"""
        if excluded_standards is None:
            excluded_standards = []

        # Filter out standards
        non_standards_mask = ~df['Identifier 1'].isin(excluded_standards)
        data_without_standards = df[non_standards_mask].copy()

        # Count unique samples and total measurements
        unique_samples = data_without_standards.groupby(['Identifier 1', 'Identifier 2']).size().reset_index().shape[0]
        total_measurements = len(data_without_standards)

        return {
            'unique_samples': unique_samples,
            'total_measurements': total_measurements,
            'total_with_standards': len(df),
            'standards_count': len(df) - total_measurements
        }

    def create_outliers_dataframe(self, df, statistical_mask, filter_ranges):
        """Create a categorized outliers dataframe"""
        outliers_df = pd.DataFrame()

        # Statistical outliers
        statistical_outliers = df[statistical_mask].copy()
        if not statistical_outliers.empty:
            statistical_outliers['Category'] = 'Statistical'
            outliers_df = pd.concat([outliers_df, statistical_outliers])

        # Range outliers by category
        range_categories = [
            ('Î´13C Range', 'd 13C/12C  Mean', filter_ranges['d13c_range']),
            ('Î´18O Range', 'd 18O/16O  Mean', filter_ranges['d18o_range']),
            ('Signal Intensity', '1  Cycle Int  Samp  44', filter_ranges['signal_range']),
            ('Leak Rate', 'leak_rate', filter_ranges['leak_range'])
        ]

        for category, column, (min_val, max_val) in range_categories:
            range_outliers = df[
                (df[column] < min_val) | (df[column] > max_val)
            ].copy()
            if not range_outliers.empty:
                range_outliers['Category'] = category
                outliers_df = pd.concat([outliers_df, range_outliers])

        # Remove duplicates (samples that are outliers in multiple categories)
        if not outliers_df.empty:
            outliers_df = outliers_df.drop_duplicates(subset=['Identifier 1', 'Identifier 2'])

        return outliers_df
```

### Charting and Visualization

Advanced charting system for data analysis:

```python
# File: summary_charts.py
import plotly.graph_objects as go
import pandas as pd
import numpy as np
import re

class SummaryChartGenerator:
    def __init__(self):
        self.color_options = {
            'Line': 'Line',
            'Signal Intensity': '1  Cycle Int  Samp  44',
            'd18O values': 'd 18O/16O  Mean',
            'd13C values': 'd 13C/12C  Mean',
            'Leak Rate': 'leak_rate',
            'Total CO2': 'total_co2',
            'P gasses': 'p_gases',
            'P no acid': 'p_no_acid',
            'Date': 'Date_ordinal'
        }

    def create_summary_charts(self, df, selected_identifier, color_param,
                            x_axis_option, sigma_level, filter_ranges,
                            show_statistical_outliers=False, show_range_outliers=False):
        """
        Create summary charts for Î´13C and Î´18O values

        Parameters:
        - df: DataFrame containing the data
        - selected_identifier: Identifier 1 value to filter by ('All' for all)
        - color_param: Column name for coloring points
        - x_axis_option: 'By Identifier 2' or 'By Sequence'
        - sigma_level: Sigma level for statistical outlier detection
        - filter_ranges: Dictionary of filter ranges
        - show_statistical_outliers: Whether to show statistical outliers
        - show_range_outliers: Whether to show range outliers

        Returns:
        - Dictionary containing Î´13C and Î´18O summary chart figures
        """

        # Filter data by identifier if not 'All'
        if selected_identifier == 'All':
            subset_data = df.copy()
        else:
            subset_data = df[df['Identifier 1'] == selected_identifier].copy()

        # Handle missing comments
        subset_data['Comment'] = subset_data['Comment'].astype(str).fillna("No Comment")
        unique_comments = subset_data['Comment'].unique()

        # Create x_axis values
        if x_axis_option == "By Identifier 2":
            subset_data['x_axis'] = subset_data['Identifier 2'].apply(
                lambda x: float(re.search(r'\d+\.?\d*', str(x)).group())
                if pd.notnull(x) and re.search(r'\d+\.?\d*', str(x))
                else None
            )
        else:
            subset_data['x_axis'] = range(len(subset_data))

        # Create charts for both isotopes
        charts = {}
        isotopes = [
            ('Î´13C', 'd 13C/12C  Mean'),
            ('Î´18O', 'd 18O/16O  Mean')
        ]

        for isotope_name, isotope_column in isotopes:
            fig = go.Figure()

            for species in unique_comments:
                if species == "No Comment":
                    continue

                species_data = subset_data[subset_data['Comment'] == species].copy()

                if len(species_data) == 0:
                    continue

                # Calculate statistical outliers for this species
                mean_d13C = species_data['d 13C/12C  Mean'].mean()
                std_d13C = species_data['d 13C/12C  Mean'].std()
                mean_d18O = species_data['d 18O/16O  Mean'].mean()
                std_d18O = species_data['d 18O/16O  Mean'].std()

                statistical_outlier_mask = (
                    (species_data['d 13C/12C  Mean'] < mean_d13C - (sigma_level * std_d13C)) |
                    (species_data['d 13C/12C  Mean'] > mean_d13C + (sigma_level * std_d13C)) |
                    (species_data['d 18O/16O  Mean'] < mean_d18O - (sigma_level * std_d18O)) |
                    (species_data['d 18O/16O  Mean'] > mean_d18O + (sigma_level * std_d18O))
                )

                # Calculate range outliers
                range_outlier_mask = (
                    (species_data['d 13C/12C  Mean'] < filter_ranges['d13c_range'][0]) |
                    (species_data['d 13C/12C  Mean'] > filter_ranges['d13c_range'][1]) |
                    (species_data['d 18O/16O  Mean'] < filter_ranges['d18o_range'][0]) |
                    (species_data['d 18O/16O  Mean'] > filter_ranges['d18o_range'][1]) |
                    (species_data['1  Cycle Int  Samp  44'] < filter_ranges['signal_range'][0]) |
                    (species_data['1  Cycle Int  Samp  44'] > filter_ranges['signal_range'][1]) |
                    (species_data['leak_rate'] < filter_ranges['leak_range'][0]) |
                    (species_data['leak_rate'] > filter_ranges['leak_range'][1])
                )

                # Main data (excluding all outliers)
                main_data = species_data[~(statistical_outlier_mask | range_outlier_mask)].copy()
                main_data = main_data.sort_values('x_axis')

                # Generate species color
                species_color = f'rgb({hash(species) % 255}, {(hash(species) >> 8) % 255}, {(hash(species) >> 16) % 255})'

                # Plot main data
                if not main_data.empty:
                    fig.add_trace(go.Scatter(
                        x=main_data['x_axis'],
                        y=main_data[isotope_column],
                        mode='lines+markers',
                        name=species,
                        marker=dict(
                            size=8,
                            color=main_data[color_param],
                            colorscale="Viridis",
                            showscale=False
                        ),
                        line=dict(width=1, color=species_color),
                        legendgroup=species
                    ))

                # Add statistical outliers if requested
                if show_statistical_outliers:
                    statistical_outliers = species_data[statistical_outlier_mask]
                    if not statistical_outliers.empty:
                        fig.add_trace(go.Scatter(
                            x=statistical_outliers['x_axis'],
                            y=statistical_outliers[isotope_column],
                            mode='markers',
                            name='Statistical Outliers',
                            marker=dict(
                                size=12, symbol='x',
                                color=species_color,
                                line=dict(width=2, color=species_color)
                            ),
                            showlegend=True,
                            legendgroup='outliers'
                        ))

                # Add range outliers if requested
                if show_range_outliers:
                    self._add_range_outlier_traces(
                        fig, species_data, range_outlier_mask, isotope_column,
                        species_color, filter_ranges
                    )

            # Update layout
            fig.update_layout(
                title=f"{isotope_name} Summary by Species",
                xaxis_title="Sample Number" if x_axis_option == "By Sequence" else "Identifier 2",
                yaxis_title=isotope_name,
                showlegend=True,
                height=500
            )

            charts[isotope_name] = fig

        return charts

    def _add_range_outlier_traces(self, fig, species_data, range_mask, isotope_column,
                                 species_color, filter_ranges):
        """Add range outlier traces with different symbols for different outlier types"""
        if not range_mask.any():
            return

        range_outliers = species_data[range_mask]

        # Define outlier types with their symbols
        outlier_types = [
            ('Signal Intensity', '1  Cycle Int  Samp  44', 'signal_range', 'diamond'),
            ('Leak Rate', 'leak_rate', 'leak_range', 'star'),
            ('Î´13C Range', 'd 13C/12C  Mean', 'd13c_range', 'cross'),
            ('Î´18O Range', 'd 18O/16O  Mean', 'd18o_range', 'x')
        ]

        for outlier_name, column, range_key, symbol in outlier_types:
            if column not in range_outliers.columns:
                continue

            range_bounds = filter_ranges[range_key]
            outlier_mask = (
                (range_outliers[column] < range_bounds[0]) |
                (range_outliers[column] > range_bounds[1])
            )

            if outlier_mask.any():
                fig.add_trace(go.Scatter(
                    x=range_outliers[outlier_mask]['x_axis'],
                    y=range_outliers[outlier_mask][isotope_column],
                    mode='markers',
                    marker=dict(
                        color=species_color, symbol=symbol, size=12,
                        line=dict(width=2, color=species_color)
                    ),
                    name=outlier_name,
                    showlegend=True,
                    legendgroup='outliers'
                ))
```

### Excel Export

Comprehensive Excel export functionality:

```python
# File: excel_export.py
import pandas as pd
import io
from typing import Optional, List

class ExcelExporter:
    def __init__(self):
        pass

    def create_excel_file(self, main_data: pd.DataFrame,
                         outliers: Optional[pd.DataFrame] = None,
                         selected_standards: Optional[List[str]] = None) -> bytes:
        """
        Create Excel file with multiple sheets containing data and statistics

        Parameters:
        - main_data: Main dataset DataFrame
        - outliers: Optional outliers DataFrame with 'Category' column
        - selected_standards: List of selected standards for calibration

        Returns:
        - Excel file as bytes
        """
        towrite = io.BytesIO()

        with pd.ExcelWriter(towrite, engine="xlsxwriter") as writer:
            # Calculate statistics
            total_samples = len(main_data)
            outliers_stats = {}

            if outliers is not None and not outliers.empty:
                outliers_by_category = outliers.groupby('Category').size()
                outliers_stats = {
                    cat: {
                        'count': count,
                        'percentage': (count/total_samples)*100
                    }
                    for cat, count in outliers_by_category.items()
                }

            # Calculate final analyses count
            final_analyses = total_samples
            if outliers is not None:
                final_analyses -= len(outliers)
            if selected_standards:
                standards_mask = main_data['Identifier 1'].isin(selected_standards)
                final_analyses -= len(main_data[standards_mask])

            # Create Statistics sheet
            self._create_statistics_sheet(
                writer, total_samples, final_analyses, outliers_stats
            )

            # Write main data
            if selected_standards:
                standards_mask = main_data['Identifier 1'].isin(selected_standards)
                non_standards_data = main_data[~standards_mask].copy()
                non_standards_data.to_excel(writer, index=False, sheet_name="Data")
            else:
                main_data.to_excel(writer, index=False, sheet_name="Data")

            # Write outliers by category
            if outliers is not None and not outliers.empty:
                self._create_outliers_sheets(writer, outliers, selected_standards)

            # Create standards sheets if standards are selected
            if selected_standards:
                self._create_standards_sheets(
                    writer, main_data, selected_standards
                )

        towrite.seek(0)
        return towrite.read()

    def _create_statistics_sheet(self, writer, total_samples, final_analyses, outliers_stats):
        """Create statistics summary sheet"""
        stats_data = [
            ['Total Samples', total_samples],
            ['Final Analyses', final_analyses],
            ['', ''],
            ['Outliers Statistics:', '']
        ]

        if outliers_stats:
            for category, stat in outliers_stats.items():
                stats_data.append([
                    f'{category} Outliers',
                    f'{stat["count"]} ({stat["percentage"]:.1f}%)'
                ])

        stats_df = pd.DataFrame(stats_data, columns=['Metric', 'Value'])
        stats_df.to_excel(writer, index=False, sheet_name='Statistics')

    def _create_outliers_sheets(self, writer, outliers, selected_standards):
        """Create separate sheets for each outlier category"""
        # Filter out standards from outliers
        if selected_standards:
            filtered_outliers = outliers[~outliers['Identifier 1'].isin(selected_standards)]
        else:
            filtered_outliers = outliers

        if filtered_outliers.empty:
            return

        # Add Category column if missing
        if 'Category' not in filtered_outliers.columns:
            filtered_outliers['Category'] = 'Statistical'

        # Create sheets by category
        for category in filtered_outliers['Category'].unique():
            category_outliers = filtered_outliers[
                filtered_outliers['Category'] == category
            ]
            if not category_outliers.empty:
                sheet_name = f"Outliers - {category}"
                # Excel sheet name length limit
                if len(sheet_name) > 31:
                    sheet_name = sheet_name[:31]
                category_outliers.to_excel(writer, index=False, sheet_name=sheet_name)

    def _create_standards_sheets(self, writer, data, selected_standards):
        """Create sheets with standards measurements and results"""
        standards_mask = data['Identifier 1'].isin(selected_standards)
        standards_measurements = data[standards_mask].copy()

        if not standards_measurements.empty:
            standards_measurements.to_excel(
                writer, index=False, sheet_name="Standards Measurements"
            )

        # Create standards results summary
        standards_data = []
        for standard in selected_standards:
            standard_df = data[data['Identifier 1'] == standard].copy()
            if not standard_df.empty:
                d13c_precision = standard_df['d 13C/12C  Mean'].std()
                d13c_average = standard_df['d 13C/12C  Mean'].mean()
                d18o_precision = standard_df['d 18O/16O  Mean'].std()
                d18o_average = standard_df['d 18O/16O  Mean'].mean()

                standards_data.append({
                    'Standard': standard,
                    'Î´13C Precision': d13c_precision,
                    'Î´13C Average': d13c_average,
                    'Î´18O Precision': d18o_precision,
                    'Î´18O Average': d18o_average,
                    'Sample Count': len(standard_df),
                    'Calibration Type': 'Single Anchor' if len(selected_standards) == 1 else 'Double Anchor'
                })

        if standards_data:
            standards_summary = pd.DataFrame(standards_data)
            standards_summary.to_excel(writer, index=False, sheet_name="Standards Results")

            # Add calibration information
            workbook = writer.book
            worksheet = writer.sheets["Standards Results"]
            row_offset = len(standards_data) + 3
            worksheet.write(row_offset, 0, "Calibration plots are available in the Calibration tab of the application.")
            worksheet.write(row_offset + 1, 0, f"Calibration type: {'Single' if len(selected_standards) == 1 else 'Double'} Anchor")
            worksheet.write(row_offset + 2, 0, f"Standards used: {', '.join(selected_standards)}")

    def generate_filename(self, selected_ids, include_outliers):
        """Generate descriptive filename based on selection criteria"""
        filename_parts = []

        if "All" not in selected_ids:
            if len(selected_ids) <= 3:
                filename_parts.append(f"ID{'_'.join(selected_ids)}")
            else:
                filename_parts.append(f"ID{len(selected_ids)}selected")

        filename_parts.append(f"{'with' if include_outliers == 'Yes' else 'without'}_outliers")
        return f"dataset_{'_'.join(filename_parts)}.xlsx"
```

## API Endpoints Structure

Based on the analysis, here are the recommended API endpoints for the backend:

```python
# File: api_routes.py
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import pandas as pd
import io

app = FastAPI(title="IRMS Data Analyzer API", version="1.0.0")

class FilterRanges(BaseModel):
    signal_range: tuple[float, float]
    leak_range: tuple[float, float]
    d13c_range: tuple[float, float]
    d18o_range: tuple[float, float]

class CalibrationRequest(BaseModel):
    selected_standards: List[str]
    sigma_level: float
    iqr_multiplier: float
    calibration_type: str  # "Z-Score" or "IQR"
    color_param: str

class DataProcessingRequest(BaseModel):
    include_outliers: str  # "Yes" or "No"
    selected_ids: List[str]
    sigma_level: float
    filter_ranges: FilterRanges

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload and process IRMS Excel file"""
    try:
        loader = IRMSDataLoader()

        # Save uploaded file temporarily
        contents = await file.read()
        with open(f"/tmp/{file.filename}", "wb") as f:
            f.write(contents)

        # Load and process data
        df = loader.load_excel_file(f"/tmp/{file.filename}")

        # Store in database or session (implementation specific)
        # For now, return basic statistics
        stats = {
            "total_rows": len(df),
            "columns": df.columns.tolist(),
            "date_range": {
                "min": df['Date'].min().isoformat() if df['Date'].min() else None,
                "max": df['Date'].max().isoformat() if df['Date'].max() else None
            },
            "identifiers": df['Identifier 1'].unique().tolist()
        }

        return {"status": "success", "data_id": "temp_id", "statistics": stats}

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/data/{data_id}/preview")
async def get_data_preview(data_id: str, limit: int = 100):
    """Get preview of uploaded data"""
    # Implementation would retrieve data from database/session
    # Return paginated data preview
    pass

@app.get("/api/diagnostic-plots/{data_id}")
async def generate_diagnostic_plots(
    data_id: str,
    color_param: str,
    identifier_filter: Optional[List[str]] = None,
    d13c_range: Optional[tuple[float, float]] = None,
    d18o_range: Optional[tuple[float, float]] = None
):
    """Generate diagnostic plots for data analysis"""
    try:
        # Retrieve data (implementation specific)
        df = get_data_from_storage(data_id)

        # Apply filters
        if identifier_filter:
            df = df[df['Identifier 1'].isin(identifier_filter)]
        if d13c_range:
            df = df[(df['d 13C/12C  Mean'] >= d13c_range[0]) &
                   (df['d 13C/12C  Mean'] <= d13c_range[1])]
        if d18o_range:
            df = df[(df['d 18O/16O  Mean'] >= d18o_range[0]) &
                   (df['d 18O/16O  Mean'] <= d18o_range[1])]

        # Generate plots
        plotter = DiagnosticPlotter()
        fig = plotter.create_diagnostic_plots(df, color_param)

        # Return plot as JSON
        return {"plot_json": fig.to_json()}

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/calibration/{data_id}")
async def perform_calibration(data_id: str, request: CalibrationRequest):
    """Perform calibration with selected standards"""
    try:
        df = get_data_from_storage(data_id)

        # Initialize calibration system
        calibration_system = CalibrationSystem()
        outlier_detector = OutlierDetector()

        # Filter outliers from standards
        filtered_df = df.copy()
        for standard in request.selected_standards:
            mask = filtered_df['Identifier 1'] == standard
            standard_data = filtered_df[mask]

            if not standard_data.empty:
                if request.calibration_type == "Z-Score":
                    d13c_outliers = outlier_detector.identify_outliers_zscore(
                        standard_data, 'd 13C/12C  Mean', request.sigma_level
                    )
                    d18o_outliers = outlier_detector.identify_outliers_zscore(
                        standard_data, 'd 18O/16O  Mean', request.sigma_level
                    )
                else:
                    d13c_outliers = outlier_detector.identify_outliers_iqr(
                        standard_data, 'd 13C/12C  Mean', request.iqr_multiplier
                    )
                    d18o_outliers = outlier_detector.identify_outliers_iqr(
                        standard_data, 'd 18O/16O  Mean', request.iqr_multiplier
                    )

                keep_mask = ~(d13c_outliers | d18o_outliers)
                filtered_df.loc[mask] = standard_data[keep_mask]

        # Perform calibration
        calibrated_df = calibration_system.calibrate_results(
            filtered_df, df, request.selected_standards
        )

        # Generate calibration plots
        standards_reference = pd.read_csv('standards.csv')
        plotter = CalibrationPlotter(standards_reference)
        plots = plotter.create_calibration_plots(
            filtered_df, request.selected_standards, request.color_param
        )

        # Store calibrated data and return plots
        store_calibrated_data(data_id, calibrated_df)

        return {
            "status": "success",
            "plots": {k: v.to_json() for k, v in plots.items()},
            "calibration_type": "single" if len(request.selected_standards) == 1 else "double"
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/data-processing/{data_id}")
async def process_data(data_id: str, request: DataProcessingRequest):
    """Process data with filtering and outlier detection"""
    try:
        df = get_calibrated_data(data_id)

        # Initialize data processor
        processor = DataProcessor()
        processor.update_filter_ranges(**request.filter_ranges.dict())

        # Apply filters
        filtered_df, filter_stats = processor.apply_range_filters(df)

        # Detect statistical outliers
        outlier_detector = OutlierDetector()
        statistical_mask = outlier_detector.detect_statistical_outliers_by_group(
            df, request.sigma_level
        )

        # Create outliers dataframe if requested
        outliers_df = None
        if request.include_outliers == "No":
            outliers_df = processor.create_outliers_dataframe(
                df, statistical_mask, request.filter_ranges.dict()
            )

        # Calculate statistics
        stats = processor.calculate_statistics(df)

        return {
            "status": "success",
            "statistics": {**stats, **filter_stats},
            "outliers_count": len(outliers_df) if outliers_df is not None else 0
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/summary-charts/{data_id}")
async def generate_summary_charts(
    data_id: str,
    selected_identifier: str,
    color_param: str,
    x_axis_option: str,
    sigma_level: float,
    show_statistical_outliers: bool = False,
    show_range_outliers: bool = False
):
    """Generate summary charts for data visualization"""
    try:
        df = get_processed_data(data_id)
        processor = DataProcessor()

        chart_generator = SummaryChartGenerator()
        charts = chart_generator.create_summary_charts(
            df, selected_identifier, color_param, x_axis_option,
            sigma_level, processor.filter_ranges,
            show_statistical_outliers, show_range_outliers
        )

        return {
            "charts": {k: v.to_json() for k, v in charts.items()}
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/export/{data_id}")
async def export_excel(data_id: str, request: DataProcessingRequest):
    """Export processed data to Excel file"""
    try:
        df = get_processed_data(data_id)

        # Process data according to request
        processor = DataProcessor()
        processor.update_filter_ranges(**request.filter_ranges.dict())

        # Apply filtering and outlier detection
        main_data = df.copy()
        outliers_df = None

        if request.include_outliers == "No":
            # Filter data and create outliers dataframe
            outlier_detector = OutlierDetector()
            statistical_mask = outlier_detector.detect_statistical_outliers_by_group(
                df, request.sigma_level
            )
            outliers_df = processor.create_outliers_dataframe(
                df, statistical_mask, request.filter_ranges.dict()
            )
            main_data = df[~statistical_mask]

        # Generate Excel file
        exporter = ExcelExporter()
        excel_bytes = exporter.create_excel_file(
            main_data, outliers_df, None  # selected_standards from session
        )

        # Generate filename
        filename = exporter.generate_filename(
            request.selected_ids, request.include_outliers
        )

        return StreamingResponse(
            io.BytesIO(excel_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Helper functions (implementation specific)
def get_data_from_storage(data_id: str) -> pd.DataFrame:
    """Retrieve original data from storage"""
    pass

def get_calibrated_data(data_id: str) -> pd.DataFrame:
    """Retrieve calibrated data from storage"""
    pass

def get_processed_data(data_id: str) -> pd.DataFrame:
    """Retrieve processed data from storage"""
    pass

def store_calibrated_data(data_id: str, df: pd.DataFrame):
    """Store calibrated data"""
    pass
```

## Frontend Integration Points

The NextJS frontend should integrate with the backend through these key interaction points:

### 1. File Upload Component
- Drag-and-drop Excel file upload
- Progress indicator for file processing
- Display basic statistics after upload

### 2. Diagnostics Dashboard
- Interactive parameter selection for color coding
- Range sliders for Î´13C and Î´18O filtering
- Multi-select for Identifier 1 filtering
- Real-time plot updates based on filter changes

### 3. Calibration Interface
- Standards selection (single/multi-select)
- Outlier detection method selection (Z-Score/IQR)
- Parameter input for sigma levels and IQR multipliers
- Side-by-side calibration plot display

### 4. Data Processing Controls
- Range sliders for all filter parameters
- Statistical outlier settings
- Download configuration options
- Real-time statistics display

### 5. Visualization Components
- Interactive Plotly chart integration
- Chart type selection and configuration
- Outlier overlay toggles
- Color parameter selection

## Dependencies and Libraries

### Python Backend Dependencies
```
fastapi>=0.104.0
uvicorn>=0.24.0
pandas>=2.1.0
numpy>=1.24.0
plotly>=5.17.0
scipy>=1.11.0
scikit-learn>=1.3.0
xlsxwriter>=3.1.0
openpyxl>=3.1.0
xlrd>=2.0.1
pydantic>=2.4.0
python-multipart>=0.0.6
```

### Key Frontend Libraries (NextJS)
```
@plotly/plotly.js
react-plotly.js
@tanstack/react-query
axios
react-dropzone
@radix-ui/react-slider
@radix-ui/react-select
lucide-react
```

This comprehensive migration guide provides the foundation for converting the Streamlit IRMS analyzer into a scalable Python backend API with NextJS frontend. Each module is designed to be independently testable and maintainable while preserving all the original functionality.