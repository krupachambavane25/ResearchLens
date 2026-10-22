from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def create_report(analysis) -> bytes:
    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=letter,
        rightMargin=0.65 * inch,
        leftMargin=0.65 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title="ResearchLens analysis report",
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph("ResearchLens · Analysis report", styles["Title"]),
        Spacer(1, 10),
        Paragraph("<b>Analysis request</b>", styles["Heading2"]),
        Paragraph(escape(analysis.prompt), styles["BodyText"]),
        Spacer(1, 10),
    ]
    result = analysis.result
    for heading, value in (
        ("Executive summary", result.get("executive_summary", "")),
        ("Scope and limitations", result.get("notice", "")),
    ):
        story.extend(
            [Paragraph(heading, styles["Heading2"]), Paragraph(escape(str(value)), styles["BodyText"]), Spacer(1, 8)]
        )
    papers = result.get("paper_summaries", [])
    if papers:
        story.append(Paragraph("Papers analyzed", styles["Heading2"]))
        data = [["Paper", "Summary"]]
        data.extend(
            [
                [
                    Paragraph(escape(str(paper.get("title", ""))), styles["BodyText"]),
                    Paragraph(escape(str(paper.get("summary", ""))), styles["BodyText"]),
                ]
                for paper in papers
            ]
        )
        table = Table(data, colWidths=[2.1 * inch, 4.7 * inch], repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8edf3")),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("PADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.extend([table, Spacer(1, 10)])
    for heading, key in (
        ("Comparison", "comparison"),
        ("Potential research gaps and evidence", "research_gaps"),
        ("Suggested research questions", "research_questions"),
        ("Future directions", "future_directions"),
    ):
        items = result.get(key, [])
        if not items:
            continue
        story.append(Paragraph(heading, styles["Heading2"]))
        for item in items:
            if isinstance(item, dict):
                if item.get("criterion") and isinstance(item.get("findings"), list):
                    text = item["criterion"] + ": " + "; ".join(
                        f"{finding.get('paper_title', 'source')} — {finding.get('finding', '')}"
                        for finding in item["findings"]
                    )
                else:
                    text = item.get("title", "") + ": " + item.get("description", "")
                for evidence in item.get("evidence", []):
                    text += f" Evidence ({evidence.get('paper_title', 'source')}): “{evidence.get('excerpt', '')}”"
                if item.get("question"):
                    text = item["question"]
            else:
                text = str(item)
            story.append(Paragraph(escape(text), styles["BodyText"]))
            story.append(Spacer(1, 5))
    document.build(story)
    return output.getvalue()
