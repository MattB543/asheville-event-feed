/**
 * Generate SEO images (apple-touch-icon and og-image) from existing favicon
 *
 * Run with: npx tsx scripts/generate-seo-images.ts
 */

import sharp from "sharp";
import path from "path";
import fs from "fs";

const publicDir = path.join(process.cwd(), "public");
const faviconPath = path.join(publicDir, "avlgo_favicon.png");

async function generateAppleTouchIcon() {
  const outputPath = path.join(publicDir, "apple-touch-icon.png");

  await sharp(faviconPath)
    .resize(180, 180, {
      fit: "contain",
      background: { r: 8, g: 113, b: 170, alpha: 1 }, // #0871aa
    })
    .png()
    .toFile(outputPath);

  console.log(`✓ Generated apple-touch-icon.png (180x180)`);
}

async function generateOgImage() {
  const outputPath = path.join(publicDir, "og-image.png");

  // Create OG image with brand color background and centered logo
  const width = 1200;
  const height = 630;
  const logoSize = 300;

  // Read the favicon as a buffer
  const logoBuffer = await sharp(faviconPath)
    .resize(logoSize, logoSize, { fit: "contain" })
    .toBuffer();

  // Create the OG image with the logo centered
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 8, g: 113, b: 170, alpha: 1 }, // #0871aa
    },
  })
    .composite([
      {
        input: logoBuffer,
        top: Math.floor((height - logoSize) / 2),
        left: Math.floor((width - logoSize) / 2),
      },
    ])
    .png()
    .toFile(outputPath);

  console.log(`✓ Generated og-image.png (1200x630)`);
}

async function generateFavicon192() {
  const outputPath = path.join(publicDir, "favicon-192.png");

  await sharp(faviconPath)
    .resize(192, 192, {
      fit: "contain",
      background: { r: 8, g: 113, b: 170, alpha: 1 },
    })
    .png()
    .toFile(outputPath);

  console.log(`✓ Generated favicon-192.png (192x192)`);
}

async function generateFavicon512() {
  const outputPath = path.join(publicDir, "favicon-512.png");

  await sharp(faviconPath)
    .resize(512, 512, {
      fit: "contain",
      background: { r: 8, g: 113, b: 170, alpha: 1 },
    })
    .png()
    .toFile(outputPath);

  console.log(`✓ Generated favicon-512.png (512x512)`);
}

async function main() {
  console.log("Generating SEO images...\n");

  if (!fs.existsSync(faviconPath)) {
    console.error(`Error: Favicon not found at ${faviconPath}`);
    process.exit(1);
  }

  try {
    await generateAppleTouchIcon();
    await generateOgImage();
    await generateFavicon192();
    await generateFavicon512();

    console.log("\n✅ All SEO images generated successfully!");
    console.log("\nGenerated files:");
    console.log("  - public/apple-touch-icon.png (180x180) - iOS home screen icon");
    console.log("  - public/og-image.png (1200x630) - Social sharing preview");
    console.log("  - public/favicon-192.png (192x192) - PWA icon");
    console.log("  - public/favicon-512.png (512x512) - PWA splash icon");
  } catch (error) {
    console.error("Error generating images:", error);
    process.exit(1);
  }
}

main();
