# Folio PDF Studio

A local, Acrobat-inspired PDF workspace. Run `./Start-Folio.ps1` in PowerShell, then open http://127.0.0.1:8765. Keep the server running while you work.

## Features

- Open and view PDFs, thumbnails, page navigation, zoom, password-protected input.
- Add text and images; replace selectable text using a standard Latin font.
- Highlight, comment, draw rectangles, typed visual signatures, true area redaction, crop.
- Fill text fields, checkboxes, dropdowns and list boxes in existing PDF forms.
- Merge files, split into individual PDFs in a ZIP, extract selected pages.
- Drag to reorder, accessible move buttons, delete, duplicate, rotate, insert blank pages.
- Watermarks, page numbering, lossless optimization, PNG ZIP and plain text export.
- AES-256 password-protected exports; undo/redo for the last 12 operations.

## Reusable signature image

Choose **Sign document → Upload signature image** and select a PNG, JPG, BMP, or WebP saved from Paint (up to 10 MB). In **Signature settings**, preview it and click **Apply** to save your template. Crop unused space in Paint before uploading for a closer fit.

- **Remove background:** choose any background color and adjust tolerance to remove similar shades. Presets cover black ink on white and white ink on black; these preserve the original ink color.
- **Change ink color:** recolor remaining visible pixels to black, white, or any chosen color. Remove a solid background first so it is not recolored along with the ink.
- **Preview surface:** checkerboard, dark, or white to inspect contrast. This preview surface is never inserted into the PDF.
- **Signature settings** reopens these controls on your saved template. New templates retain their original image so edits are reversible without cumulative quality loss. Older templates may need re-uploading to recover pixels previously removed. Saved settings affect future placements, not signatures already placed in a PDF.

Background removal works best with a mostly uniform background distinct from the signature ink; patterned backgrounds or matching ink/background colors may require cleanup in Paint.

Open a PDF, choose **Sign document → Add signature**, then drag the signature image to position it. Drag any corner handle to resize it proportionally. You can add multiple signatures, reselect them, move them again, or delete them using the × control.

Choose **Add text**, then click the page for a default text box or draw its initial size. Type directly inside it. Drag the **Move** control to reposition it and the corner handles to change its width and height. Font size and color controls update the selected text object. Arrow keys on Move nudge the object; Shift makes larger steps. Corner handles also support arrow keys.

**Save a copy** includes these editable objects in the exported PDF while keeping their handles available in the current session. They stay on their respective pages when navigating and zooming. **Apply objects to PDF** writes them into page content and removes handles. Other PDF edits and organizing pages prompt you to apply objects first. Exported/reopened PDFs have these objects embedded as page content, not saved as Folio editing layers. Download before closing or refreshing. An export error (such as text not fitting) leaves the editable objects available for correction.

The single reusable template is stored in this browser's IndexedDB on this computer. It survives document changes, reloads, and server restarts; it is not shared between browsers or different site addresses (localhost versus 127.0.0.1). Clearing browser data removes it. **Replace signature image** updates it; **Remove saved template** deletes the template without changing signatures already placed in PDFs. **Type a signature** remains available. Image signatures are visual marks, not certificate-based digital signatures.

## How to use

1. Open a PDF. The original disk file is never overwritten.
2. Select an editing tool and drag a box on the page. For existing text, click the outlined text area. For form fields, use the right panel.
3. Open Organize pages to select or rearrange pages. Merge appends files in picker order; rearrange afterward as needed.
4. Save a copy, or use Export & protect. Split downloads one PDF per page; Extract downloads one combined PDF containing selected pages.
5. Close the document when finished to clear its server session.

## Scope and limitations

This is a working local application, not full Adobe Acrobat parity. No OCR, Word/Excel conversion, PDF/A validation, digital certificate signing, document comparison, collaborative review or cloud storage. Scanned PDFs can be annotated but do not have editable text until OCR is added. Replacing text uses a standard font and white background, without paragraph reflow or exact original-font preservation. Added text supports Latin characters. Crop hides content and is not redaction. Area redaction does not sanitize metadata or other pages. Optimization is lossless and may not reduce every file.

PDF digital signatures become invalid when the document is rewritten. Typed signatures are visual only. Existing form controls remain interactive where supported; complex XFA forms are unsupported. Test important documents using a copy.

Files are held in server memory until closed or the server stops. Refreshing the browser loses access to the current session; sessions are not a durable autosave. Up to 10 open sessions, 50 MB per PDF and 10 MB per inserted image. Undo snapshots can consume significant RAM on large documents. Server binds to loopback and rejects foreign origins/hosts; it is not designed for public network deployment or multiple users. Interface fonts load from Google Fonts; PDF contents are not sent there.

## Development

Python 3.11+; FastAPI and PyMuPDF. Install requirements into `.venv`. Start with `.venv/Scripts/python -m uvicorn server:app --host 127.0.0.1 --port 8765`.

Tests: install `httpx` into the same environment, then `.venv/Scripts/python -m unittest test_workflows.py`.

Engine documentation: https://pymupdf.readthedocs.io/en/latest/page.html

PyMuPDF is distributed under AGPL/commercial licensing. Review its license before proprietary distribution.
