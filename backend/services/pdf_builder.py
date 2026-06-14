"""Render scan reports to PDF with reportlab (pure-python, no system deps).

Builds from the structured report dict (see report_builder.build_report), not
from the HTML — so the dark-themed CSS is irrelevant here. Produces a clean,
print-friendly document. One report or many can be bundled into a single PDF.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any, Dict, List

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_SEV_COLORS = {
    "critical": colors.HexColor("#dc2626"),
    "high": colors.HexColor("#ea580c"),
    "medium": colors.HexColor("#ca8a04"),
    "low": colors.HexColor("#2563eb"),
    "info": colors.HexColor("#4b5563"),
}

_MAX_TOOL_OUTPUT = 8000  # chars per tool block — keeps the PDF a sane size


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "AWTitle", parent=base["Title"], fontSize=20, spaceAfter=2,
            textColor=colors.HexColor("#0f172a"),
        ),
        "sub": ParagraphStyle(
            "AWSub", parent=base["Normal"], fontSize=9,
            textColor=colors.HexColor("#64748b"), spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "AWH2", parent=base["Heading2"], fontSize=13,
            textColor=colors.HexColor("#0e7490"), spaceBefore=14, spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "AWBody", parent=base["Normal"], fontSize=10, leading=14,
            alignment=TA_LEFT, textColor=colors.HexColor("#1e293b"),
        ),
        "meta": ParagraphStyle(
            "AWMeta", parent=base["Normal"], fontSize=9, leading=13,
            textColor=colors.HexColor("#334155"),
        ),
        "code": ParagraphStyle(
            "AWCode", parent=base["Code"], fontSize=7.5, leading=9.5,
            textColor=colors.HexColor("#334155"),
        ),
        "foot": ParagraphStyle(
            "AWFoot", parent=base["Normal"], fontSize=8,
            textColor=colors.HexColor("#94a3b8"),
        ),
    }


def _esc(text: Any) -> str:
    s = str(text) if text is not None else ""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _report_flowables(report: Dict[str, Any], st: Dict[str, ParagraphStyle]) -> List[Any]:
    flow: List[Any] = []
    summary = report.get("summary", {})
    tools = report.get("tools", [])
    alerts = report.get("alerts", [])

    flow.append(Paragraph("AlphaWeb Scan Report", st["title"]))
    flow.append(Paragraph(f"Run {_esc(report.get('run_id', ''))}", st["sub"]))

    # Meta table
    meta_rows = [
        ["Target", _esc(report.get("target", ""))],
        ["Request", _esc(report.get("prompt", ""))],
        ["Generated", _esc(report.get("generated_at", ""))],
    ]
    meta_tbl = Table(
        [[Paragraph(f"<b>{k}</b>", st["meta"]), Paragraph(v, st["meta"])] for k, v in meta_rows],
        colWidths=[32 * mm, 138 * mm],
    )
    meta_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    flow.append(meta_tbl)
    flow.append(Spacer(1, 8))

    # Summary pills as a single line
    pills = (
        f"<b>{summary.get('total_tools', 0)}</b> tools run &nbsp;•&nbsp; "
        f"<font color='#16a34a'><b>{summary.get('succeeded', 0)}</b> succeeded</font> &nbsp;•&nbsp; "
        f"<font color='#dc2626'><b>{summary.get('failed', 0)}</b> failed</font> &nbsp;•&nbsp; "
        f"<b>{summary.get('total_alerts', len(alerts))}</b> alerts"
    )
    flow.append(Paragraph(pills, st["body"]))

    # Analysis
    flow.append(Paragraph("Analysis", st["h2"]))
    analysis = _esc(report.get("analysis", "No analysis available.")).replace("\n", "<br/>")
    flow.append(Paragraph(analysis or "No analysis available.", st["body"]))

    # Alerts
    flow.append(Paragraph("Alerts &amp; Vulnerabilities", st["h2"]))
    if alerts:
        rows = [["Severity", "Tool", "Finding"]]
        for a in alerts:
            sev = str(a.get("severity", "info")).lower()
            if sev not in _SEV_COLORS:
                sev = "info"
            rows.append([
                Paragraph(f"<font color='{_SEV_COLORS[sev].hexval()}'><b>{sev.upper()}</b></font>", st["meta"]),
                Paragraph(_esc(a.get("tool", "")), st["meta"]),
                Paragraph(_esc(a.get("title", "")), st["meta"]),
            ])
        atbl = Table(rows, colWidths=[24 * mm, 28 * mm, 118 * mm], repeatRows=1)
        atbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        flow.append(atbl)
    else:
        flow.append(Paragraph("No alerts identified.", st["sub"]))

    # Tool output
    flow.append(Paragraph("Tool Output", st["h2"]))
    if tools:
        for t in tools:
            name = str(t.get("tool", "?")).upper()
            exit_code = t.get("exit_code")
            ok = exit_code == 0
            duration = t.get("duration")
            time_txt = f" — {duration:.1f}s" if isinstance(duration, (int, float)) else ""
            status = "exit 0" if ok else f"exit {exit_code}"
            color = "#16a34a" if ok else "#dc2626"
            flow.append(Paragraph(
                f"<b>{_esc(name)}</b> &nbsp;<font color='{color}'>[{_esc(status)}]</font>{_esc(time_txt)}",
                st["body"],
            ))
            body = t.get("error") or t.get("raw_output") or "(no output)"
            body = str(body)[:_MAX_TOOL_OUTPUT]
            if len(str(t.get("error") or t.get("raw_output") or "")) > _MAX_TOOL_OUTPUT:
                body += "\n… (truncated)"
            flow.append(Preformatted(body, st["code"]))
            flow.append(Spacer(1, 6))
    else:
        flow.append(Paragraph("No tools were run.", st["sub"]))

    return flow


def render_reports_pdf(reports: List[Dict[str, Any]]) -> bytes:
    """Render one or more report dicts into a single combined PDF (bytes)."""
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title="AlphaWeb Scan Reports",
    )

    story: List[Any] = []
    valid = [r for r in reports if r]

    if not valid:
        story.append(Paragraph("No reports available", st["title"]))
        story.append(Paragraph("Run at least one scan to generate a report.", st["sub"]))
    else:
        if len(valid) > 1:
            story.append(Paragraph("AlphaWeb — Scan Report Bundle", st["title"]))
            story.append(Paragraph(
                f"{len(valid)} reports • generated "
                f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}Z",
                st["sub"],
            ))
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cbd5e1")))
            story.append(Spacer(1, 10))
        for i, report in enumerate(valid):
            if i > 0:
                story.append(PageBreak())
            story.extend(_report_flowables(report, st))

    def _footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#94a3b8"))
        canvas.drawCentredString(
            A4[0] / 2, 10 * mm,
            f"Generated by AlphaWeb — AI-Powered Cybersecurity Automation Platform   ·   page {doc_.page}",
        )
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
