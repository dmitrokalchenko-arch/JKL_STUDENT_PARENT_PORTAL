-- =====================================================================
-- JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql
-- =====================================================================
--
-- НАЗНАЧЕНИЕ: связать image_path с правильной записью public.judo_techniques
-- ПОСЛЕ того, как все 100 файлов реально загружены в Storage bucket
-- 'judo-techniques' (scripts/upload-judo-technique-images.mjs).
--
-- ⚠️ НЕ МИГРАЦИЯ, ВЫПОЛНЯТЬ ВРУЧНУЮ (тот же принцип, что и
-- docs/JUDO_TECHNIQUES_POST_DEPLOY_SMOKE_TEST.sql): этот файл сознательно
-- лежит в docs/, не в supabase/migrations/, потому что он имеет смысл только
-- ПОСЛЕ внешнего шага (upload в Storage), который supabase db push не
-- выполняет. Запускать через Dashboard SQL Editor (роль postgres/владелец
-- проекта — тогда RLS на judo_techniques не мешает) СРАЗУ ПОСЛЕ upload,
-- НИКОГДА до него.
--
-- ЧТО МЕНЯЕТ: только колонку image_path, только для этих 100 name.
-- НЕ трогает: youtube_url, youtube_video_id, category, main_group, active,
-- name — WHERE-условие матчит по name, SET есть только для image_path,
-- никаких других колонок в UPDATE нет физически.
--
-- Mapping ниже — тот же, что подтверждён в preflight-аудите этой сессии
-- (100 SUPABASE TECHNIQUES / 100 MATCHED IMAGES / 0 MISSING / 0 AMBIGUOUS /
-- 0 DUPLICATE), включая подтверждённые алиасы:
--   UDE-HISHIGI-<X>-GATAME.png -> <x>-gatame (8 болевых приёмов, официальное
--     полное IJF-название вместо короткого)
--   UCHI-MATA-GAESHI.png -> uchimata-gaeshi (расхождение слитно/через дефис)
-- Все имена файлов внутри storage_path — ТЕ ЖЕ имена, что и в bucket
-- (scripts/upload-judo-technique-images.mjs загружает файлы под их текущим
-- локальным именем, без переименования под name).
--
-- Выполнять ДВУМЯ отдельными запусками (как и smoke-test):
--   ЧАСТЬ 1 — UPDATE.
--   ЧАСТЬ 2 — проверочный блок (см. ниже).
-- =====================================================================

-- ── ЧАСТЬ 1: UPDATE image_path по name ─────────────────────────────────
update public.judo_techniques as jt
set image_path = v.image_path
from (
  values
    ('ashi-garami', 'techniques/ASHI-GARAMI.png'),
    ('ashi-gatame', 'techniques/UDE-HISHIGI-ASHI-GATAME.png'),
    ('ashi-guruma', 'techniques/ASHI-GURUMA.png'),
    ('daki-wakare', 'techniques/DAKI-WAKARE.png'),
    ('de-ashi-harai', 'techniques/DE-ASHI-HARAI.png'),
    ('do-jime', 'techniques/DO-JIME.png'),
    ('gyaku-juji-jime', 'techniques/GYAKU-JUJI-JIME.png'),
    ('hadaka-jime', 'techniques/HADAKA-JIME.png'),
    ('hane-goshi', 'techniques/HANE-GOSHI.png'),
    ('hane-goshi-gaeshi', 'techniques/HANE-GOSHI-GAESHI.png'),
    ('hane-makikomi', 'techniques/HANE-MAKIKOMI.png'),
    ('hara-gatame', 'techniques/UDE-HISHIGI-HARA-GATAME.png'),
    ('harai-goshi', 'techniques/HARAI-GOSHI.png'),
    ('harai-goshi-gaeshi', 'techniques/HARAI-GOSHI-GAESHI.png'),
    ('harai-makikomi', 'techniques/HARAI-MAKIKOMI.png'),
    ('harai-tsurikomi-ashi', 'techniques/HARAI-TSURIKOMI-ASHI.png'),
    ('hikikomi-gaeshi', 'techniques/HIKIKOMI-GAESHI.png'),
    ('hiza-gatame', 'techniques/UDE-HISHIGI-HIZA-GATAME.png'),
    ('hiza-guruma', 'techniques/HIZA-GURUMA.png'),
    ('ippon-seoi-nage', 'techniques/IPPON-SEOI-NAGE.png'),
    ('juji-gatame', 'techniques/UDE-HISHIGI-JUJI-GATAME.png'),
    ('kami-shiho-gatame', 'techniques/KAMI-SHIHO-GATAME.png'),
    ('kani-basami', 'techniques/KANI-BASAMI.png'),
    ('kata-gatame', 'techniques/KATA-GATAME.png'),
    ('kata-guruma', 'techniques/KATA-GURUMA.png'),
    ('kata-juji-jime', 'techniques/KATA-JUJI-JIME.png'),
    ('kataha-jime', 'techniques/KATAHA-JIME.png'),
    ('katate-jime', 'techniques/KATATE-JIME.png'),
    ('kawazu-gake', 'techniques/KAWAZU-GAKE.png'),
    ('kesa-gatame', 'techniques/KESA-GATAME.png'),
    ('kibisu-gaeshi', 'techniques/KIBISU-GAESHI.png'),
    ('ko-soto-gake', 'techniques/KO-SOTO-GAKE.png'),
    ('ko-soto-gari', 'techniques/KO-SOTO-GARI.png'),
    ('ko-uchi-gaeshi', 'techniques/KO-UCHI-GAESHI.png'),
    ('ko-uchi-gari', 'techniques/KO-UCHI-GARI.png'),
    ('ko-uchi-makikomi', 'techniques/KO-UCHI-MAKIKOMI.png'),
    ('koshi-guruma', 'techniques/KOSHI-GURUMA.png'),
    ('kuchiki-taoshi', 'techniques/KUCHIKI-TAOSHI.png'),
    ('kuzure-kami-shiho-gatame', 'techniques/KUZURE-KAMI-SHIHO-GATAME.png'),
    ('kuzure-kesa-gatame', 'techniques/KUZURE-KESA-GATAME.png'),
    ('morote-gari', 'techniques/MOROTE-GARI.png'),
    ('nami-juji-jime', 'techniques/NAMI-JUJI-JIME.png'),
    ('o-goshi', 'techniques/O-GOSHI.png'),
    ('o-guruma', 'techniques/O-GURUMA.png'),
    ('o-soto-gaeshi', 'techniques/O-SOTO-GAESHI.png'),
    ('o-soto-gari', 'techniques/O-SOTO-GARI.png'),
    ('o-soto-guruma', 'techniques/O-SOTO-GURUMA.png'),
    ('o-soto-makikomi', 'techniques/O-SOTO-MAKIKOMI.png'),
    ('o-soto-otoshi', 'techniques/O-SOTO-OTOSHI.png'),
    ('o-uchi-gaeshi', 'techniques/O-UCHI-GAESHI.png'),
    ('o-uchi-gari', 'techniques/O-UCHI-GARI.png'),
    ('obi-otoshi', 'techniques/OBI-OTOSHI.png'),
    ('obi-tori-gaeshi', 'techniques/OBI-TORI-GAESHI.png'),
    ('okuri-ashi-harai', 'techniques/OKURI-ASHI-HARAI.png'),
    ('okuri-eri-jime', 'techniques/OKURI-ERI-JIME.png'),
    ('ryote-jime', 'techniques/RYOTE-JIME.png'),
    ('sankaku-gatame', 'techniques/UDE-HISHIGI-SANKAKU-GATAME.png'),
    ('sankaku-jime', 'techniques/SANKAKU-JIME.png'),
    ('sasae-tsurikomi-ashi', 'techniques/SASAE-TSURIKOMI-ASHI.png'),
    ('seoi-nage', 'techniques/SEOI-NAGE.png'),
    ('seoi-otoshi', 'techniques/SEOI-OTOSHI.png'),
    ('sode-guruma-jime', 'techniques/SODE-GURUMA-JIME.png'),
    ('sode-tsurikomi-goshi', 'techniques/SODE-TSURIKOMI-GOSHI.png'),
    ('soto-makikomi', 'techniques/SOTO-MAKIKOMI.png'),
    ('sukui-nage', 'techniques/SUKUI-NAGE.png'),
    ('sumi-gaeshi', 'techniques/SUMI-GAESHI.png'),
    ('sumi-otoshi', 'techniques/SUMI-OTOSHI.png'),
    ('tai-otoshi', 'techniques/TAI-OTOSHI.png'),
    ('tani-otoshi', 'techniques/TANI-OTOSHI.png'),
    ('tate-shiho-gatame', 'techniques/TATE-SHIHO-GATAME.png'),
    ('tawara-gaeshi', 'techniques/TAWARA-GAESHI.png'),
    ('te-gatame', 'techniques/UDE-HISHIGI-TE-GATAME.png'),
    ('tomoe-nage', 'techniques/TOMOE-NAGE.png'),
    ('tsubame-gaeshi', 'techniques/TSUBAME-GAESHI.png'),
    ('tsukomi-jime', 'techniques/TSUKOMI-JIME.png'),
    ('tsuri-goshi', 'techniques/TSURI-GOSHI.png'),
    ('tsurikomi-goshi', 'techniques/TSURIKOMI-GOSHI.png'),
    ('uchi-makikomi', 'techniques/UCHI-MAKIKOMI.png'),
    ('uchi-mata', 'techniques/UCHI-MATA.png'),
    ('uchi-mata-makikomi', 'techniques/UCHI-MATA-MAKIKOMI.png'),
    ('uchi-mata-sukashi', 'techniques/UCHI-MATA-SUKASHI.png'),
    ('uchimata-gaeshi', 'techniques/UCHI-MATA-GAESHI.png'),
    ('ude-garami', 'techniques/UDE-GARAMI.png'),
    ('ude-gatame', 'techniques/UDE-HISHIGI-UDE-GATAME.png'),
    ('uki-gatame', 'techniques/UKI-GATAME.png'),
    ('uki-goshi', 'techniques/UKI-GOSHI.png'),
    ('uki-otoshi', 'techniques/UKI-OTOSHI.png'),
    ('uki-waza', 'techniques/UKI-WAZA.png'),
    ('ura-gatame', 'techniques/URA-GATAME.png'),
    ('ura-nage', 'techniques/URA-NAGE.png'),
    ('ushiro-goshi', 'techniques/USHIRO-GOSHI.png'),
    ('ushiro-kesa-gatame', 'techniques/USHIRO-KESA-GATAME.png'),
    ('utsuri-goshi', 'techniques/UTSURI-GOSHI.png'),
    ('waki-gatame', 'techniques/UDE-HISHIGI-WAKI-GATAME.png'),
    ('yama-arashi', 'techniques/YAMA-ARASHI.png'),
    ('yoko-gake', 'techniques/YOKO-GAKE.png'),
    ('yoko-guruma', 'techniques/YOKO-GURUMA.png'),
    ('yoko-otoshi', 'techniques/YOKO-OTOSHI.png'),
    ('yoko-shiho-gatame', 'techniques/YOKO-SHIHO-GATAME.png'),
    ('yoko-wakare', 'techniques/YOKO-WAKARE.png')
) as v(name, image_path)
where jt.name = v.name;

-- ── ЧАСТЬ 2: проверочный блок (выполнить ОТДЕЛЬНЫМ запуском) ───────────
-- Громкий RAISE EXCEPTION при несовпадении — тот же принцип, что и в
-- 20260908120042_seed_judo_techniques_100.sql.
do $$
declare
  v_total integer;
  v_with_image integer;
  v_without_image integer;
  v_with_youtube integer;
  v_without_youtube integer;
  v_distinct_image_path integer;
begin
  select count(*) into v_total from public.judo_techniques;
  select count(*) into v_with_image from public.judo_techniques where image_path is not null and btrim(image_path) <> '';
  select count(*) into v_without_image from public.judo_techniques where image_path is null or btrim(image_path) = '';
  select count(*) into v_with_youtube from public.judo_techniques where youtube_url is not null and btrim(youtube_url) <> '';
  select count(*) into v_without_youtube from public.judo_techniques where youtube_url is null or btrim(youtube_url) = '';
  select count(distinct image_path) into v_distinct_image_path from public.judo_techniques where image_path is not null;

  if v_total <> 100 then
    raise exception 'judo_techniques: expected 100 rows, found %', v_total;
  end if;
  if v_with_image <> 100 then
    raise exception 'judo_techniques: expected 100 rows with image_path, found %', v_with_image;
  end if;
  if v_without_image <> 0 then
    raise exception 'judo_techniques: expected 0 rows without image_path, found %', v_without_image;
  end if;
  if v_with_youtube <> 100 then
    raise exception 'judo_techniques: expected 100 rows with youtube_url (must stay unchanged), found %', v_with_youtube;
  end if;
  if v_without_youtube <> 0 then
    raise exception 'judo_techniques: expected 0 rows without youtube_url, found %', v_without_youtube;
  end if;
  if v_distinct_image_path <> 100 then
    raise exception 'judo_techniques: expected 100 DISTINCT image_path (no image shared by two techniques), found %', v_distinct_image_path;
  end if;

  raise notice 'POST_IMAGE_LINK_CHECK: GREEN — 100/100 image_path, 100/100 youtube_url, 100 distinct image_path';
end $$;

-- Выборочная проверка (минимум 10 техник из разных категорий, включая
-- обязательные из задания) — просмотреть result grid:
select name, category, main_group, image_path, youtube_url, youtube_video_id
from public.judo_techniques
where name in (
  'ippon-seoi-nage', 'uchi-mata', 'uchimata-gaeshi', 'harai-makikomi',
  'ashi-gatame', 'juji-gatame',
  'kami-shiho-gatame', 'do-jime', 'tomoe-nage', 'o-soto-gari'
)
order by name;
