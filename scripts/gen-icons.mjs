import sharp from "sharp";
import fs from "node:fs";

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="100" ry="100" fill="url(#g)"/>
  <g fill="#0b1220">
    <path d="M 120 270 C 120 165, 200 110, 256 110 C 312 110, 392 165, 392 270 L 392 360 Q 392 396, 358 396 L 322 396 Q 290 396, 290 360 L 290 290 Q 290 258, 322 258 Z"/>
    <path d="M 120 270 L 120 360 Q 120 396, 154 396 L 190 396 Q 222 396, 222 360 L 222 290 Q 222 258, 190 258 L 120 258 Z"/>
    <path d="M 120 270 C 120 165, 200 110, 256 110 C 312 110, 392 165, 392 270" fill="none" stroke="#0b1220" stroke-width="22" stroke-linecap="round"/>
  </g>
  <g stroke="#0b1220" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.7">
    <path d="M 60 200 Q 30 256, 60 312"/>
    <path d="M 452 200 Q 482 256, 452 312"/>
  </g>
</svg>`;

async function gen(size, file) {
  await sharp(Buffer.from(svg(size))).resize(size, size).png().toFile(file);
  console.log("  " + file + " (" + size + "x" + size + ", " + fs.statSync(file).size + " bytes)");
}

await gen(192, "public/icon-192.png");
await gen(512, "public/icon-512.png");
await gen(180, "public/apple-touch-icon.png");
console.log("done");