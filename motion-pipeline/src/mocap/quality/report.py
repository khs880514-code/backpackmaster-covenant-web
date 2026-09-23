"""The quality report: markdown to read, JSON to act on, HTML to send.

Stage 4 exists so that a bad take is caught before anyone spends an afternoon
retargeting it. That only works if the report says what is wrong in the terms
the fix is made in — which joint, which interval, which threshold — so every
metric carries its own worst offenders.
"""

from __future__ import annotations

import json
from pathlib import Path

from .metrics import Assessment

MARK = {"pass": "PASS", "warn": "WARN", "fail": "FAIL"}
SWATCH = {"pass": "#1b7f4b", "warn": "#9a6b00", "fail": "#a11f2c"}


def to_markdown(assessment: Assessment, *, title: str) -> str:
    lines = [
        f"# Motion quality · {title}",
        "",
        f"**{MARK[assessment.verdict]}** — "
        f"{assessment.frames} frames at {assessment.fps:g} fps "
        f"({assessment.frames / assessment.fps:.2f}s)"
        if assessment.fps
        else f"**{MARK[assessment.verdict]}**",
        "",
        "| | Metric | Value | Threshold | What it means |",
        "|---|---|---|---|---|",
    ]
    for metric in assessment.metrics:
        lines.append(
            f"| {MARK[metric.verdict]} | {metric.title} | "
            f"{metric.value:.3g} {metric.unit} | {metric.limit or '—'} | {metric.detail} |"
        )

    offenders = [m for m in assessment.metrics if m.worst and m.verdict != "pass"]
    if offenders:
        lines += ["", "## Where it is worst", ""]
        for metric in offenders:
            entries = ", ".join(f"`{name}` {value:.3g}{metric.unit}" for name, value in metric.worst)
            lines.append(f"- **{metric.title}** — {entries}")

    if assessment.contacts is not None:
        lines += ["", "## Foot contact", ""]
        for side, intervals in assessment.contacts.intervals.items():
            share = assessment.contacts.fraction(side) * 100.0
            spans = (
                ", ".join(f"{a}–{b}" for a, b in intervals) if intervals else "none detected"
            )
            lines.append(f"- **{side}** planted {share:.0f}% of the take · frames {spans}")

    lines += [
        "",
        "---",
        "",
        "Thresholds come from `configs/pipeline.yaml` (`quality.thresholds`) and any",
        "override in the source's own config. A **FAIL** stops the run unless",
        "`--allow-poor` is passed; a **WARN** is worth a look before you retarget.",
        "",
    ]
    return "\n".join(lines)


def to_html(assessment: Assessment, *, title: str) -> str:
    rows = "\n".join(
        f'<tr><td><span class="v" style="background:{SWATCH[m.verdict]}">'
        f"{MARK[m.verdict]}</span></td><td>{m.title}</td>"
        f'<td class="n">{m.value:.3g} <span class="u">{m.unit}</span></td>'
        f'<td class="t">{m.limit or "—"}</td><td class="d">{m.detail}</td></tr>'
        for m in assessment.metrics
    )
    duration = assessment.frames / assessment.fps if assessment.fps else 0.0
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motion quality · {title}</title>
<style>
  :root {{ color-scheme: light dark; --fg:#16181d; --bg:#fbfbfd; --line:#d9dce3; --mute:#5d6470; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --fg:#e9ebf0; --bg:#14161a; --line:#2c3038; --mute:#98a0ad; }}
  }}
  body {{ margin:0; padding:32px 16px; background:var(--bg); color:var(--fg);
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }}
  main {{ max-width:900px; margin:0 auto; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  p.sub {{ color:var(--mute); margin:0 0 24px; }}
  table {{ width:100%; border-collapse:collapse; font-size:14px; }}
  th,td {{ text-align:left; padding:9px 10px; border-bottom:1px solid var(--line);
    vertical-align:top; }}
  th {{ font-weight:600; color:var(--mute); font-size:12px; text-transform:uppercase;
    letter-spacing:.06em; }}
  .v {{ display:inline-block; min-width:44px; text-align:center; padding:2px 7px;
    border-radius:5px; color:#fff; font-size:11px; font-weight:700; letter-spacing:.04em; }}
  .n {{ font-variant-numeric:tabular-nums; white-space:nowrap; }}
  .u,.t {{ color:var(--mute); font-size:12px; }}
  .d {{ color:var(--mute); }}
</style></head>
<body><main>
  <h1>Motion quality · {title}</h1>
  <p class="sub">{assessment.frames} frames at {assessment.fps:g} fps · {duration:.2f}s · overall
    <strong>{MARK[assessment.verdict]}</strong></p>
  <table>
    <thead><tr><th></th><th>Metric</th><th>Value</th><th>Threshold</th><th>What it means</th></tr></thead>
    <tbody>
{rows}
    </tbody>
  </table>
</main></body></html>
"""


def write(assessment: Assessment, directory: Path, *, title: str) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    md = directory / "quality.md"
    md.write_text(to_markdown(assessment, title=title), encoding="utf-8")
    written.append(md)

    js = directory / "quality.json"
    js.write_text(json.dumps(assessment.as_dict(), indent=2) + "\n", encoding="utf-8")
    written.append(js)

    html = directory / "quality.html"
    html.write_text(to_html(assessment, title=title), encoding="utf-8")
    written.append(html)

    return written
