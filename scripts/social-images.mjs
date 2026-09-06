/**
 * Shared rendering and frontmatter helpers for the per-app social image
 * generators. Each app keeps a thin `scripts/generate-social-images.mjs` that
 * collects its content items and calls into this module, so the card layouts
 * only have to be maintained once.
 *
 * All cards are 1200x630 WebP images written to the app's `public/og/`
 * directory (a gitignored build artifact), regenerated incrementally by the
 * dev/build scripts: a card is skipped when its inputs are unchanged.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";

export const WIDTH = 1200;
export const HEIGHT = 630;

const COVER_SIZE = 500;
const COVER_LEFT = 64;
const TEXT_LEFT = 628;
const HERO_TEXT_LEFT = 64;
const BACKGROUND_COLOR = "#14101c";
const TITLE_COLOR = "#f5f2fa";
const BRAND_COLOR = "#9a93ad";
const BRAND_MUTED_COLOR = "#b9b3c6";

/* System fonts available on common Linux build hosts (Render, CI). */
export const FONT_STACK = "DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif";

export const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;
export const TITLE_PATTERN = /^title:\s*(.+)$/m;
export const DRAFT_PATTERN = /^draft:\s*true\s*$/m;
export const RASTER_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
]);
/* Mirrors the extension preference used by music's src/utils/imageAssets.ts. */
export const PREFERRED_EXTENSIONS = [".webp", ".avif", ".jpg", ".jpeg", ".png"];

/* Mirrors the Astro content id generation used for page URLs. */
export const normalizeSlug = (slug) => slug.toLocaleLowerCase("en").replaceAll(" ", "-");

export const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const wrapTitle = (title, maxCharsPerLine = 18, maxLines = 4) => {
  const words = String(title).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxCharsPerLine - 1).trimEnd()}…`;
    return kept;
  }

  return lines;
};

export const readFrontmatterTitle = (frontmatter) => {
  const match = frontmatter.match(TITLE_PATTERN);
  if (!match) {
    return undefined;
  }
  return match[1].trim().replace(/^["']|["']$/g, "");
};

/*
 * Indexes raster images in a directory by extensionless stem. When multiple
 * extensions share a stem the preferred extension wins (frontmatter values may
 * reference a different extension than the file on disk).
 */
export const buildImageIndex = (directory) => {
  const index = new Map();

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (!RASTER_IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }

    const stem = entry.name.slice(0, -extension.length);
    const existing = index.get(stem);
    if (
      !existing ||
      PREFERRED_EXTENSIONS.indexOf(extension) <
        PREFERRED_EXTENSIONS.indexOf(extname(existing).toLowerCase())
    ) {
      index.set(stem, join(directory, entry.name));
    }
  }

  return index;
};

const bestEffortTextLayer = async (layers, svgMarkup) => {
  try {
    const svgBuffer = Buffer.from(svgMarkup);
    await sharp(svgBuffer).metadata();
    layers.push({ input: svgBuffer, top: 0, left: 0 });
  } catch {
    /* The text layer is best-effort; the card still works without it. */
  }
};

const writeCard = (layers, outputPath, quality) =>
  sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: BACKGROUND_COLOR },
  })
    .composite(layers)
    .webp({ quality })
    .toFile(outputPath);

const buildCoverTitleSvg = (title, brandLine) => {
  const lines = wrapTitle(title);
  const fontSize = 54;
  const lineHeight = 70;
  const startY = Math.round((HEIGHT - lines.length * lineHeight) / 2) + fontSize;

  const textMarkup = lines
    .map(
      (line, index) =>
        `<text x="${TEXT_LEFT}" y="${startY + index * lineHeight}" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="bold" fill="${TITLE_COLOR}">${escapeXml(line)}</text>`
    )
    .join("");

  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">${textMarkup}<text x="${TEXT_LEFT}" y="${HEIGHT - 48}" font-family="${FONT_STACK}" font-size="30" fill="${BRAND_COLOR}">${escapeXml(brandLine)}</text></svg>`;
};

/* Artwork on a blurred, darkened copy of itself with the title on the right. */
export const generateCoverCard = async ({ title, imagePath, brandLine }, outputPath) => {
  const imageBuffer = readFileSync(imagePath);

  const background = await sharp(imageBuffer)
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .blur(28)
    .composite([
      {
        input: {
          create: {
            width: WIDTH,
            height: HEIGHT,
            channels: 4,
            background: { r: 12, g: 10, b: 18, alpha: 0.55 },
          },
        },
        blend: "over",
      },
    ])
    .toBuffer();

  const cover = await sharp(imageBuffer)
    .resize(COVER_SIZE, COVER_SIZE, { fit: "cover" })
    .toBuffer();

  const layers = [
    { input: background },
    {
      input: cover,
      top: Math.round((HEIGHT - COVER_SIZE) / 2),
      left: COVER_LEFT,
    },
  ];
  await bestEffortTextLayer(layers, buildCoverTitleSvg(title, brandLine));

  return writeCard(layers, outputPath, 82);
};

/* Darkens the lower half so light hero images keep title text readable. */
const buildGradientSvg = () =>
  `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.3" stop-color="#0c0a12" stop-opacity="0"/><stop offset="1" stop-color="#0c0a12" stop-opacity="0.9"/></linearGradient></defs><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/></svg>`;

const buildHeroTitleSvg = (title, brandLine) => {
  const lines = wrapTitle(title, 30, 3);
  const fontSize = 50;
  const lineHeight = 64;
  const brandY = HEIGHT - 40;
  const startY = brandY - 24 - (lines.length - 1) * lineHeight - fontSize * 0.3;

  const textMarkup = lines
    .map(
      (line, index) =>
        `<text x="${HERO_TEXT_LEFT}" y="${Math.round(startY + index * lineHeight)}" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="bold" fill="${TITLE_COLOR}">${escapeXml(line)}</text>`
    )
    .join("");

  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">${textMarkup}<text x="${HERO_TEXT_LEFT}" y="${brandY}" font-family="${FONT_STACK}" font-size="28" fill="${BRAND_MUTED_COLOR}">${escapeXml(brandLine)}</text></svg>`;
};

/* Full-bleed hero image with a dark gradient and the title bottom-left. */
export const generateHeroCard = async ({ title, imagePath, brandLine }, outputPath) => {
  const background = await sharp(imagePath)
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .toBuffer();

  const layers = [{ input: background }, { input: Buffer.from(buildGradientSvg()) }];
  await bestEffortTextLayer(layers, buildHeroTitleSvg(title, brandLine));

  return writeCard(layers, outputPath, 82);
};

/* Fallback card for items without artwork: brand background + centered title. */
export const generateTitleCard = async ({ title, brandLine }, outputPath) => {
  const lines = wrapTitle(title, 24, 5);
  const fontSize = 56;
  const lineHeight = 74;
  const startY = Math.round((HEIGHT - lines.length * lineHeight) / 2) + fontSize;

  const textMarkup = lines
    .map(
      (line, index) =>
        `<text x="${WIDTH / 2}" y="${startY + index * lineHeight}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="bold" fill="${TITLE_COLOR}">${escapeXml(line)}</text>`
    )
    .join("");

  const layers = [];
  await bestEffortTextLayer(
    layers,
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">${textMarkup}<text x="${WIDTH / 2}" y="${HEIGHT - 48}" text-anchor="middle" font-family="${FONT_STACK}" font-size="30" fill="${BRAND_COLOR}">${escapeXml(brandLine)}</text></svg>`
  );

  return writeCard(layers, outputPath, 85);
};

/* Default card: brand background with the centered MelodyMind logo. */
export const generateLogoCard = async (logoPath, outputPath) => {
  const logoMetadata = await sharp(logoPath).metadata();
  const logoWidth = 560;
  const logoHeight = Math.round((logoMetadata.height * logoWidth) / logoMetadata.width);
  const logo = await sharp(logoPath).resize(logoWidth).toBuffer();

  return writeCard(
    [
      {
        input: logo,
        top: Math.round((HEIGHT - logoHeight) / 2),
        left: Math.round((WIDTH - logoWidth) / 2),
      },
    ],
    outputPath,
    85
  );
};

/* Default card: brand background with the site name and tagline. */
export const generateBrandCard = async ({ brandLine, tagline }, outputPath) => {
  const fontSize = 64;
  const layers = [];
  await bestEffortTextLayer(
    layers,
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><text x="${WIDTH / 2}" y="${HEIGHT / 2 + fontSize / 3}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="bold" fill="${TITLE_COLOR}">${escapeXml(brandLine)}</text><text x="${WIDTH / 2}" y="${HEIGHT / 2 + 56}" text-anchor="middle" font-family="${FONT_STACK}" font-size="30" fill="${BRAND_COLOR}">${escapeXml(tagline)}</text></svg>`
  );

  return writeCard(layers, outputPath, 85);
};

/*
 * Regenerates the app's public/og directory incrementally: one `<slug>.webp`
 * per collected item plus a default.webp. Items without `imagePath` use the
 * fallback card when one is provided, otherwise they are skipped. A card is
 * only re-rendered when its inputs changed (title, brand line, artwork path
 * and mtime); otherwise the existing card is kept. Stale artifacts from
 * previous runs (old JPEGs, orphaned hashes/cards) are cleaned up at the end.
 */
export const runSocialImageBuild = async ({
  outputDirectory,
  itemLabel,
  items,
  brandLine,
  generateCard,
  generateFallbackCard,
  generateDefaultCard,
  defaultCardKey,
}) => {
  mkdirSync(outputDirectory, { recursive: true });

  const hashOf = (key) => createHash("sha256").update(JSON.stringify(key)).digest("hex");
  const isUpToDate = (outputPath, hashPath, hash) =>
    existsSync(outputPath) && existsSync(hashPath) && readFileSync(hashPath, "utf8") === hash;

  let generated = 0;
  let skipped = 0;

  for (const item of items) {
    const outputPath = join(outputDirectory, `${item.slug}.webp`);
    const hashPath = join(outputDirectory, `${item.slug}.hash`);
    const hash = hashOf({
      title: item.title,
      brandLine,
      imagePath: item.imagePath ?? null,
      imageMtimeMs: item.imagePath ? statSync(item.imagePath).mtimeMs : null,
    });
    if (isUpToDate(outputPath, hashPath, hash)) {
      skipped += 1;
      continue;
    }
    if (item.imagePath) {
      await generateCard(item, outputPath);
    } else if (generateFallbackCard) {
      await generateFallbackCard(item, outputPath);
    } else {
      continue;
    }
    writeFileSync(hashPath, hash);
    generated += 1;
  }

  const defaultOutputPath = join(outputDirectory, "default.webp");
  const defaultHashPath = join(outputDirectory, "default.hash");
  const defaultHash = hashOf(defaultCardKey);
  if (isUpToDate(defaultOutputPath, defaultHashPath, defaultHash)) {
    skipped += 1;
  } else {
    await generateDefaultCard(defaultOutputPath);
    writeFileSync(defaultHashPath, defaultHash);
    generated += 1;
  }

  /* Remove leftovers: old JPEGs, hashes without a card, cards without an item. */
  const expectedCards = new Set([...items.map((item) => `${item.slug}.webp`), "default.webp"]);
  for (const name of readdirSync(outputDirectory)) {
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
      rmSync(join(outputDirectory, name));
    } else if (name.endsWith(".hash")) {
      if (!existsSync(join(outputDirectory, `${name.slice(0, -".hash".length)}.webp`))) {
        rmSync(join(outputDirectory, name));
      }
    } else if (name.endsWith(".webp") && !expectedCards.has(name)) {
      rmSync(join(outputDirectory, name));
    }
  }

  console.log(
    `[social-images] Generated ${generated}, skipped ${skipped} ${itemLabel} images in ${outputDirectory}`
  );
};
