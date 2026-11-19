import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bannerDefinitions } from '../prisma/seeds/banner-data.js';

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

async function main() {
  const targetDir = resolve('uploads/banners');
  const publicTargetDir = resolve('public/uploads/banners');
  await mkdir(targetDir, { recursive: true });
  await mkdir(publicTargetDir, { recursive: true });

  console.log('📥 Downloading & Packaging 24 Promotional WebP Banner Images...');

  for (const bannerDef of bannerDefinitions) {
    const fileName = `banner-${bannerDef.tenantSlug}-${bannerDef.index}.webp`;
    const destPath = resolve(targetDir, fileName);
    const publicDestPath = resolve(publicTargetDir, fileName);

    const webpUrl = ensureWebpUrl(bannerDef.url);
    const res = await fetch(webpUrl, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} when downloading ${webpUrl}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error(`Empty image buffer downloaded from ${webpUrl}`);

    const headerRiff = buffer.subarray(0, 4).toString();
    const headerWebp = buffer.subarray(8, 12).toString();

    if (headerRiff !== 'RIFF' || headerWebp !== 'WEBP') {
      throw new Error(`Invalid WebP header for ${fileName}`);
    }

    await writeFile(destPath, buffer);
    await writeFile(publicDestPath, buffer);
  }

  console.log('✅ Successfully downloaded and validated 24 WebP banner images into uploads/banners/!');
}

main().catch((err) => {
  console.error('❌ Download Failed:', err.message || err);
  process.exit(1);
});
