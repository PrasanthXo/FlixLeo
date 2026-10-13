// Build the Windows icon directly from the same FlixLeo logo shown on the site.
// The official logo SVG embeds a WebP image; sharp decodes that source, so the
// installed EXE, taskbar, window and desktop shortcut all use the actual brand.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const root = path.resolve(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'public', 'flixleo-logo.svg'), 'utf8');
  const image = /data:image\/webp;base64,([^"'<>\\s]+)/i.exec(svg);
  if (!image) throw new Error('Official FlixLeo brand image was not found.');
  const source = Buffer.from(image[1], 'base64');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map(size =>
    sharp(source).resize(size, size, { fit: 'contain' }).png().toBuffer()
  ));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const base = 6 + 16 * i;
    header[base] = sizes[i] === 256 ? 0 : sizes[i];
    header[base + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header[base + 2] = 0;
    header[base + 3] = 0;
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(png.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(__dirname, 'brand-icon.ico'), Buffer.concat([header, ...pngs]));
  fs.writeFileSync(path.join(__dirname, 'brand-icon.png'), pngs[pngs.length - 1]);
  console.log('FlixLeo official desktop brand icon generated for EXE and shortcut.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
