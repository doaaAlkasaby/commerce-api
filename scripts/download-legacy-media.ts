import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'image/webp,*/*',
};

export const legacyImageDownloads = [
  // Luma - Cotton T-Shirt
  { name: 'luma-tee-front.webp', url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&h=800&fit=crop&q=80&fm=webp' },
  { name: 'luma-tee-detail.webp', url: 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&h=800&fit=crop&q=80&fm=webp' },

  // Luma - Straight Denim
  { name: 'luma-denim-front.webp', url: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=800&h=800&fit=crop&q=80&fm=webp' },
  { name: 'luma-denim-detail.webp', url: 'https://images.unsplash.com/photo-1582552938357-32b906df40cb?w=800&h=800&fit=crop&q=80&fm=webp' },

  // Luma - Everyday Sneakers
  { name: 'luma-shoes-front.webp', url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&h=800&fit=crop&q=80&fm=webp' },
  { name: 'luma-shoes-detail.webp', url: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800&h=800&fit=crop&q=80&fm=webp' },

  // Noura - Cotton T-Shirt
  { name: 'noura-tee-front.webp', url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&h=800&fit=crop&q=80&fm=webp' },
  { name: 'noura-tee-detail.webp', url: 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&h=800&fit=crop&q=80&fm=webp' },

  // Noura - Straight Denim
  { name: 'noura-denim-front.webp', url: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=800&h=800&fit=crop&q=80&fm=webp' },
  { name: 'noura-denim-detail.webp', url: 'https://images.unsplash.com/photo-1582552938357-32b906df40cb?w=800&h=800&fit=crop&q=80&fm=webp' },

  // Noura - Everyday Sneakers
  { name: 'noura-shoes-front.webp', url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&h=800&fit=crop&q=80&fm=webp' },
  { name: 'noura-shoes-detail.webp', url: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800&h=800&fit=crop&q=80&fm=webp' },
];

async function main() {
  const targetDir = resolve('uploads/legacy-products');
  const publicTargetDir = resolve('public/uploads/legacy-products');
  await mkdir(targetDir, { recursive: true });
  await mkdir(publicTargetDir, { recursive: true });

  console.log('📥 Downloading & Packaging 12 Real WebP Photographic Assets for Legacy Products...');

  for (const item of legacyImageDownloads) {
    const destPath = resolve(targetDir, item.name);
    const publicDestPath = resolve(publicTargetDir, item.name);

    const res = await fetch(item.url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} when downloading ${item.url}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error(`Empty image buffer downloaded from ${item.url}`);

    const headerRiff = buffer.subarray(0, 4).toString();
    const headerWebp = buffer.subarray(8, 12).toString();

    if (headerRiff !== 'RIFF' || headerWebp !== 'WEBP') {
      throw new Error(`Invalid WebP header for ${item.name}`);
    }

    await writeFile(destPath, buffer);
    await writeFile(publicDestPath, buffer);
  }

  console.log('✅ Successfully downloaded and validated 12 real WebP product images into uploads/legacy-products/!');
}

main().catch((err) => {
  console.error('❌ Download Failed:', err.message || err);
  process.exit(1);
});
