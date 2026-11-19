import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { catalogDefinitions } from '../prisma/seeds/catalog.seed.js';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'image/webp,*/*',
};

function ensureWebpUrl(url: string): string {
  const cleanUrl = url.trim();
  if (cleanUrl.includes('fm=webp')) return cleanUrl;
  return cleanUrl.includes('?') ? `${cleanUrl}&fm=webp` : `${cleanUrl}?fm=webp`;
}

async function downloadAndValidateImage(url: string, destPath: string, publicDestPath: string) {
  const webpUrl = ensureWebpUrl(url);
  const res = await fetch(webpUrl, { headers });

  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status} when downloading ${webpUrl}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await res.arrayBuffer());

  if (buffer.length === 0) {
    throw new Error(`Empty image buffer downloaded from ${webpUrl}`);
  }

  const headerRiff = buffer.subarray(0, 4).toString();
  const headerWebp = buffer.subarray(8, 12).toString();

  if (headerRiff !== 'RIFF' || headerWebp !== 'WEBP') {
    throw new Error(
      `Invalid WebP header from ${webpUrl} (ContentType: ${contentType}, Header: ${headerRiff}...${headerWebp})`,
    );
  }

  await writeFile(destPath, buffer);
  await writeFile(publicDestPath, buffer);
}

async function main() {
  const targetDir = resolve('uploads/catalog');
  const publicTargetDir = resolve('public/uploads/catalog');
  await mkdir(targetDir, { recursive: true });
  await mkdir(publicTargetDir, { recursive: true });

  console.log('📥 Downloading & Packaging Genuine WebP Catalog Images...');

  let categoryCount = 0;
  let productCount = 0;

  for (const tenantDef of catalogDefinitions) {
    for (const catDef of tenantDef.categories) {
      categoryCount++;
      const catFileName = `cat-${tenantDef.slug}-${catDef.slug}.webp`;
      const catPath = resolve(targetDir, catFileName);
      const publicCatPath = resolve(publicTargetDir, catFileName);

      await downloadAndValidateImage(catDef.imageUrl, catPath, publicCatPath);

      for (const prodDef of catDef.products) {
        productCount++;
        const prodFileName = `prod-${tenantDef.slug}-${prodDef.slug}.webp`;
        const prodPath = resolve(targetDir, prodFileName);
        const publicProdPath = resolve(publicTargetDir, prodFileName);

        await downloadAndValidateImage(prodDef.imageUrl, prodPath, publicProdPath);
      }
    }
  }

  console.log(`✅ Successfully downloaded and validated ${categoryCount} category WebP images and ${productCount} product WebP images into uploads/catalog/!`);
}

main().catch((err) => {
  console.error('❌ Download & Validation Failed:', err.message || err);
  process.exit(1);
});
