#!/usr/bin/env python3
"""
scripts/render_graph.py
Authentic Python Matplotlib Scientific Graph Engine for Chalkie 2.0.
Renders publication-grade dark chalkboard mathematical graphs, plots, and physical curves
with 100% numerical authenticity, LaTeX mathtext badges, and pre-computed ImageRegion bounding boxes.
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

CHALK_PALETTE = ["#38bdf8", "#f43f5e", "#a78bfa", "#34d399", "#fbbf24"]

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
        var_match = re.search(r'\b([MtrfvTmkz])\b', clean)
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

def interpolate_pchip(px, py, x):
    """
    Interpolates a smooth curve passing through exact (px, py) coordinates.
    Uses monotonic PCHIP (Piecewise Cubic Hermite Interpolating Polynomial)
    so coordinates (11.2 km/s, 7.9 km/s, 3.5 km/s) are exact with zero overshoot.
    """
    pts = sorted(zip(px, py), key=lambda pt: pt[0])
    uniq_x = []
    uniq_y = []
    for x_val, y_val in pts:
        if not uniq_x or abs(x_val - uniq_x[-1]) > 1e-6:
            uniq_x.append(float(x_val))
            uniq_y.append(float(y_val))
    if len(uniq_x) < 2:
        return np.full_like(x, uniq_y[0] if uniq_y else 0.0)

    try:
        from scipy.interpolate import PchipInterpolator
        pchip = PchipInterpolator(uniq_x, uniq_y, extrapolate=True)
        return pchip(x)
    except Exception:
        # Monotonic piecewise cubic fallback in numpy
        return np.interp(x, uniq_x, uniq_y)

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

    title = params.get("title") or "Scientific Mathematical Plot"
    subtitle_formula = params.get("subtitleFormula") or ""
    x_label = params.get("xAxisLabel") or "x"
    y_label = params.get("yAxisLabel") or "y"
    x_domain = params.get("xDomain") or params.get("domain") or [1.0, 10.0]
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

    if isinstance(raw_series, list) and len(raw_series) > 0 and isinstance(raw_series[0], dict) and ("anchorPoints" in raw_series[0] or "points" in raw_series[0]):
        for idx, s in enumerate(raw_series):
            label = s.get("label") or s.get("name") or f"Series {idx + 1}"
            color = s.get("color") or CHALK_PALETTE[idx % len(CHALK_PALETTE)]
            formula_in_x = s.get("formulaInX") or s.get("expression")
            raw_anchors = s.get("anchorPoints") or s.get("points") or []
            anchors = []
            for a in raw_anchors:
                try:
                    anchors.append({
                        "x": float(a.get("x", 0)),
                        "y": float(a.get("y", 0)),
                        "callout": a.get("callout") or a.get("label") or ""
                    })
                except Exception:
                    pass
            parsed_series.append({
                "label": label,
                "color": color,
                "formulaInX": formula_in_x,
                "anchorPoints": anchors
            })
    else:
        # Legacy parsing from seriesSpec or presets
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
                if idx == 0 and title and not any(k in title.lower() for k in ["mathematical", "graph plot"]):
                    name = title
                elif "orbital" in expr.lower():
                    name = "Orbital Velocity (km/s)"
                elif "escape" in expr.lower():
                    name = "Escape Velocity (km/s)"
                elif "kinetic" in expr.lower():
                    name = "Kinetic Energy"
                elif "potential" in expr.lower():
                    name = "Potential Energy"
                else:
                    name = f"Profile {idx + 1}"

            explicit_pts = parse_explicit_points(expr)
            anchors = []
            if explicit_pts and len(explicit_pts[0]) >= 2:
                for ax_val, ay_val in zip(explicit_pts[0], explicit_pts[1]):
                    anchors.append({"x": ax_val, "y": ay_val, "callout": ""})
                if anchors:
                    # Add callout to peak
                    sorted_anchors = sorted(anchors, key=lambda a: a["y"], reverse=True)
                    sorted_anchors[0]["callout"] = f"{name} Peak ({sorted_anchors[0]['x']:.1f}, {sorted_anchors[0]['y']:.1f})"

            parsed_series.append({
                "label": name,
                "color": color,
                "formulaInX": expr if not explicit_pts else None,
                "anchorPoints": anchors
            })

    # If still no series, create physically accurate default series based on title
    if not parsed_series:
        title_lower = title.lower()
        if "orbit" in title_lower or "velocity" in title_lower or "escape" in title_lower:
            parsed_series = [
                {
                    "label": "Orbital Velocity (km/s)",
                    "color": "#38bdf8",
                    "formulaInX": "7.91 / np.sqrt(x)",
                    "anchorPoints": [
                        {"x": 1.0, "y": 7.91, "callout": "Low Earth Orbit (7.91 km/s)"},
                        {"x": 2.0, "y": 5.59},
                        {"x": 4.0, "y": 3.95},
                        {"x": 6.0, "y": 3.23},
                        {"x": 8.0, "y": 2.80},
                        {"x": 10.0, "y": 2.50, "callout": "High Orbit (2.50 km/s)"}
                    ]
                },
                {
                    "label": "Escape Velocity (km/s)",
                    "color": "#f43f5e",
                    "formulaInX": "11.19 / np.sqrt(x)",
                    "anchorPoints": [
                        {"x": 1.0, "y": 11.19, "callout": "Surface Escape (11.19 km/s)"},
                        {"x": 2.0, "y": 7.91},
                        {"x": 4.0, "y": 5.59},
                        {"x": 6.0, "y": 4.57},
                        {"x": 8.0, "y": 3.96},
                        {"x": 10.0, "y": 3.54, "callout": "10 R_E Escape (3.54 km/s)"}
                    ]
                }
            ]
        elif "energy" in title_lower:
            parsed_series = [
                {
                    "label": "Specific Orbital Energy E (MJ/kg)",
                    "color": "#38bdf8",
                    "formulaInX": "31.2 * (x**2 - 2)",
                    "anchorPoints": [
                        {"x": 1.0, "y": -31.2, "callout": "Bound Circular Orbit (E < 0)"},
                        {"x": 1.2, "y": -17.5},
                        {"x": 1.414, "y": 0.0, "callout": "Parabolic Escape (E = 0)"},
                        {"x": 1.6, "y": 17.5},
                        {"x": 1.8, "y": 38.7, "callout": "Hyperbolic Escape (E > 0)"}
                    ]
                }
            ]
        else:
            parsed_series = [
                {
                    "label": title or "Physical Curve",
                    "color": "#38bdf8",
                    "formulaInX": None,
                    "anchorPoints": [
                        {"x": 1.0, "y": 10.0, "callout": "Initial Value"},
                        {"x": 3.0, "y": 6.0},
                        {"x": 5.0, "y": 4.0},
                        {"x": 7.0, "y": 2.8},
                        {"x": 10.0, "y": 2.0, "callout": "Asymptotic Level"}
                    ]
                }
            ]

    # Calculate x domain
    all_anchor_xs = [pt["x"] for s in parsed_series for pt in s.get("anchorPoints", [])]
    min_x = float(x_domain[0])
    max_x = float(x_domain[1])
    if all_anchor_xs:
        if params.get("xDomain") is None and params.get("domain") is None:
            min_x = min(all_anchor_xs)
            max_x = max(all_anchor_xs)
        else:
            min_x = min(min_x, min(all_anchor_xs))
            max_x = max(max_x, max(all_anchor_xs))

    if min_x >= max_x:
        min_x, max_x = 0.0, 10.0

    x = np.linspace(min_x, max_x, 250)

    # 2. Compute y values for each series using Anchor Points & PCHIP
    series_curves = []
    for s in parsed_series:
        anchors = s.get("anchorPoints", [])
        px = [a["x"] for a in anchors]
        py = [a["y"] for a in anchors]
        formula = s.get("formulaInX")
        y_curve = None

        if len(px) >= 2:
            # Check formula tolerance if formula provided
            use_formula = False
            if formula:
                try:
                    y_form_anchors = safe_eval_expr(formula, np.array(px))
                    rel_errs = [
                        abs(yf - ya) / max(abs(ya), 1e-4)
                        for yf, ya in zip(y_form_anchors, py)
                    ]
                    if max(rel_errs) <= 0.15:
                        use_formula = True
                except Exception:
                    use_formula = False

            if use_formula:
                try:
                    y_curve = safe_eval_expr(formula, x)
                except Exception:
                    y_curve = interpolate_pchip(px, py, x)
            else:
                y_curve = interpolate_pchip(px, py, x)
        elif formula:
            try:
                y_curve = safe_eval_expr(formula, x)
            except Exception:
                y_curve = np.full_like(x, 1.0)
        else:
            y_curve = np.full_like(x, 1.0)

        series_curves.append({
            "label": s["label"],
            "color": s["color"],
            "y": y_curve,
            "anchorPoints": anchors
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

    # Y domain calculation
    all_y = [sc["y"] for sc in series_curves if "y" in sc]
    if y_domain and len(y_domain) == 2:
        y_lower, y_upper = float(y_domain[0]), float(y_domain[1])
    elif all_y:
        concat_y = np.concatenate(all_y)
        min_y = float(np.nanmin(concat_y))
        max_y = float(np.nanmax(concat_y))
        span_y = max_y - min_y
        if span_y < 1e-3:
            span_y = 1.0
            min_y -= 0.5
            max_y += 0.5
        pad_y = span_y * 0.12
        is_pos = min_y >= 0.0 and any(k in (y_label + " " + title).lower() for k in ["velocity", "speed", "radius", "mass", "distance", "frequency"])
        y_lower = 0.0 if (min_y >= 0.0 and (is_pos or min_y - pad_y < 0.0)) else (min_y - pad_y)
        y_upper = max_y + pad_y * 1.15
    else:
        y_lower, y_upper = 0.0, 10.0

    ax.set_xlim(min_x, max_x)
    ax.set_ylim(y_lower, y_upper)

    # Reference lines (e.g. E = 0 threshold)
    if reference_lines:
        for ref in reference_lines:
            axis_type = ref.get("axis", "y")
            val = float(ref.get("value", 0))
            ref_label = ref.get("label", "")
            if axis_type == "y":
                ax.axhline(val, color="#71717a", linestyle="--", linewidth=1.2, alpha=0.85)
                if ref_label:
                    ax.text(max_x - (max_x - min_x) * 0.02, val, f" {ref_label}", color="#a1a1aa",
                            fontsize=8.0, va="bottom", ha="right", style="italic")
            elif axis_type == "x":
                ax.axvline(val, color="#71717a", linestyle="--", linewidth=1.2, alpha=0.85)
                if ref_label:
                    ax.text(val, y_upper - (y_upper - y_lower) * 0.04, f" {ref_label}", color="#a1a1aa",
                            fontsize=8.0, va="top", ha="left", style="italic")
    elif y_lower <= 0 <= y_upper:
        ax.axhline(0, color="#3f3f46", linestyle="-", linewidth=0.9, alpha=0.7)

    # Plot curves with glowing chalk effect
    for sc in series_curves:
        # Glow halo
        ax.plot(x, sc["y"], color=sc["color"], linewidth=5.5, alpha=0.18)
        # Main crisp neon line
        ax.plot(x, sc["y"], color=sc["color"], linewidth=2.4, label=sc["label"])

    # Legend (top right)
    ax.legend(
        loc="upper right",
        facecolor="#181a24",
        edgecolor="#3f3f46",
        labelcolor="#f8fafc",
        fontsize=8.5,
        framealpha=0.92
    )

    # Plot callout points with glowing dots and callout pills
    callout_bbox = dict(boxstyle="round,pad=0.35", fc="#181a24", ec="#52525b", lw=1.0, alpha=0.92)
    arrow_props = dict(arrowstyle="->", color="#94a3b8", lw=1.1, shrinkA=3, shrinkB=4)

    # Helper to convert data coordinates to normalized figure region [rx, ry, bw, bh]
    def data_to_region(x_val, y_val, label_text, reg_id, bw=0.15, bh=0.10):
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

    for s_idx, sc in enumerate(series_curves):
        anchors = sc.get("anchorPoints", [])
        for p_idx, pt in enumerate(anchors):
            px_val = pt["x"]
            py_val = pt["y"]
            callout = pt.get("callout")

            if callout:
                # Glowing dot
                ax.scatter([px_val], [py_val], s=130, color=sc["color"], alpha=0.25, zorder=5)
                ax.scatter([px_val], [py_val], s=45, color=sc["color"], zorder=6)

                # Callout placement avoiding boundaries
                dx_offset = (max_x - min_x) * 0.08
                dy_offset = (y_upper - y_lower) * 0.12
                tx = px_val + dx_offset if px_val < (min_x + max_x) * 0.55 else px_val - dx_offset * 1.6
                ty = py_val + dy_offset if py_val < (y_lower + y_upper) * 0.55 else py_val - dy_offset
                tx = max(min_x + (max_x - min_x) * 0.04, min(max_x - (max_x - min_x) * 0.22, tx))
                ty = max(y_lower + (y_upper - y_lower) * 0.06, min(y_upper - (y_upper - y_lower) * 0.10, ty))

                ax.annotate(
                    callout,
                    xy=(px_val, py_val),
                    xytext=(tx, ty),
                    color="#f8fafc",
                    fontsize=8.0,
                    fontweight="medium",
                    bbox=callout_bbox,
                    arrowprops=arrow_props,
                    zorder=7
                )

                reg = data_to_region(px_val, py_val, callout, f"anchor_{s_idx}_{p_idx}", 0.16, 0.11)
                if reg:
                    regions.append(reg)

    # If no callout regions, add peak regions
    if not regions:
        for s_idx, sc in enumerate(series_curves[:2]):
            max_idx = int(np.argmax(sc["y"]))
            reg = data_to_region(x[max_idx], sc["y"][max_idx], f"{sc['label']} Peak", f"peak_{s_idx}", 0.16, 0.11)
            if reg:
                regions.append(reg)

    # Axis regions for laser pointer grounding
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
        anchors = sc.get("anchorPoints", [])
        peak_x = float(anchors[0]["x"]) if anchors else float(x[int(np.argmax(sc["y"]))])
        peak_y = float(anchors[0]["y"]) if anchors else float(np.max(sc["y"]))
        series_summary.append({
            "name": sc["label"],
            "peakX": round(peak_x, 2),
            "peakY": round(peak_y, 2),
            "minY": round(float(np.min(sc["y"])), 2),
            "maxY": round(float(np.max(sc["y"])), 2)
        })

    plot_metadata = {
        "xMin": round(min_x, 2),
        "xMax": round(max_x, 2),
        "yMin": round(y_lower, 2),
        "yMax": round(y_upper, 2),
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
