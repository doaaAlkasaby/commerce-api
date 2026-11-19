import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const artifactDir = '/Users/doaaalkasaby/Library/Caches/Google/AndroidStudio2026.2.1/projects/e-commerce.2f5afbd7/.artifacts/b87cc819-2f6c-4bc2-874b-26d025652dd3/contact_sheet';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'image/webp,*/*',
};

export const contactSheetDefinitions = [
  { store: 'Luma | Fashion', name: '1. Cotton T-shirt', filename: '01_luma_cotton_tshirt.webp', url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=1200&h=1200&fit=crop&q=80&fm=webp' },
  { store: 'Luma | Fashion', name: '2. Straight Denim Jeans', filename: '02_luma_straight_denim.webp', url: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=1200&h=1200&fit=crop&q=80&fm=webp' },
  { store: 'Luma | Fashion', name: '3. Everyday Cream Sneakers', filename: '03_luma_cream_sneakers.webp', url: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=1200&h=1200&fit=crop&q=80&fm=webp' },
  { store: 'Luma | Fashion', name: '4. Satin Evening Gown', filename: '04_luma_evening_gown.webp', url: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=1200&h=1200&fit=crop&q=80&fm=webp' },

  { store: 'Noura | Gifts', name: '5. Aromatherapy Soy Candle', filename: '05_noura_soy_candle.webp', url: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?w=1200&h=1200&fit=crop&q=80&fm=webp' },
  { store: 'Noura | Gifts', name: '6. Artisan Ceramic Vase', filename: '06_noura_ceramic_vase.webp', url: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=1200&h=1200&fit=crop&q=80&fm=webp' },

  { store: 'Toota | Kids', name: '7. Wooden Rainbow Stacker', filename: '07_toota_wooden_rainbow.webp', url: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=1200&h=1200&fit=crop&q=80&fm=webp' },
  { store: 'Toota | Kids', name: '8. Plush Cuddle Teddy Bear', filename: '08_toota_teddy_bear.webp', url: 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1200&h=1200&fit=crop&q=80&fm=webp' },

  { store: 'Dar | Home', name: '9. Nordic Lounge Chair', filename: '09_dar_nordic_chair.webp', url: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=1200&h=1200&fit=crop&q=80&fm=webp' },
  { store: 'Dar | Home', name: '10. Brass Table Lamp', filename: '10_dar_brass_lamp.webp', url: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=1200&h=1200&fit=crop&q=80&fm=webp' },

  { store: 'Velo | Sports', name: '11. Ultra-Light Runner Shoe', filename: '11_velo_runner_shoe.webp', url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&h=1200&fit=crop&q=80&fm=webp' },

  { store: 'Sera | Beauty', name: '12. Radiant Serum Dropper', filename: '12_sera_radiant_serum.webp', url: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=1200&h=1200&fit=crop&q=80&fm=webp' },
];

async function main() {
  await mkdir(artifactDir, { recursive: true });
  console.log(`📥 Downloading 12 Representative Studio Product Photographs to ${artifactDir}...`);

  for (const item of contactSheetDefinitions) {
    const destPath = resolve(artifactDir, item.filename);

    const res = await fetch(item.url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} when downloading ${item.url}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error(`Empty image buffer from ${item.url}`);

    const headerRiff = buffer.subarray(0, 4).toString();
    const headerWebp = buffer.subarray(8, 12).toString();

    if (headerRiff !== 'RIFF' || headerWebp !== 'WEBP') {
      throw new Error(`Invalid WebP header for ${item.filename}`);
    }

    await writeFile(destPath, buffer);
    console.log(`   ✓ Saved ${item.filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
  }

  console.log('✅ Stage A Contact Sheet Images Downloaded & Validated Successfully!');
}

main().catch((err) => {
  console.error('❌ Stage A Download Failed:', err.message || err);
  process.exit(1);
});
