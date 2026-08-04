import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";

const { PNG } = pngjs;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const assets = join(root, "assets");
const sourceSvg = join(assets, "app-icon.svg");
const renderDir = join(root, ".icon-render");
const iconset = join(assets, "app-icon.iconset");

// The generated icon SVG is committed to assets/. To regenerate it from a new
// brand source, point MAXIMO_LOGO_SVG at the source SVG. Without it the script
// exits early and the committed icons are left untouched.
const suppliedLogo = process.env.MAXIMO_LOGO_SVG;
if (!suppliedLogo) {
  console.log("MAXIMO_LOGO_SVG not set; keeping committed app icons in assets/.");
  process.exit(0);
}
if (!existsSync(suppliedLogo)) throw new Error(`Supplied Maximo logo was not found: ${suppliedLogo}`);

const original = readFileSync(suppliedLogo, "utf8");
const defs = original.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
const pathsStart = original.indexOf("</defs>") + "</defs>".length;
const wordmarkStart = original.indexOf('<path transform="translate(0,0)" fill="rgb(251,254,254)" d="M 1241.67 1439.58');
if (!defs || pathsStart < 0 || wordmarkStart < 0) throw new Error("The supplied Maximo SVG structure was not recognized.");

const mark = original.slice(pathsStart, wordmarkStart)
  .replace(/<path transform="translate\(0,0\)" fill="url\(#Gradient10\)"[\s\S]*?\/>/, "")
  .trim();

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" width="1024" height="1024" preserveAspectRatio="xMidYMid meet">
${defs}
<rect x="88" y="88" width="1872" height="1872" rx="430" fill="url(#Gradient10)"/>
<g transform="translate(-205 -180) scale(1.2)">
${mark}
</g>
</svg>`;

mkdirSync(assets, { recursive: true });
rmSync(renderDir, { recursive: true, force: true });
mkdirSync(renderDir, { recursive: true });
writeFileSync(sourceSvg, iconSvg);

execFileSync("/usr/bin/qlmanage", ["-t", "-s", "1024", "-o", renderDir, sourceSvg], { stdio: "ignore" });
const rendered = join(renderDir, "app-icon.svg.png");
if (!existsSync(rendered)) throw new Error("macOS did not render the generated app icon.");

// Quick Look composites SVG thumbnails onto opaque white. Reapply the icon's
// rounded-square alpha mask and borrow edge colours from a fully covered pixel
// so the exported PNG has no white matte/halo when macOS draws it in the Dock.
const png = PNG.sync.read(readFileSync(rendered));
const unit = png.width / 2048;
const left = 88 * unit;
const top = 88 * unit;
const right = 1960 * unit;
const bottom = 1960 * unit;
const radius = 430 * unit;
const samples = 4;

const isInside = (x, y) => {
  if (x < left || x > right || y < top || y > bottom) return false;
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
};

const pixelOffset = (x, y) => (y * png.width + x) * 4;
for (let y = 0; y < png.height; y += 1) {
  for (let x = 0; x < png.width; x += 1) {
    let covered = 0;
    for (let sy = 0; sy < samples; sy += 1) {
      for (let sx = 0; sx < samples; sx += 1) {
        if (isInside(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples)) covered += 1;
      }
    }

    const offset = pixelOffset(x, y);
    if (covered === 0) {
      png.data[offset] = 0;
      png.data[offset + 1] = 0;
      png.data[offset + 2] = 0;
      png.data[offset + 3] = 0;
      continue;
    }

    const coverage = covered / (samples * samples);
    if (coverage < 1) {
      // Move a few pixels toward the icon centre to avoid Quick Look's white
      // matte contaminating antialiased boundary pixels.
      const sourceX = Math.max(0, Math.min(png.width - 1, Math.round(x + Math.sign(png.width / 2 - x) * 3)));
      const sourceY = Math.max(0, Math.min(png.height - 1, Math.round(y + Math.sign(png.height / 2 - y) * 3)));
      const source = pixelOffset(sourceX, sourceY);
      png.data[offset] = png.data[source];
      png.data[offset + 1] = png.data[source + 1];
      png.data[offset + 2] = png.data[source + 2];
      png.data[offset + 3] = Math.round(255 * coverage);
    } else {
      png.data[offset + 3] = 255;
    }
  }
}

const finalPng = join(assets, "app-icon.png");
writeFileSync(finalPng, PNG.sync.write(png));

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const [file, size] of [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32], ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256], ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
]) {
  execFileSync("/usr/bin/sips", ["-z", String(size), String(size), finalPng, "--out", join(iconset, file)], { stdio: "ignore" });
}
execFileSync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", join(assets, "app-icon.icns")]);

// Windows accepts a PNG-compressed 256px ICO entry. Keeping it generated from
// the same alpha-correct source prevents platform-specific white borders.
const icoPng = readFileSync(join(iconset, "icon_256x256.png"));
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt8(0, 6);
icoHeader.writeUInt8(0, 7);
icoHeader.writeUInt8(0, 8);
icoHeader.writeUInt8(0, 9);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(icoPng.length, 14);
icoHeader.writeUInt32LE(22, 18);
writeFileSync(join(assets, "app-icon.ico"), Buffer.concat([icoHeader, icoPng]));
rmSync(renderDir, { recursive: true, force: true });

console.log(`Built rounded Maximo app icon from ${suppliedLogo}`);
