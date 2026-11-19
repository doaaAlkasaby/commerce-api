import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'image/webp,*/*',
};

export const task11ImageDownloads = [
  // Product A: Linen Shirt (Gallery & Color Variants)
  { name: 'luma-linen-shirt-main.webp', url: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-linen-shirt-white-1.webp', url: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-linen-shirt-white-2.webp', url: 'https://images.unsplash.com/photo-1621072156002-e2fccdc0b176?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-linen-shirt-beige-1.webp', url: 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-linen-shirt-beige-2.webp', url: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-linen-shirt-navy-1.webp', url: 'https://images.unsplash.com/photo-1603252109303-2751441dd157?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-linen-shirt-navy-2.webp', url: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=1000&h=1000&fit=crop&q=80&fm=webp' },

  // Product B: Leather Travel Organizer (Gallery & Variant)
  { name: 'luma-organizer-main.webp', url: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=1000&h=1000&fit=crop&q=80&fm=webp' },
  { name: 'luma-organizer-angle2.webp', url: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=1000&h=1000&fit=crop&q=80&fm=webp' },
];

async function main() {
  const targetDir = resolve('uploads/products');
  const publicTargetDir = resolve('public/uploads/products');
  await mkdir(targetDir, { recursive: true });
  await mkdir(publicTargetDir, { recursive: true });

  console.log('📥 Downloading & Packaging Task 11 Studio WebP Product Images...');

  for (const item of task11ImageDownloads) {
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

  console.log('✅ Successfully downloaded and validated Task 11 WebP product images!');
}

main().catch((err) => {
  console.error('❌ Download Failed:', err.message || err);
  process.exit(1);
});
