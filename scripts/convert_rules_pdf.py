"""One-off converter: Reason Codes.pdf → data/reason_codes.md.

The assignment's rules arrived as a PDF export. This extracts the text,
normalises the PDF's fragmented whitespace, and inserts markdown headings at
each reason-code boundary so src/rules.py can slice the file per code.

Usage: python scripts/convert_rules_pdf.py "~/Downloads/Reason Codes.pdf"
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pypdf import PdfReader

from src import config


def convert(pdf_path: str) -> str:
    reader = PdfReader(Path(pdf_path).expanduser())
    raw = "\n".join(p.extract_text() for p in reader.pages)
    flat = re.sub(r"\s+", " ", raw)
    # numbered requirement lists back onto their own lines
    flat = re.sub(r" (\d\.) (?=[A-Z])", r"\n\1 ", flat)
    # markdown heading before every reason-code title
    flat = re.sub(r" ?((?:Visa|Mastercard) \d+(?:\.\d+)* - )", r"\n\n## \1", flat)
    flat = re.sub(r" (Visa Reason Codes|Mastercard Reason Codes) ", r"\n\n# \1\n\n", flat)
    return flat


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    text = convert(sys.argv[1])
    config.REASON_CODES_FILE.write_text(text)
    sections = text.count("\n## ")
    print(f"Wrote {config.REASON_CODES_FILE} ({sections} reason-code sections)")
