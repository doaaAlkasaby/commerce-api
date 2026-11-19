import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'image/webp,*/*',
};

export const crossbodyImageDownloads = [
  // Product Gallery Images (5)
  { name: 'luma-crossbody-bag-main.webp', url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-crossbody-bag-angle2.webp', url: 'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-crossbody-bag-angle3.webp', url: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-crossbody-bag-angle4.webp', url: 'https://images.unsplash.com/photo-1598532163257-ae3c6b2524b6?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-crossbody-bag-angle5.webp', url: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=1000&h=1000&fit=crop&q=80&fm=webp' },

  // Beige Variants (2)
  { name: 'luma-crossbody-bag-beige-1.webp', url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-crossbody-bag-beige-2.webp', url: 'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?w=1000&h=1000&fit=crop&q=80&fm=webp' },

  // Black Variants (2)
  { name: 'luma-crossbody-bag-black-1.webp', url: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-crossbody-bag-black-2.webp', url: 'https://images.unsplash.com/photo-1598532163257-ae3c6b2524b6?w=1000&h=1000&fit=crop&q=80&fm=webp' },

  // Burgundy Variants (2)
  { name: 'luma-crossbody-bag-burgundy-1.webp', url: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-crossbody-bag-burgundy-2.webp', url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=1000&h=1000&fit=crop&q=80&fm=webp' },
];

async function main() {
  const targetDir = resolve('uploads/products');
  const publicTargetDir = resolve('public/uploads/products');
  await mkdir(targetDir, { recursive: true });
  await mkdir(publicTargetDir, { recursive: true });

  console.log('📥 Downloading & Packaging Crossbody Bag Studio WebP Images...');

  for (const item of crossbodyImageDownloads) {
    const destPath = resolve(targetDir, item.name);
    const publicDestPath = resolve(publicTargetDir, item.name);

    const res = await fetch(item.url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} when downloading ${item.url}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error(`Empty image buffer from ${item.url}`);

    const headerRiff = buffer.subarray(0, 4).toString();
    const headerWebp = buffer.subarray(8, 12).toString();

    if (headerRiff !== 'RIFF' || headerWebp !== 'WEBP') {
      throw new Error(`Invalid WebP header for ${item.name}`);
    }

    await writeFile(destPath, buffer);
    await writeFile(publicDestPath, buffer);
  }

  console.log('✅ Successfully downloaded and validated WebP crossbody bag product images!');
}

main().catch((err) => {
  console.error('❌ Download Failed:', err.message || err);
  process.exit(1);
});
