import fitz
import hashlib
import json
import pathlib
import urllib.request

base = pathlib.Path("output/sri-country-release")
base.mkdir(parents=True, exist_ok=True)
url = "https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/f8d9bb36-5632-4f96-b463-b9265b55338c/FICHA%20TE%CC%81CNICA%20COMPROBANTES%20ELECTRO%CC%81NICOS%20ESQUEMA%20OFFLINE%20Versio%CC%81n%202.34.pdf"
pdf = urllib.request.urlopen(url, timeout=60).read()
doc = fitz.open(stream=pdf, filetype="pdf")
assert "2.34" in doc[0].get_text() and "JULIO 2026" in doc[0].get_text()
(base / "official-2.34.pdf").write_bytes(pdf)
for page in [79, 80, 81]:
    (base / f"page-{page+1}.txt").write_text(doc[page].get_text(sort=True), encoding="utf-8")
doc[80].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(str(base / "georgia-table.png"))
(base / "source.json").write_text(json.dumps({"url": url, "version": "2.34", "date": "JULIO 2026", "sha256": hashlib.sha256(pdf).hexdigest(), "pages": [80,81,82]}, indent=2), encoding="utf-8")
print((base / "page-81.txt").read_text(encoding="utf-8"))
