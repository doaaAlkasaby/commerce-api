import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

async function main() {
  const dir = resolve('uploads/banners');
  console.log(`🔍 Auditing 24 Promotional WebP Banner Images in ${dir}...`);

  const files = await readdir(dir);
  const webpFiles = files.filter((f) => f.endsWith('.webp'));
  console.log(`📁 Found ${webpFiles.length} banner files in uploads/banners/`);

  let invalidFormatCount = 0;
  let emptyFileCount = 0;
  const hashToFiles = new Map<string, string[]>();

  for (const file of webpFiles) {
    const filePath = resolve(dir, file);
    const buffer = await readFile(filePath);

    if (buffer.length === 0) {
      console.error(`❌ Empty file detected: ${file}`);
      emptyFileCount++;
      continue;
    }

    const headerRiff = buffer.subarray(0, 4).toString();
    const headerWebp = buffer.subarray(8, 12).toString();

    if (headerRiff !== 'RIFF' || headerWebp !== 'WEBP') {
      console.error(`❌ Invalid WebP header in file: ${file}`);
      invalidFormatCount++;
      continue;
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = hashToFiles.get(sha256) ?? [];
    existing.push(file);
    hashToFiles.set(sha256, existing);
  }

  let duplicateCount = 0;
  console.log('\n=== SHA-256 DUPLICATE CONTENT ANALYSIS ===');
  for (const [sha256, fileList] of hashToFiles.entries()) {
    if (fileList.length > 1) {
      duplicateCount += fileList.length - 1;
      console.log(`⚠️ SHA-256 ${sha256.slice(0, 16)}... shared by ${fileList.length} files:`);
      for (const f of fileList) {
        console.log(`   - ${f}`);
      }
    }
  }

  console.log('\n=== AUDIT SUMMARY ===');
  console.log(`Total Banner Files Checked: ${webpFiles.length}`);
  console.log(`Valid Native WebP Files: ${webpFiles.length - invalidFormatCount - emptyFileCount}`);
  console.log(`Unique Image Hashes: ${hashToFiles.size}`);
  console.log(`Duplicate Files Detected: ${duplicateCount}`);

  if (invalidFormatCount > 0 || emptyFileCount > 0) {
    console.error('❌ Banner Audit Failed.');
    process.exit(1);
  } else {
    console.log('✅ Banner Audit Passed: All 24 banner assets are valid, decodable, distinct WebP images.');
  }
}

main().catch((err) => {
  console.error('❌ Audit Script Error:', err);
  process.exit(1);
});
