import re

import pymupdf


SECTION_NAMES = {
    "abstract": ("abstract",),
    "objectives": ("objective", "aim", "research question"),
    "methodology": ("methodology", "methods", "materials and methods", "approach"),
    "datasets": ("dataset", "data set", "corpus"),
    "results": ("results", "findings", "evaluation"),
    "limitations": ("limitations", "threats to validity"),
    "conclusion": ("conclusion", "concluding remarks"),
    "future_work": ("future work", "future research", "further work"),
}

HEADING = re.compile(
    r"(?im)^\s*((?:\d+(?:\.\d+)*[\s.)-]+)?"
    r"(?:abstract|introduction|objectives?|aims?|research questions?|"
    r"methodology|methods|materials and methods|approach|datasets?|data sets?|"
    r"results?|findings|evaluation|limitations?|threats to validity|"
    r"discussion|conclusions?|concluding remarks|future work|future research))"
    r"\s*[:.]?\s*$"
)


class PDFValidationError(ValueError):
    pass


def extract_pdf(data: bytes, filename: str) -> tuple[str, int]:
    pages, page_count = extract_pdf_pages(data, filename)
    return "\n".join(pages), page_count


def extract_pdf_pages(data: bytes, filename: str) -> tuple[list[str], int]:
    if not data:
        raise PDFValidationError("The uploaded file is empty.")
    if not filename.lower().endswith(".pdf") or not data.startswith(b"%PDF-"):
        raise PDFValidationError("Only valid PDF files are supported.")
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
        if document.is_encrypted:
            document.close()
            raise PDFValidationError(
                "Encrypted PDFs are not supported. Remove password protection before uploading."
            )
        page_count = document.page_count
        if page_count > 300:
            document.close()
            raise PDFValidationError("PDFs are limited to 300 pages.")
        pages = [clean_text(page.get_text("text")) for page in document]
        document.close()
    except PDFValidationError:
        raise
    except (pymupdf.FileDataError, RuntimeError, ValueError) as exc:
        raise PDFValidationError("The PDF could not be opened or is malformed.") from exc
    if not any(page.strip() for page in pages):
        raise PDFValidationError(
            "No selectable text was found. Scanned PDFs require OCR, which is not enabled."
        )
    return pages, page_count


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_sections(text: str) -> dict[str, str]:
    matches = list(HEADING.finditer(text))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        heading = match.group(1).lower()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if not body:
            continue
        for key, aliases in SECTION_NAMES.items():
            if any(alias in heading for alias in aliases):
                sections[key] = (sections.get(key, "") + "\n" + body).strip()[:12000]
                break
    return sections


def infer_title(text: str, filename: str) -> str:
    for line in text.splitlines():
        candidate = line.strip()
        if 12 <= len(candidate) <= 240 and not candidate.lower().startswith(
            ("abstract", "keywords", "doi:", "http")
        ):
            return candidate
    return filename.rsplit(".", 1)[0].replace("_", " ")
