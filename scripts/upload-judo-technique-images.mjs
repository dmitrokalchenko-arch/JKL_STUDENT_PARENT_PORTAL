// Загружает 100 изображений техник дзюдо из локальной папки
// C:\VSCode_Projects\100 Technics в Supabase Storage bucket 'judo-techniques'.
//
// НЕ трогает public.judo_techniques — привязка image_path выполняется
// отдельно, вручную, через docs/JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql ПОСЛЕ
// того, как этот скрипт подтвердит, что в bucket ровно 100 ожидаемых
// объектов. Разделение шагов намеренное: Storage-запись (это) и
// DB-запись (SQL вручную) — два разных момента, каждый со своей проверкой,
// а не один непрозрачный шаг.
//
// Требует service_role key (RLS не подчиняется). НИКОГДА не кладите его в
// .env / .env.example — эти файлы читает Vite и включает в клиентский
// бандл (VITE_-переменные видны в браузере). Используйте .env.local
// (уже в .gitignore, Vite его не бандлит с сервера — но этот скрипт
// запускается ТОЛЬКО локально через `node`, не через Vite, поэтому даже
// .env.local здесь безопасен для service_role).
//
// Запуск:
//   node scripts/upload-judo-technique-images.mjs           (dry-run отчёт)
//   node scripts/upload-judo-technique-images.mjs --apply   (реальная загрузка)
//   node scripts/upload-judo-technique-images.mjs --apply --overwrite
//     (перезаписать уже существующие объекты — по умолчанию существующие
//     ПРОПУСКАЮТСЯ, а не перезаписываются, см. п.9 задания)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOCAL_ROOT = 'C:\\VSCode_Projects\\100 Technics';
const BUCKET = 'judo-techniques';
const STORAGE_PREFIX = 'techniques';
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.svg']);
const EXCLUDE_DIRS = ['Kihon judo'];

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.tiff': 'image/tiff', '.svg': 'image/svg+xml',
};

// ---- 100 техник из public.judo_techniques (см. seed-миграцию
// 20260908120042_seed_judo_techniques_100.sql) — используются только для
// имени, matching делается по этому списку + явным алиасам ниже, без
// подключения к БД (эта часть read-only по определению, никаких сетевых
// запросов до самого upload). ----
const TECHNIQUE_NAMES = [
  'ashi-garami','ashi-gatame','ashi-guruma','daki-wakare','de-ashi-harai','do-jime',
  'gyaku-juji-jime','hadaka-jime','hane-goshi','hane-goshi-gaeshi','hane-makikomi',
  'hara-gatame','harai-goshi','harai-goshi-gaeshi','harai-makikomi','harai-tsurikomi-ashi',
  'hikikomi-gaeshi','hiza-gatame','hiza-guruma','ippon-seoi-nage','juji-gatame',
  'kami-shiho-gatame','kani-basami','kata-gatame','kata-guruma','kata-juji-jime',
  'kataha-jime','katate-jime','kawazu-gake','kesa-gatame','kibisu-gaeshi','ko-soto-gake',
  'ko-soto-gari','ko-uchi-gaeshi','ko-uchi-gari','ko-uchi-makikomi','koshi-guruma',
  'kuchiki-taoshi','kuzure-kami-shiho-gatame','kuzure-kesa-gatame','morote-gari',
  'nami-juji-jime','o-goshi','o-guruma','o-soto-gaeshi','o-soto-gari','o-soto-guruma',
  'o-soto-makikomi','o-soto-otoshi','o-uchi-gaeshi','o-uchi-gari','obi-otoshi',
  'obi-tori-gaeshi','okuri-ashi-harai','okuri-eri-jime','ryote-jime','sankaku-gatame',
  'sankaku-jime','sasae-tsurikomi-ashi','seoi-nage','seoi-otoshi','sode-guruma-jime',
  'sode-tsurikomi-goshi','soto-makikomi','sukui-nage','sumi-gaeshi','sumi-otoshi',
  'tai-otoshi','tani-otoshi','tate-shiho-gatame','tawara-gaeshi','te-gatame','tomoe-nage',
  'tsubame-gaeshi','tsukomi-jime','tsuri-goshi','tsurikomi-goshi','uchi-makikomi',
  'uchi-mata','uchi-mata-makikomi','uchi-mata-sukashi','uchimata-gaeshi','ude-garami',
  'ude-gatame','uki-gatame','uki-goshi','uki-otoshi','uki-waza','ura-gatame','ura-nage',
  'ushiro-goshi','ushiro-kesa-gatame','utsuri-goshi','waki-gatame','yama-arashi',
  'yoko-gake','yoko-guruma','yoko-otoshi','yoko-shiho-gatame','yoko-wakare',
];
if (TECHNIQUE_NAMES.length !== 100) {
  throw new Error(`Expected 100 technique names, got ${TECHNIQUE_NAMES.length}`);
}
const TECH_SET = new Set(TECHNIQUE_NAMES);

// Только явно подтверждённые пользователем алиасы — никакого fuzzy matching.
const EXPLICIT_ALIASES = {
  'ude-hishigi-ashi-gatame': 'ashi-gatame',
  'ude-hishigi-hara-gatame': 'hara-gatame',
  'ude-hishigi-hiza-gatame': 'hiza-gatame',
  'ude-hishigi-juji-gatame': 'juji-gatame',
  'ude-hishigi-sankaku-gatame': 'sankaku-gatame',
  'ude-hishigi-te-gatame': 'te-gatame',
  'ude-hishigi-ude-gatame': 'ude-gatame',
  'ude-hishigi-waki-gatame': 'waki-gatame',
  'uchi-mata-gaeshi': 'uchimata-gaeshi',
};

function normalize(fname) {
  let name = fname.replace(/\.[^.]+$/, '');
  name = name.replace(/\(\d+\)\s*$/, '');
  name = name.replace(/[_\s]+/g, '-');
  name = name.replace(/-+/g, '-');
  return name.replace(/^-+|-+$/g, '').trim().toLowerCase();
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.some((ex) => full.toLowerCase().includes(ex.toLowerCase()))) continue;
      walk(full, out);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMG_EXT.has(ext)) out.push({ dir, name: entry.name, full });
    }
  }
}

function buildMapping() {
  const images = [];
  walk(LOCAL_ROOT, images);

  const byTech = {};
  for (const img of images) {
    const norm = normalize(img.name);
    const tech = TECH_SET.has(norm) ? norm : EXPLICIT_ALIASES[norm] || null;
    if (!tech) continue;
    byTech[tech] = byTech[tech] || [];
    byTech[tech].push(img);
  }

  const mapping = TECHNIQUE_NAMES.map((name) => {
    const imgs = byTech[name] || [];
    return {
      name,
      filename: imgs[0]?.name ?? null,
      localPath: imgs[0]?.full ?? null,
      storagePath: imgs[0] ? `${STORAGE_PREFIX}/${imgs[0].name}` : null,
      matchCount: imgs.length,
    };
  });

  const missing = mapping.filter((m) => !m.filename);
  const duplicates = mapping.filter((m) => m.matchCount > 1);
  return { mapping, missing, duplicates, imagesScanned: images.length };
}

function loadEnvLocal() {
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  loadEnvLocal();

  const apply = process.argv.includes('--apply');
  const overwrite = process.argv.includes('--overwrite');

  const { mapping, missing, duplicates, imagesScanned } = buildMapping();

  console.log('IMAGES SCANNED (excluding Kihon judo):', imagesScanned);
  console.log('TECHNIQUES:', mapping.length);
  console.log('MATCHED:', mapping.length - missing.length);
  console.log('MISSING:', missing.length);
  console.log('DUPLICATE MATCHES:', duplicates.length);

  if (missing.length > 0 || duplicates.length > 0) {
    console.error('\nABORTING: mapping is not 100/100 clean. Fix local files first.');
    missing.forEach((m) => console.error('  MISSING image for:', m.name));
    duplicates.forEach((d) => console.error('  DUPLICATE images for:', d.name, d));
    process.exit(1);
  }

  if (!apply) {
    console.log('\nDRY RUN (pass --apply to actually upload). Planned uploads:');
    for (const m of mapping) console.log(`  ${m.name.padEnd(28)} ${m.filename.padEnd(35)} -> ${BUCKET}/${m.storagePath}`);
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error('\nABORTING: missing SUPABASE_URL (or VITE_SUPABASE_URL) env var.');
    process.exit(1);
  }
  if (!serviceKey) {
    console.error('\nABORTING: missing SUPABASE_SERVICE_ROLE_KEY env var.');
    console.error('Anon key (VITE_SUPABASE_ANON_KEY) cannot write to Storage under this bucket/RLS setup — service_role is required.');
    console.error('Set it in .env.local (already gitignored), e.g.: SUPABASE_SERVICE_ROLE_KEY=eyJ...');
    process.exit(1);
  }
  if (serviceKey === process.env.VITE_SUPABASE_ANON_KEY) {
    console.error('\nABORTING: SUPABASE_SERVICE_ROLE_KEY equals the anon key. That is the wrong key.');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  console.log(`\nUploading ${mapping.length} files to bucket "${BUCKET}" (overwrite=${overwrite}) ...`);

  const uploaded = [];
  const skippedExisting = [];
  const errors = [];

  for (const m of mapping) {
    const ext = path.extname(m.filename).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const fileBuffer = fs.readFileSync(m.localPath);

    if (!overwrite) {
      const { data: existing } = await supabase.storage
        .from(BUCKET)
        .list(STORAGE_PREFIX, { search: m.filename });
      if (existing && existing.some((o) => o.name === m.filename)) {
        skippedExisting.push(m);
        continue;
      }
    }

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(m.storagePath, fileBuffer, { contentType, upsert: overwrite });

    if (error) errors.push({ name: m.name, storagePath: m.storagePath, error: error.message });
    else uploaded.push(m);
  }

  console.log('\nUPLOADED:', uploaded.length);
  console.log('SKIPPED (already existed, use --overwrite to replace):', skippedExisting.length);
  console.log('ERRORS:', errors.length);
  errors.forEach((e) => console.error('  ERROR:', e.name, e.storagePath, '-', e.error));

  // Финальная проверка: ровно 100 ожидаемых объектов присутствуют в bucket.
  const { data: listing, error: listErr } = await supabase.storage.from(BUCKET).list(STORAGE_PREFIX, { limit: 1000 });
  if (listErr) {
    console.error('\nCould not list bucket contents for verification:', listErr.message);
    process.exit(1);
  }
  const namesInBucket = new Set((listing || []).map((o) => o.name));
  const expectedNames = mapping.map((m) => m.filename);
  const foundCount = expectedNames.filter((n) => namesInBucket.has(n)).length;
  const missingInBucket = expectedNames.filter((n) => !namesInBucket.has(n));

  console.log('\nEXPECTED OBJECTS IN BUCKET:', expectedNames.length);
  console.log('FOUND IN BUCKET:', foundCount);
  console.log('MISSING FROM BUCKET:', missingInBucket.length);
  if (missingInBucket.length) missingInBucket.forEach((n) => console.error('  MISSING FROM BUCKET:', n));

  if (foundCount !== 100) {
    console.error('\nRESULT: NOT 100/100 in bucket. Do NOT proceed to JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql yet.');
    process.exit(1);
  }
  console.log('\nRESULT: 100/100 objects confirmed in bucket "judo-techniques/techniques/".');
  console.log('Next step: run docs/JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql manually in the Supabase SQL Editor.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
