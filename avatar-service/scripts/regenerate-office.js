#!/usr/bin/env node
const path = require('path');
const { uploadPhoto, generateAvatar } = require('./generate-image');

const PHOTO_PATH = path.resolve(__dirname, '..', 'demo', '00_base_photo_cropped.png');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data', 'previews');

async function main() {
  console.log('📤 Uploading cropped photo...');
  const file = await uploadPhoto(PHOTO_PATH);
  console.log('✅ Uploaded:', file.uri);

  console.log('🎨 Generating casual_office (no text)...');
  const result = await generateAvatar(
    [file],
    'casual_office',
    OUTPUT_DIR,
    { quality: 'premium' },
    'regeneration'
  );

  if (result && result.filePath) {
    // Copy/rename to the expected filename
    const fs = require('fs');
    const target = path.join(OUTPUT_DIR, 'female_casual_office.png');
    fs.copyFileSync(result.filePath, target);
    console.log('✅ Copied to', target);
  }

  console.log('✅ Done!');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
