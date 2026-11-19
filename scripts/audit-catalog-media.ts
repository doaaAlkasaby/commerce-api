import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

async function main() {
  const dir = resolve('uploads/catalog');
  console.log(`🔍 Auditing catalog WebP media files in ${dir}...`);

  const files = await readdir(dir);
  console.log(`📁 Found ${files.length} files in uploads/catalog/`);

  let invalidFormatCount = 0;
  let emptyFileCount = 0;
  const hashToFiles = new Map<String, string[]>();

  for (const file of files) {
    if (!file.endsWith('.webp')) continue;

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
      console.error(`❌ Invalid WebP header in file: ${file} (RIFF: "${headerRiff}", WEBP: "${headerWebp}")`);
      invalidFormatCount++;
      continue;
    }

    const hash = createHash('md5').update(buffer).digest('hex');
    const existing = hashToFiles.get(hash) ?? [];
    existing.push(file);
    hashToFiles.set(hash, existing);
  }

  let duplicateCount = 0;
  console.log('\n=== DUPLICATE CONTENT ANALYSIS ===');
  for (const [hash, fileList] of hashToFiles.entries()) {
    if (fileList.length > 1) {
      duplicateCount += fileList.length - 1;
      console.log(`⚠️ Hash ${hash} shared by ${fileList.length} files:`);
      for (const f of fileList) {
        console.log(`   - ${f}`);
      }
    }
  }

  console.log('\n=== AUDIT SUMMARY ===');
  console.log(`Total Files Checked: ${files.length}`);
  console.log(`Valid WebP Files: ${files.length - invalidFormatCount - emptyFileCount}`);
  console.log(`Invalid Format Files: ${invalidFormatCount}`);
  console.log(`Empty Files: ${emptyFileCount}`);
  console.log(`Duplicate Files Detected: ${duplicateCount}`);

  if (invalidFormatCount > 0 || emptyFileCount > 0) {
    console.error('❌ Audit Failed: Invalid or empty WebP files present.');
    process.exit(1);
  } else {
    console.log('✅ Audit Passed: All catalog media files are valid, decodable WebP images.');
  }
}

main().catch((err) => {
  console.error('❌ Audit Script Error:', err);
  process.exit(1);
});
