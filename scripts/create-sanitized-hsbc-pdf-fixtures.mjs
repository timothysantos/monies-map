import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

if (!process.argv[2]) {
  console.error("Usage: node scripts/create-sanitized-hsbc-pdf-fixtures.mjs /path/to/hsbc-pdfs [output-dir]");
  process.exit(1);
}

const inputDir = resolve(process.argv[2]);
const outputDir = resolve(process.argv[3] ?? "tests/fixtures/hsbc-ocr/image-pdf");
const months = ["feb", "mar", "apr", "may", "jun", "jul"];
const tempDir = await mkdtemp(join(tmpdir(), "monies-map-hsbc-sanitize-"));
const python = process.env.PYTHON ?? "python3";

const pythonSanitizer = String.raw`
import sys
from PIL import Image, ImageDraw, ImageFont
import PIL.JpegImagePlugin

output_pdf = sys.argv[1]
page_paths = sys.argv[2:]

def font(size):
    for name in ("Arial.ttf", "Helvetica.ttc", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            pass
    return ImageFont.load_default()

def redact(draw, box, text=None, size=27):
    draw.rectangle(box, fill="white")
    if text:
        draw.multiline_text((box[0] + 10, box[1] + 6), text, fill="black", font=font(size), spacing=4)

pages = []
for index, path in enumerate(page_paths):
    image = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(image)
    if index == 0:
        redact(draw, (145, 410, 730, 470), "TEST CARD HOLDER", 30)
        redact(draw, (145, 470, 560, 530), "4000-0000-0000-0000", 28)
        redact(draw, (150, 925, 1160, 1005), "TEST CARD HOLDER 4000-XXXX-XXXX-0000", 22)
        redact(draw, (145, 2200, 620, 2390), "TEST CARD HOLDER\n1 TEST AVENUE\n#01-01\nSINGAPORE 000000", 22)
    pages.append(image)

pages[0].save(output_pdf, save_all=True, append_images=pages[1:], resolution=220.0)
`;

try {
  await execFileAsync("mkdir", ["-p", outputDir]);
  const sanitizerPath = join(tempDir, "sanitize.py");
  await writeFile(sanitizerPath, pythonSanitizer, "utf8");
  for (const month of months) {
    const sourcePdfName = (await readdir(inputDir))
      .find((file) => file.toLowerCase().endsWith(`-${month}_2026.pdf`));
    if (!sourcePdfName) {
      throw new Error(`Missing HSBC source PDF for ${month} 2026 in ${inputDir}`);
    }
    const sourcePdf = join(inputDir, sourcePdfName);
    const renderPrefix = join(tempDir, `hsbc-${month}`);
    await execFileAsync("pdftoppm", ["-png", "-r", "220", sourcePdf, renderPrefix]);

    const pageImages = (await readdir(tempDir))
      .filter((file) => file.startsWith(`hsbc-${month}-`) && file.endsWith(".png"))
      .sort((left, right) => Number(left.match(/-(\d+)\.png$/)?.[1] ?? 0) - Number(right.match(/-(\d+)\.png$/)?.[1] ?? 0))
      .map((file) => join(tempDir, file));

    const outputPdf = join(outputDir, `hsbc-visa-revolution-${month}-2026.sanitized.pdf`);
    await execFileAsync(
      python,
      [
        sanitizerPath,
        outputPdf,
        ...pageImages
      ],
      { maxBuffer: 1024 * 1024 * 20 }
    );
    console.log(`Wrote ${outputPdf}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
