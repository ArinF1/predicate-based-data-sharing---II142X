#!/usr/bin/env python3
"""
Benchmark Results Analysis

Usage:
  python scripts/analyze_results.py
  python scripts/analyze_results.py --csv results/results.csv --out results/figures
"""

import argparse
import os
import sys

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
import numpy as np


SYSTEM_LABELS = {
    'A_RAW': 'Traditional',
    'B_PRED': 'Predicate-Based',
    'C_ZKP': 'ZK',
}

SYSTEM_COLORS = {
    'A_RAW': '#4361ee',
    'B_PRED': '#f72585',
    'C_ZKP': '#4cc9f0',
}

SYSTEM_ORDER = ['A_RAW', 'B_PRED', 'C_ZKP']

WARM_UP_TRIM = 0.05  # Trim first 5% of measurements per group as warm-up


def setup_style():
    #matplotlib style
    plt.rcParams.update({
        'figure.figsize': (10, 6),
        'figure.dpi': 150,
        'savefig.dpi': 300,
        'font.family': 'sans-serif',
        'font.sans-serif': ['Arial', 'DejaVu Sans', 'Helvetica'],
        'font.size': 12,
        'axes.titlesize': 14,
        'axes.labelsize': 12,
        'xtick.labelsize': 10,
        'ytick.labelsize': 10,
        'legend.fontsize': 10,
        'axes.spines.top': False,
        'axes.spines.right': False,
        'axes.grid': True,
        'grid.alpha': 0.3,
    })


def load_data(csv_path: str) -> pd.DataFrame:
    #Load and preprocess the benchmark CSV
    df = pd.read_csv(csv_path)

    # Convert latency from nanoseconds to microseconds and milliseconds
    df['latency_us'] = df['latency_ns'] / 1000.0
    df['latency_ms'] = df['latency_ns'] / 1_000_000.0

    # Filter out zero-latency entries
    df_valid = df[df['latency_ns'] > 0].copy()

    return df, df_valid


def trim_warmup(df: pd.DataFrame) -> pd.DataFrame:
    #Trim the first WARM_UP_TRIM fraction of rows per (system, sample_size) group.
    trimmed = []
    for (system, size), group in df.groupby(['system', 'sample_size']):
        n_trim = max(1, int(len(group) * WARM_UP_TRIM))
        trimmed.append(group.iloc[n_trim:])
    return pd.concat(trimmed, ignore_index=True)


def get_label(system: str) -> str:
    return SYSTEM_LABELS.get(system, system)


def get_color(system: str) -> str:
    return SYSTEM_COLORS.get(system, '#888888')


def get_systems(df: pd.DataFrame) -> list:
    return [s for s in SYSTEM_ORDER if s in df['system'].unique()]



# Tables

def print_summary_table(df: pd.DataFrame, out_dir: str):
    """Print and save summary statistics tables."""
    systems = get_systems(df)

    #Table 1: Summary Statistics
    print("\n" + "=" * 80)
    print("TABLE 1: Summary Statistics (Median, Mean, Percentiles)")
    print("=" * 80)

    rows = []
    for system in systems:
        for size in sorted(df['sample_size'].unique()):
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            if len(subset) == 0:
                continue
            rows.append({
                'System': get_label(system),
                'N': size,
                'Count': len(subset),
                'Median Latency (us)': f"{subset['latency_us'].median():.2f}",
                'Mean Latency (us)': f"{subset['latency_us'].mean():.2f}",
                'P95 Latency (us)': f"{subset['latency_us'].quantile(0.95):.2f}",
                'P99 Latency (us)': f"{subset['latency_us'].quantile(0.99):.2f}",
                'Avg CPU (ms)': f"{subset['cpu_time_ms'].mean():.4f}",
                'Payload (B)': f"{subset['payload_bytes'].mean():.0f}",
            })

    summary_df = pd.DataFrame(rows)
    print(summary_df.to_string(index=False))
    summary_df.to_csv(os.path.join(out_dir, 'table1_summary_stats.csv'), index=False)

    #Table 2: Comparison ratios
    print("\n" + "=" * 80)
    print("TABLE 2: Performance Relative to Traditional (System A)")
    print("=" * 80)

    ratio_rows = []
    for size in sorted(df['sample_size'].unique()):
        base = df[(df['system'] == 'A_RAW') & (df['sample_size'] == size)]
        if len(base) == 0:
            continue
        base_med = base['latency_us'].median()
        base_cpu = base['cpu_time_ms'].mean()
        base_pay = base['payload_bytes'].mean()

        for system in systems:
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            if len(subset) == 0:
                continue
            ratio_rows.append({
                'N': size,
                'System': get_label(system),
                'Latency Ratio (median)': f"{subset['latency_us'].median() / base_med:.1f}x" if base_med > 0 else 'N/A',
                'CPU Ratio': f"{subset['cpu_time_ms'].mean() / base_cpu:.1f}x" if base_cpu > 0 else 'N/A',
                'Payload Ratio': f"{subset['payload_bytes'].mean() / base_pay:.1f}x" if base_pay > 0 else 'N/A',
            })

    ratio_df = pd.DataFrame(ratio_rows)
    print(ratio_df.to_string(index=False))
    ratio_df.to_csv(os.path.join(out_dir, 'table2_relative_performance.csv'), index=False)

    #Table 3: Predicate satisfaction
    print("\n" + "=" * 80)
    print("TABLE 3: Predicate Satisfaction Rate")
    print("=" * 80)

    pred_rows = []
    for size in sorted(df['sample_size'].unique()):
        for system in systems:
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            if len(subset) == 0:
                continue
            total = len(subset)
            satisfied = subset['predicate_result'].sum()
            verified = subset['verified'].sum()
            pred_rows.append({
                'N': size,
                'System': get_label(system),
                'Total': total,
                'Predicate True': int(satisfied),
                'Satisfaction %': f"{100 * satisfied / total:.1f}%",
                'Verified': int(verified),
                'Verification %': f"{100 * verified / total:.1f}%",
            })

    pred_df = pd.DataFrame(pred_rows)
    print(pred_df.to_string(index=False))
    pred_df.to_csv(os.path.join(out_dir, 'table3_predicate_satisfaction.csv'), index=False)


# Figure 1: Median Per-Verification Latency (grouped bars, log scale)
def plot_median_latency(df: pd.DataFrame, out_dir: str):
    #Bar chart: MEDIAN latency per system x sample size (log scale)
    systems = get_systems(df)
    sizes = sorted(df['sample_size'].unique())

    fig, ax = plt.subplots(figsize=(10, 6))
    x = np.arange(len(sizes))
    width = 0.8 / len(systems)

    for i, system in enumerate(systems):
        medians = []
        for size in sizes:
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            medians.append(subset['latency_us'].median() if len(subset) > 0 else 0)

        offset = (i - len(systems) / 2 + 0.5) * width
        bars = ax.bar(x + offset, medians, width * 0.88,
                      label=get_label(system), color=get_color(system),
                      alpha=0.88, edgecolor='white', linewidth=0.5)

        # Value labels
        for bar, val in zip(bars, medians):
            if val > 0:
                txt = f'{val:.1f}' if val < 1000 else f'{val/1000:.0f}K'
                ax.text(bar.get_x() + bar.get_width() / 2,
                        bar.get_height() * 1.08,
                        txt, ha='center', va='bottom', fontsize=9, fontweight='bold')

    ax.set_xlabel('Sample Size (N)')
    ax.set_ylabel('Median Latency per Verification (us)')
    ax.set_title('Median Verification Latency by System')
    ax.set_xticks(x)
    ax.set_xticklabels([f'N={s:,}' for s in sizes])
    ax.set_yscale('log')
    ax.legend()

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'fig1_median_latency.png'))
    plt.close()
    print("  -> Saved fig1_median_latency.png")


# Figure 2: Total Processing Time (bar chart — intuitive: more users = more time)
def plot_total_time(df: pd.DataFrame, out_dir: str):
    #Bar chart: total time to process all N users (makes scaling intuitive)
    systems = get_systems(df)
    sizes = sorted(df['sample_size'].unique())

    fig, ax = plt.subplots(figsize=(10, 6))
    x = np.arange(len(sizes))
    width = 0.8 / len(systems)

    for i, system in enumerate(systems):
        totals_ms = []
        for size in sizes:
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            if len(subset) > 0:
                # Total = median per-user latency * N users
                total = subset['latency_us'].median() * size / 1000.0  # convert to ms
                totals_ms.append(total)
            else:
                totals_ms.append(0)

        offset = (i - len(systems) / 2 + 0.5) * width
        bars = ax.bar(x + offset, totals_ms, width * 0.88,
                      label=get_label(system), color=get_color(system),
                      alpha=0.88, edgecolor='white', linewidth=0.5)

        # Value labels
        for bar, val in zip(bars, totals_ms):
            if val > 0:
                if val < 1:
                    txt = f'{val:.2f} ms'
                elif val < 1000:
                    txt = f'{val:.1f} ms'
                else:
                    txt = f'{val/1000:.1f} s'
                ax.text(bar.get_x() + bar.get_width() / 2,
                        bar.get_height() * 1.05,
                        txt, ha='center', va='bottom', fontsize=8, fontweight='bold')

    ax.set_xlabel('Sample Size (N)')
    ax.set_ylabel('Total Processing Time (ms)')
    ax.set_title('Total Batch Processing Time by System')
    ax.set_xticks(x)
    ax.set_xticklabels([f'N={s:,}' for s in sizes])
    ax.set_yscale('log')
    ax.legend()

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'fig2_total_time.png'))
    plt.close()
    print("  -> Saved fig2_total_time.png")


# Figure 3: CPU Time Comparison (log scale so all systems visible)
def plot_cpu_time(df: pd.DataFrame, out_dir: str):
    #Bar chart: average CPU time per system x sample size (LOG scale)
    systems = get_systems(df)
    sizes = sorted(df['sample_size'].unique())

    fig, ax = plt.subplots(figsize=(10, 6))
    x = np.arange(len(sizes))
    width = 0.8 / len(systems)

    for i, system in enumerate(systems):
        means = []
        for size in sizes:
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            means.append(subset['cpu_time_ms'].mean() if len(subset) > 0 else 0)

        offset = (i - len(systems) / 2 + 0.5) * width
        bars = ax.bar(x + offset, means, width * 0.88,
                      label=get_label(system), color=get_color(system),
                      alpha=0.88, edgecolor='white', linewidth=0.5)

        for bar, val in zip(bars, means):
            if val > 0:
                txt = f'{val:.3f}' if val < 1 else f'{val:.1f}'
                ax.text(bar.get_x() + bar.get_width() / 2,
                        bar.get_height() * 1.1,
                        txt, ha='center', va='bottom', fontsize=8, fontweight='bold')

    ax.set_xlabel('Sample Size (N)')
    ax.set_ylabel('Average CPU Time per Verification (ms)')
    ax.set_title('CPU Time by System and Sample Size')
    ax.set_xticks(x)
    ax.set_xticklabels([f'N={s:,}' for s in sizes])
    ax.set_yscale('log')
    ax.legend()

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'fig3_cpu_time.png'))
    plt.close()
    print("  -> Saved fig3_cpu_time.png")


# Figure 4: Payload Size Comparison
def plot_payload(df: pd.DataFrame, out_dir: str):
    #Horizontal bar chart: payload size per system
    systems = get_systems(df)

    fig, ax = plt.subplots(figsize=(8, 4))

    payloads = []
    labels = []
    colors = []
    for system in systems:
        subset = df[df['system'] == system]
        payloads.append(subset['payload_bytes'].mean())
        labels.append(get_label(system))
        colors.append(get_color(system))

    y_pos = np.arange(len(systems))
    bars = ax.barh(y_pos, payloads, color=colors, alpha=0.88,
                   edgecolor='white', height=0.5)

    for bar, pay in zip(bars, payloads):
        ax.text(bar.get_width() + 8, bar.get_y() + bar.get_height() / 2,
                f'{pay:.0f} B', ha='left', va='center', fontweight='bold', fontsize=12)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=12)
    ax.set_xlabel('Payload Size (bytes)')
    ax.set_title('Communication Overhead per Verification')
    ax.invert_yaxis()

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'fig4_payload.png'))
    plt.close()
    print("  -> Saved fig4_payload.png")


# Figure 5: Latency Scaling (total time, line chart — intuitive growth)
def plot_scaling(df: pd.DataFrame, out_dir: str):
    #Line chart: total batch time scaling with N (shows linear growth)
    systems = get_systems(df)
    sizes = sorted(df['sample_size'].unique())

    fig, ax = plt.subplots(figsize=(10, 6))

    for system in systems:
        totals = []
        valid_sizes = []
        for size in sizes:
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            if len(subset) > 0:
                total_ms = subset['latency_us'].median() * size / 1000.0
                totals.append(total_ms)
                valid_sizes.append(size)

        if valid_sizes:
            ax.plot(valid_sizes, totals, 'o-',
                    label=get_label(system), color=get_color(system),
                    linewidth=2.5, markersize=9)

    ax.set_xlabel('Sample Size (N)')
    ax.set_ylabel('Total Processing Time (ms)')
    ax.set_title('Processing Time Scaling with Dataset Size')
    ax.set_xscale('log')
    ax.set_yscale('log')
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f'{int(x):,}'))
    ax.legend()

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'fig5_scaling.png'))
    plt.close()
    print("  -> Saved fig5_scaling.png")


# Figure 6: Throughput (LOG scale so ZK is visible)
def plot_throughput(df: pd.DataFrame, out_dir: str):
    #Bar chart: throughput in verifications/sec (LOG scale)
    systems = get_systems(df)
    sizes = sorted(df['sample_size'].unique())

    fig, ax = plt.subplots(figsize=(10, 6))
    x = np.arange(len(sizes))
    width = 0.8 / len(systems)

    for i, system in enumerate(systems):
        throughputs = []
        for size in sizes:
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            if len(subset) > 0:
                median_s = subset['latency_us'].median() / 1e6  # us -> seconds
                throughputs.append(1.0 / median_s if median_s > 0 else 0)
            else:
                throughputs.append(0)

        offset = (i - len(systems) / 2 + 0.5) * width
        bars = ax.bar(x + offset, throughputs, width * 0.88,
                      label=get_label(system), color=get_color(system),
                      alpha=0.88, edgecolor='white', linewidth=0.5)

        for bar, val in zip(bars, throughputs):
            if val > 0:
                if val >= 1000:
                    txt = f'{val/1000:.0f}K'
                else:
                    txt = f'{val:.0f}'
                ax.text(bar.get_x() + bar.get_width() / 2,
                        bar.get_height() * 1.15,
                        txt, ha='center', va='bottom', fontsize=8, fontweight='bold')

    ax.set_xlabel('Sample Size (N)')
    ax.set_ylabel('Throughput (verifications/sec)')
    ax.set_title('Estimated Throughput by System')
    ax.set_xticks(x)
    ax.set_xticklabels([f'N={s:,}' for s in sizes])
    ax.set_yscale('log')
    ax.legend()

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'fig6_throughput.png'))
    plt.close()
    print("  -> Saved fig6_throughput.png")


# Figure 7: Percentile Comparison (P50, P95, P99)
def plot_percentiles(df: pd.DataFrame, out_dir: str):
    #Grouped bar chart: P50, P95, P99 latencies at largest N
    systems = get_systems(df)
    largest_n = df['sample_size'].max()
    df_large = df[df['sample_size'] == largest_n]

    fig, ax = plt.subplots(figsize=(10, 6))

    percentiles = [('P50', 0.5), ('P95', 0.95), ('P99', 0.99)]
    x = np.arange(len(systems))
    width = 0.22
    pct_colors = ['#4361ee', '#f72585', '#ff6b35']

    for j, (pct_name, pct_val) in enumerate(percentiles):
        values = []
        for system in systems:
            subset = df_large[df_large['system'] == system]
            values.append(subset['latency_us'].quantile(pct_val) if len(subset) > 0 else 0)

        bars = ax.bar(x + (j - 1) * width, values, width * 0.9,
                      label=pct_name, color=pct_colors[j],
                      alpha=0.85, edgecolor='white')

    ax.set_xlabel('System')
    ax.set_ylabel('Latency (us)')
    ax.set_title(f'Latency Percentiles (N = {largest_n:,})')
    ax.set_xticks(x)
    ax.set_xticklabels([get_label(s) for s in systems])
    ax.legend()
    ax.set_yscale('log')

    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, 'fig7_percentiles.png'))
    plt.close()
    print("  -> Saved fig7_percentiles.png")


# LaTeX Table
def generate_latex_table(df: pd.DataFrame, out_dir: str):
    #Generate a LaTeX-formatted summary table
    systems = get_systems(df)
    sizes = sorted(df['sample_size'].unique())

    lines = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\caption{Benchmark Summary: Median Latency, CPU Time, and Payload Size}",
        r"\label{tab:benchmark-summary}",
        r"\begin{tabular}{llrrrr}",
        r"\toprule",
        r"System & N & Median Latency ($\mu$s) & P95 ($\mu$s) & CPU (ms) & Payload (B) \\",
        r"\midrule",
    ]

    for system in systems:
        label = get_label(system).replace('_', r'\_')
        for i, size in enumerate(sizes):
            subset = df[(df['system'] == system) & (df['sample_size'] == size)]
            if len(subset) == 0:
                continue
            med_lat = subset['latency_us'].median()
            p95_lat = subset['latency_us'].quantile(0.95)
            avg_cpu = subset['cpu_time_ms'].mean()
            avg_pay = subset['payload_bytes'].mean()

            sys_col = label if i == 0 else ''
            lines.append(
                f"{sys_col} & {size:,} & {med_lat:.2f} & {p95_lat:.2f} & {avg_cpu:.4f} & {avg_pay:.0f} \\\\"
            )
        lines.append(r"\midrule")

    lines[-1] = r"\bottomrule"
    lines.extend([r"\end{tabular}", r"\end{table}"])

    latex_path = os.path.join(out_dir, 'table_latex.tex')
    with open(latex_path, 'w') as f:
        f.write('\n'.join(lines))
    print("  -> Saved table_latex.tex")


# Main
def main():
    parser = argparse.ArgumentParser(description='Analyze benchmark results')
    parser.add_argument('--csv', default='results/results.csv', help='Path to results CSV')
    parser.add_argument('--out', default='results/figures', help='Output directory for figures')
    args = parser.parse_args()

    if not os.path.exists(args.csv):
        print(f"Error: CSV file not found: {args.csv}")
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    setup_style()

    # Load and preprocess
    print(f"Loading data from {args.csv}...")
    df_all, df_valid = load_data(args.csv)
    df_trimmed = trim_warmup(df_valid)

    print(f"  Total rows: {len(df_all):,}")
    print(f"  Valid rows: {len(df_valid):,}")
    print(f"  After warm-up trim: {len(df_trimmed):,}")
    print(f"  Systems: {', '.join(get_label(s) for s in get_systems(df_trimmed))}")
    print(f"  Sample sizes: {sorted(df_trimmed['sample_size'].unique())}")

    # Tables
    print("\n--- Generating Tables ---")
    print_summary_table(df_trimmed, args.out)

    # Figures
    print("\n--- Generating Figures ---")
    plot_median_latency(df_trimmed, args.out)    # Fig 1: Median per-user latency
    plot_total_time(df_trimmed, args.out)         # Fig 2: Total batch processing time
    plot_cpu_time(df_trimmed, args.out)           # Fig 3: CPU time (log scale)
    plot_payload(df_trimmed, args.out)            # Fig 4: Payload comparison
    plot_scaling(df_trimmed, args.out)            # Fig 5: Time scaling with N
    plot_throughput(df_trimmed, args.out)         # Fig 6: Throughput (log scale)
    plot_percentiles(df_trimmed, args.out)        # Fig 7: P50/P95/P99

    # LaTeX
    generate_latex_table(df_trimmed, args.out)

    print(f"\n{'=' * 60}")
    print(f"  All outputs saved to: {args.out}/")
    print(f"  - 7 figures (PNG, 300 DPI)")
    print(f"  - 3 summary tables (CSV)")
    print(f"  - 1 LaTeX table (TEX)")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
