#!/usr/bin/env python3
"""
scripts/render_graph.py
Universal, Domain-Agnostic Scientific Matplotlib Engine for Chalkie 2.0.
Renders publication-grade dark chalkboard mathematical graphs, plots, and quantitative curves
with 100% numerical authenticity, LaTeX mathtext badges, and pre-computed ImageRegion bounding boxes.
Completely domain-agnostic: zero hardcoded topic branches or presets.
"""

import sys
import json
import base64
import io
import math
import re
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

CHALK_PALETTE = ["#38bdf8", "#f43f5e", "#a78bfa", "#34d399", "#fbbf24", "#e879f9"]

def parse_explicit_points(text):
    """Extracts explicit numeric points from a string like points=[(0,0),(2,5.9),(5,14.75)]"""
    if not text:
        return None
    matches = re.findall(r'[\(\[]\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*[\)\]]', text)
    if len(matches) >= 2:
        xs = [float(m[0]) for m in matches]
        ys = [float(m[1]) for m in matches]
        return xs, ys
    return None

def normalize_math_expression(expr_str):
    """Cleans up formula strings for numpy evaluation."""
    clean = expr_str.strip()
    clean = re.sub(r'^[a-zA-Z_]\w*\s*(?:\([^)]*\))?\s*=\s*', '', clean).strip()
    clean = clean.replace('^', '**').replace('²', '**2').replace('³', '**3')
    if not re.search(r'\bx\b', clean):
        var_match = re.search(r'\b([MtrfvTmkzqQpP])\b', clean)
        if var_match:
            clean = re.sub(rf'\b{var_match.group(1)}\b', 'x', clean)
    return clean

def safe_eval_expr(expr_str, x):
    """Safely evaluates arithmetic and numpy expressions over numpy array x."""
    clean = normalize_math_expression(expr_str)
    if re.search(r'[;\'"\\_\a\b\f\r\v]|import|eval|exec|os|sys|open|lambda', clean):
        raise ValueError(f"Unsafe expression: {expr_str}")
    ns = {
        'x': x,
        'sin': np.sin,
        'cos': np.cos,
        'tan': np.tan,
        'exp': np.exp,
        'log': np.log,
        'sqrt': np.sqrt,
        'abs': np.abs,
        'pi': np.pi,
        'e': np.e,
        'np': np,
    }
    y_raw = eval(clean, {"__builtins__": {}}, ns)
    if isinstance(y_raw, (int, float)):
        y_raw = np.full_like(x, float(y_raw))
    return np.asarray(y_raw, dtype=float)

def interpolate_curve(px, py, dense_x):
    """
    Interpolates a smooth curve passing strictly through exact (px, py) coordinates.
    Uses monotonic PCHIP (Piecewise Cubic Hermite Interpolating Polynomial)
    so coordinates are mathematically exact with zero overshoot.
    """
    pts = sorted(zip(px, py), key=lambda pt: pt[0])
    uniq_x = []
    uniq_y = []
    for x_val, y_val in pts:
        if not uniq_x or abs(x_val - uniq_x[-1]) > 1e-7:
            uniq_x.append(float(x_val))
            uniq_y.append(float(y_val))
    if len(uniq_x) < 2:
        return np.full_like(dense_x, uniq_y[0] if uniq_y else 0.0)

    try:
        from scipy.interpolate import PchipInterpolator
        pchip = PchipInterpolator(uniq_x, uniq_y, extrapolate=True)
        return pchip(dense_x)
    except Exception:
        return np.interp(dense_x, uniq_x, uniq_y)

def find_intersection_2curves(x, y1, y2):
    """Finds intersection point between two curves if they cross."""
    diff = y1 - y2
    sign_changes = np.where(np.diff(np.sign(diff)))[0]
    if len(sign_changes) == 0:
        return None
    idx = sign_changes[0]
    # Linear interpolation for zero crossing
    x0, x1 = x[idx], x[idx + 1]
    d0, d1 = diff[idx], diff[idx + 1]
    if abs(d1 - d0) < 1e-9:
        return None
    frac = -d0 / (d1 - d0)
    xi = x0 + frac * (x1 - x0)
    yi = y1[idx] + frac * (y1[idx + 1] - y1[idx])
    return float(xi), float(yi)

def main():
    if hasattr(sys.stdin, 'reconfigure'):
        try:
            sys.stdin.reconfigure(encoding='utf-8')
        except Exception:
            pass
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    try:
        raw_input = sys.stdin.read()
        params = json.loads(raw_input) if raw_input.strip() else {}
    except Exception:
        params = {}

    title = params.get("title") or "Scientific Data Plot"
    subtitle_formula = params.get("subtitleFormula") or ""
    chart_kind = (params.get("chartKind") or params.get("graphType") or "curve").lower()
    if chart_kind in ["wave-comparison", "function-plot"]:
        chart_kind = "curve"
    elif chart_kind in ["line-chart", "timeline"]:
        chart_kind = "line"
    elif chart_kind in ["bar-chart"]:
        chart_kind = "bar"

    x_label = params.get("xAxisLabel") or "x"
    y_label = params.get("yAxisLabel") or "y"
    x_domain = params.get("xDomain") or params.get("domain")
    y_domain = params.get("yDomain")
    reference_lines = params.get("referenceLines") or []
    fig_w_px = int(params.get("width") or 800)
    fig_h_px = int(params.get("height") or 520)

    # Clean Unicode astronomical symbol if font doesn't support glyph
    x_label = x_label.replace("M☉", "M_sun").replace("Mâ~‰", "M_sun")
    y_label = y_label.replace("M☉", "M_sun").replace("Mâ~‰", "M_sun")

    # 1. Parse Series: Check for structured series[] vs legacy seriesSpec
    raw_series = params.get("series")
    parsed_series = []

    if isinstance(raw_series, list) and len(raw_series) > 0 and isinstance(raw_series[0], dict):
        for idx, s in enumerate(raw_series):
            name = s.get("name") or s.get("label") or f"Series {idx + 1}"
            color = s.get("color") or CHALK_PALETTE[idx % len(CHALK_PALETTE)]
            formula_in_x = s.get("formulaInX") or s.get("expression")
            raw_points = s.get("points") or s.get("anchorPoints") or []
            pts = []
            for p in raw_points:
                try:
                    pts.append({
                        "x": float(p.get("x", 0)),
                        "y": float(p.get("y", 0)),
                        "label": str(p.get("label") or p.get("callout") or "")
                    })
                except Exception:
                    pass
            parsed_series.append({
                "name": name,
                "color": color,
                "formulaInX": formula_in_x,
                "points": pts
            })
    else:
        # Legacy parsing from seriesSpec
        series_spec = params.get("seriesSpec") or ""
        spec_items = [item.strip() for item in series_spec.split(';') if item.strip()]
        for idx, item in enumerate(spec_items[:4]):
            color = CHALK_PALETTE[idx % len(CHALK_PALETTE)]
            expr = item
            if '|' in item:
                parts = item.split('|')
                expr = parts[0].strip()
                c_part = parts[1].strip()
                if c_part.startswith('#') or c_part.isalpha():
                    color = c_part
            name = ""
            if ':' in expr:
                n_part, e_part = expr.split(':', 1)
                name = n_part.strip()
                expr = e_part.strip()
            if not name:
                name = f"Series {idx + 1}"

            explicit_pts = parse_explicit_points(expr)
            pts = []
            if explicit_pts and len(explicit_pts[0]) >= 2:
                for ax_val, ay_val in zip(explicit_pts[0], explicit_pts[1]):
                    pts.append({"x": ax_val, "y": ay_val, "label": ""})

            parsed_series.append({
                "name": name,
                "color": color,
                "formulaInX": expr if not explicit_pts else None,
                "points": pts
            })

    # Top-level fallback points
    if not parsed_series and params.get("points"):
        pts = []
        for p in params["points"]:
            try:
                pts.append({"x": float(p["x"]), "y": float(p["y"]), "label": str(p.get("label") or "")})
            except Exception:
                pass
        if pts:
            parsed_series.append({
                "name": title,
                "color": CHALK_PALETTE[0],
                "formulaInX": None,
                "points": pts
            })

    # If still no valid points or formulas, return zero-data error so board can convert to box card
    has_any_data = any(len(s.get("points", [])) > 0 or s.get("formulaInX") for s in parsed_series)
    if not has_any_data:
        sys.stdout.write(json.dumps({
            "error": "no_data_points",
            "message": "Graph node received with zero valid numeric points"
        }))
        return

    # Calculate x domain
    all_points_x = [pt["x"] for s in parsed_series for pt in s.get("points", [])]
    if all_points_x:
        min_x = min(all_points_x)
        max_x = max(all_points_x)
    else:
        min_x, max_x = 0.0, 10.0

    if x_domain and len(x_domain) == 2:
        min_x, max_x = float(x_domain[0]), float(x_domain[1])

    if min_x >= max_x:
        min_x -= 1.0
        max_x += 1.0

    span_x = max_x - min_x
    pad_x = (span_x if span_x > 1e-4 else 1.0) * 0.12
    plot_xlim = [min_x - pad_x, max_x + pad_x] if not x_domain else [min_x, max_x]

    dense_x = np.linspace(min_x, max_x, 300)

    # 2. Compute curves / series data
    series_curves = []
    for s in parsed_series:
        pts = s.get("points", [])
        px = [p["x"] for p in pts]
        py = [p["y"] for p in pts]
        formula = s.get("formulaInX")
        y_curve = None

        if len(px) >= 2:
            # If formula provided and matches points well, use formula
            use_formula = False
            if formula:
                try:
                    y_form_pts = safe_eval_expr(formula, np.array(px))
                    rel_errs = [abs(yf - ya) / max(abs(ya), 1e-4) for yf, ya in zip(y_form_pts, py)]
                    if max(rel_errs) <= 0.15:
                        use_formula = True
                except Exception:
                    use_formula = False

            if use_formula:
                try:
                    y_curve = safe_eval_expr(formula, dense_x)
                except Exception:
                    y_curve = interpolate_curve(px, py, dense_x)
            else:
                y_curve = interpolate_curve(px, py, dense_x)
        elif formula:
            try:
                y_curve = safe_eval_expr(formula, dense_x)
                px = list(np.linspace(min_x, max_x, 8))
                py = list(safe_eval_expr(formula, np.array(px)))
                pts = [{"x": float(x_val), "y": float(y_val), "label": ""} for x_val, y_val in zip(px, py)]
            except Exception:
                y_curve = np.full_like(dense_x, 1.0)
        elif len(px) == 1:
            y_curve = np.full_like(dense_x, py[0])
        else:
            y_curve = np.full_like(dense_x, 0.0)

        series_curves.append({
            "name": s["name"],
            "color": s["color"],
            "dense_y": y_curve,
            "points": pts,
            "px": px,
            "py": py
        })

    # 3. Setup Matplotlib figure with dark chalkboard theme (#121318)
    dpi = 160
    fig, ax = plt.subplots(figsize=(fig_w_px / dpi, fig_h_px / dpi), dpi=dpi)
    bg_color = "#121318"
    fig.patch.set_facecolor(bg_color)
    ax.set_facecolor(bg_color)

    # Subtle grid (#222738)
    ax.grid(True, linestyle="--", color="#222738", alpha=0.85, linewidth=0.85)

    # Clean border spines (#3f3f46)
    for spine in ax.spines.values():
        spine.set_color("#3f3f46")
        spine.set_linewidth(1.1)

    # Ticks & labels
    ax.tick_params(colors="#94a3b8", labelsize=8.5, width=1.0)
    ax.set_xlabel(x_label, color="#f8fafc", fontsize=10.0, labelpad=8, fontweight='medium')
    ax.set_ylabel(y_label, color="#f8fafc", fontsize=10.0, labelpad=8, fontweight='medium')
    title_size = 11.5 if len(title) < 32 else (10.0 if len(title) < 48 else 8.8)

    if subtitle_formula:
        fig.suptitle(title, color="#f8fafc", fontsize=title_size, fontweight='bold', y=0.97)
        try:
            mathtext_str = subtitle_formula if (subtitle_formula.startswith("$") and subtitle_formula.endswith("$")) else f"${subtitle_formula}$"
            ax.set_title(
                mathtext_str,
                fontsize=9.0, color='#e2e8f0', pad=10,
                bbox=dict(boxstyle='round,pad=0.35', fc='#181a24', ec='#475569', lw=0.9, alpha=0.92)
            )
        except Exception:
            ax.set_title(
                subtitle_formula.replace("$", ""),
                fontsize=8.5, color='#e2e8f0', pad=10,
                bbox=dict(boxstyle='round,pad=0.35', fc='#181a24', ec='#475569', lw=0.9, alpha=0.92)
            )
    else:
        ax.set_title(title, color="#f8fafc", fontsize=title_size, pad=12, fontweight='bold')

    # Y limits calculation with 12% breathing room
    all_y_vals = []
    for sc in series_curves:
        if sc.get("py"):
            all_y_vals.extend(sc["py"])
        if sc.get("dense_y") is not None and chart_kind == "curve":
            all_y_vals.extend(list(sc["dense_y"]))

    if y_domain and len(y_domain) == 2:
        y_lower, y_upper = float(y_domain[0]), float(y_domain[1])
    elif all_y_vals:
        min_y = float(np.nanmin(all_y_vals))
        max_y = float(np.nanmax(all_y_vals))
        span_y = max_y - min_y
        if span_y < 1e-4:
            span_y = 1.0
            min_y -= 0.5
            max_y += 0.5
        pad_y = span_y * 0.12
        # Ground at 0 if strictly positive domain
        if min_y >= 0.0 and (min_y - pad_y < 0.0):
            y_lower = 0.0
        else:
            y_lower = min_y - pad_y
        y_upper = max_y + pad_y * 1.15
    else:
        y_lower, y_upper = 0.0, 10.0

    ax.set_xlim(plot_xlim[0], plot_xlim[1])
    ax.set_ylim(y_lower, y_upper)

    # Reference lines
    if reference_lines:
        for ref in reference_lines:
            axis_type = ref.get("axis", "y")
            val = float(ref.get("value", 0))
            ref_label = ref.get("label", "")
            if axis_type == "y":
                ax.axhline(val, color="#71717a", linestyle="--", linewidth=1.2, alpha=0.85)
                if ref_label:
                    ax.text(plot_xlim[1] - (plot_xlim[1] - plot_xlim[0]) * 0.02, val, f" {ref_label}",
                            color="#a1a1aa", fontsize=8.0, va="bottom", ha="right", style="italic")
            elif axis_type == "x":
                ax.axvline(val, color="#71717a", linestyle="--", linewidth=1.2, alpha=0.85)
                if ref_label:
                    ax.text(val, y_upper - (y_upper - y_lower) * 0.04, f" {ref_label}",
                            color="#a1a1aa", fontsize=8.0, va="top", ha="left", style="italic")
    elif y_lower <= 0 <= y_upper:
        ax.axhline(0, color="#3f3f46", linestyle="-", linewidth=0.9, alpha=0.7)

    # Render series by chart_kind
    if chart_kind == "bar":
        num_s = len(series_curves)
        all_unique_x = sorted(list(set([pt["x"] for sc in series_curves for pt in sc["points"]])))
        min_dx = 1.0
        if len(all_unique_x) > 1:
            diffs = np.diff(all_unique_x)
            min_dx = float(np.min(diffs[diffs > 1e-5])) if any(diffs > 1e-5) else 1.0
        total_group_w = min_dx * 0.72
        bar_w = total_group_w / max(1, num_s)

        for s_idx, sc in enumerate(series_curves):
            offset = (s_idx - (num_s - 1) / 2.0) * bar_w
            bx = [p["x"] + offset for p in sc["points"]]
            by = [p["y"] for p in sc["points"]]
            ax.bar(bx, by, width=bar_w, color=sc["color"], alpha=0.88,
                   edgecolor=sc["color"], linewidth=1.2, label=sc["name"])

    elif chart_kind == "scatter":
        for sc in series_curves:
            px, py = sc["px"], sc["py"]
            # High-contrast glowing scatter dots
            ax.scatter(px, py, s=160, color=sc["color"], alpha=0.25, zorder=5)
            ax.scatter(px, py, s=60, color=sc["color"], edgecolors="#f8fafc", linewidth=1.2, zorder=6, label=sc["name"])
            # Optional linear trendline if >= 3 points
            if len(px) >= 3:
                try:
                    poly = np.polyfit(px, py, 1)
                    tx = np.linspace(min(px), max(px), 100)
                    ty = np.polyval(poly, tx)
                    ax.plot(tx, ty, color=sc["color"], linestyle="--", linewidth=1.4, alpha=0.7)
                except Exception:
                    pass

    elif chart_kind == "line":
        for sc in series_curves:
            px, py = sc["px"], sc["py"]
            ax.plot(px, py, color=sc["color"], linewidth=5.5, alpha=0.18)
            ax.plot(px, py, color=sc["color"], linewidth=2.4, marker='o', markersize=6, label=sc["name"])

    else:
        # Default: "curve" with smooth PCHIP interpolation passing strictly through points
        for sc in series_curves:
            px, py = sc["px"], sc["py"]
            if len(px) >= 4:
                # Smooth curve halo & crisp line
                ax.plot(dense_x, sc["dense_y"], color=sc["color"], linewidth=5.5, alpha=0.18)
                ax.plot(dense_x, sc["dense_y"], color=sc["color"], linewidth=2.4, label=sc["name"])
                # Key anchor points
                ax.scatter(px, py, s=40, color=sc["color"], edgecolors="#f8fafc", linewidth=1.0, zorder=6)
            elif len(px) >= 2:
                ax.plot(px, py, color=sc["color"], linewidth=5.5, alpha=0.18)
                ax.plot(px, py, color=sc["color"], linewidth=2.4, marker='o', markersize=6, label=sc["name"])
            else:
                ax.plot(dense_x, sc["dense_y"], color=sc["color"], linewidth=2.4, label=sc["name"])

    # Legend
    ax.legend(
        loc="upper right",
        facecolor="#181a24",
        edgecolor="#3f3f46",
        labelcolor="#f8fafc",
        fontsize=8.5,
        framealpha=0.92
    )

    # Callouts & Normalized ImageRegion[] bounding boxes
    callout_bbox = dict(boxstyle="round,pad=0.35", fc="#181a24", ec="#52525b", lw=1.0, alpha=0.92)
    arrow_props = dict(arrowstyle="->", color="#94a3b8", lw=1.1, shrinkA=3, shrinkB=4)

    def data_to_region(x_val, y_val, label_text, reg_id, bw=0.16, bh=0.11):
        try:
            disp_pt = ax.transData.transform((float(x_val), float(y_val)))
            fig_pt = fig.transFigure.inverted().transform(disp_pt)
            cx = float(fig_pt[0])
            cy = float(1.0 - fig_pt[1])
            rx = max(0.01, min(0.98 - bw, cx - bw / 2.0))
            ry = max(0.01, min(0.98 - bh, cy - bh / 2.0))
            return {
                "id": reg_id,
                "label": label_text,
                "x": round(rx, 3),
                "y": round(ry, 3),
                "width": round(bw, 3),
                "height": round(bh, 3),
                "confidence": 1.0
            }
        except Exception:
            return None

    regions = []

    # 1. Explicit point labels
    for s_idx, sc in enumerate(series_curves):
        for p_idx, pt in enumerate(sc["points"]):
            px_val = pt["x"]
            py_val = pt["y"]
            lbl = pt.get("label")

            if lbl:
                ax.scatter([px_val], [py_val], s=140, color=sc["color"], alpha=0.28, zorder=7)
                ax.scatter([px_val], [py_val], s=50, color=sc["color"], edgecolors="#ffffff", linewidth=1.2, zorder=8)

                dx_offset = (plot_xlim[1] - plot_xlim[0]) * 0.08
                dy_offset = (y_upper - y_lower) * 0.12
                tx = px_val + dx_offset if px_val < (plot_xlim[0] + plot_xlim[1]) * 0.55 else px_val - dx_offset * 1.6
                ty = py_val + dy_offset if py_val < (y_lower + y_upper) * 0.55 else py_val - dy_offset
                tx = max(plot_xlim[0] + (plot_xlim[1] - plot_xlim[0]) * 0.04, min(plot_xlim[1] - (plot_xlim[1] - plot_xlim[0]) * 0.22, tx))
                ty = max(y_lower + (y_upper - y_lower) * 0.06, min(y_upper - (y_upper - y_lower) * 0.10, ty))

                ax.annotate(
                    lbl,
                    xy=(px_val, py_val),
                    xytext=(tx, ty),
                    color="#f8fafc",
                    fontsize=8.0,
                    fontweight="medium",
                    bbox=callout_bbox,
                    arrowprops=arrow_props,
                    zorder=9
                )

                reg = data_to_region(px_val, py_val, lbl, f"point_{s_idx}_{p_idx}", 0.16, 0.11)
                if reg:
                    regions.append(reg)

    # 2. Check for curve intersection if 2 series present and no intersection labeled
    if len(series_curves) == 2 and chart_kind == "curve":
        inter = find_intersection_2curves(dense_x, series_curves[0]["dense_y"], series_curves[1]["dense_y"])
        if inter:
            ix, iy = inter
            # If no point is already annotated close to (ix, iy)
            already_labeled = any(
                abs(r["x"] - data_to_region(ix, iy, "", "tmp")["x"]) < 0.08
                for r in regions if data_to_region(ix, iy, "", "tmp")
            )
            if not already_labeled:
                inter_lbl = f"Equilibrium ({ix:.1f}, {iy:.1f})"
                ax.scatter([ix], [iy], s=160, color="#fbbf24", alpha=0.35, zorder=8)
                ax.scatter([ix], [iy], s=55, color="#fbbf24", edgecolors="#ffffff", linewidth=1.2, zorder=9)
                ax.annotate(
                    inter_lbl,
                    xy=(ix, iy),
                    xytext=(ix + (plot_xlim[1] - plot_xlim[0]) * 0.08, iy + (y_upper - y_lower) * 0.12),
                    color="#f8fafc",
                    fontsize=8.0,
                    fontweight="bold",
                    bbox=callout_bbox,
                    arrowprops=arrow_props,
                    zorder=10
                )
                reg = data_to_region(ix, iy, inter_lbl, "curve_intersection", 0.18, 0.11)
                if reg:
                    regions.append(reg)

    # 3. If still zero regions, annotate peak of first series
    if not regions and series_curves and series_curves[0]["px"]:
        sc0 = series_curves[0]
        max_idx = int(np.argmax(sc0["py"]))
        pk_x, pk_y = sc0["px"][max_idx], sc0["py"][max_idx]
        reg = data_to_region(pk_x, pk_y, f"{sc0['name']} Maximum", "peak_0", 0.16, 0.11)
        if reg:
            regions.append(reg)

    # 4. Laser pointer axis bounding boxes
    regions.append({
        "id": "x_axis",
        "label": x_label or "X Axis",
        "x": 0.15,
        "y": 0.88,
        "width": 0.75,
        "height": 0.10,
        "confidence": 1.0
    })
    regions.append({
        "id": "y_axis",
        "label": y_label or "Y Axis",
        "x": 0.02,
        "y": 0.15,
        "width": 0.12,
        "height": 0.70,
        "confidence": 1.0
    })

    fig.tight_layout(pad=1.8, rect=[0, 0, 1, 0.94] if subtitle_formula else None)

    # Encode to base64 PNG
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=bg_color, edgecolor="none", dpi=dpi)
    plt.close(fig)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("utf-8")
    data_url = f"data:image/png;base64,{b64}"

    # Build plotMetadata
    series_summary = []
    for sc in series_curves:
        pts = sc["points"]
        if pts:
            peak_pt = max(pts, key=lambda p: p["y"])
            min_y_val = min(p["y"] for p in pts)
            max_y_val = max(p["y"] for p in pts)
            peak_x = peak_pt["x"]
            peak_y = peak_pt["y"]
        else:
            peak_x = float(dense_x[int(np.argmax(sc["dense_y"]))])
            peak_y = float(np.max(sc["dense_y"]))
            min_y_val = float(np.min(sc["dense_y"]))
            max_y_val = float(np.max(sc["dense_y"]))

        series_summary.append({
            "name": sc["name"],
            "peakX": round(float(peak_x), 2),
            "peakY": round(float(peak_y), 2),
            "minY": round(float(min_y_val), 2),
            "maxY": round(float(max_y_val), 2)
        })

    plot_metadata = {
        "xMin": round(float(plot_xlim[0]), 2),
        "xMax": round(float(plot_xlim[1]), 2),
        "yMin": round(float(y_lower), 2),
        "yMax": round(float(y_upper), 2),
        "seriesSummary": series_summary
    }

    output = {
        "dataUrl": data_url,
        "width": fig_w_px,
        "height": fig_h_px,
        "regions": regions,
        "plotMetadata": plot_metadata
    }
    sys.stdout.write(json.dumps(output))

if __name__ == "__main__":
    main()
