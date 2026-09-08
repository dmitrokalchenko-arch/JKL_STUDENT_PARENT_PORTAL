-- Импорт 100 официальных техник дзюдо (IJF Academy / UCJI) в judo_techniques.
-- Источник: IJF_Academy_UCJI_Techniques_Categories_YouTube.xlsx (3 колонки:
-- Technique | Category | YouTube URL), распарсен напрямую из XML внутри
-- .xlsx (без ручной перепечатки — построчный экспорт из sheet1.xml), затем
-- построчно сверен: 100 строк, 0 пустых полей, 0 дублей названий, все 100
-- URL прошли формат-проверку (youtu.be/<11 симв.>), распределение по 8
-- категориям сошлось 1-в-1 с ожидаемым (см. отчёт сессии, CATEGORY COUNTS).
--
-- ИСПРАВЛЕНО ВЛАДЕЛЬЦЕМ ДАННЫХ (после отчёта о проверке этой сессии):
-- в исходном файле 'uchi-mata' и 'uchimata-gaeshi' указывали на ОДИН И ТОТ
-- ЖЕ YouTube URL (https://youtu.be/6CbcIRSK93k) — это было опечаткой, не
-- намеренным решением. Владелец подтвердил правильные значения:
--   uchi-mata         -> https://youtu.be/F27ReC9AALM  (изменено)
--   uchimata-gaeshi    -> https://youtu.be/6CbcIRSK93k  (без изменений)
-- Изменена ТОЛЬКО строка uchi-mata — остальные 99 строк не тронуты.
--
-- youtube_video_id НЕ передаётся явно — заполняется автоматически триггером
-- trg_judo_techniques_youtube_video_id (см. предыдущую миграцию) для каждой
-- вставляемой строки.
--
-- ON CONFLICT (name) DO NOTHING: миграция безопасно переисполняема (повторный
-- прогон не создаёт дублей и не перезаписывает уже существующие строки).

insert into public.judo_techniques (name, category, youtube_url) values
  ('ashi-garami', 'Kansetsu-waza', 'https://youtu.be/yZSTP9mmVRo'),
  ('ashi-gatame', 'Kansetsu-waza', 'https://youtu.be/EpSVFvv2mow'),
  ('ashi-guruma', 'Ashi-waza', 'https://youtu.be/0O0boT3Q5bw'),
  ('daki-wakare', 'Yoko-sutemi-waza', 'https://youtu.be/FYIBvobXWvc'),
  ('de-ashi-harai', 'Ashi-waza', 'https://youtu.be/5DXxopGDIo4'),
  ('do-jime', 'Shime-waza', 'https://youtu.be/7J2szfU-XyE'),
  ('gyaku-juji-jime', 'Shime-waza', 'https://youtu.be/97mYGlOmiCc'),
  ('hadaka-jime', 'Shime-waza', 'https://youtu.be/cXQ9H269wsk'),
  ('hane-goshi', 'Koshi-waza', 'https://youtu.be/u9LfhDTY374'),
  ('hane-goshi-gaeshi', 'Ashi-waza', 'https://youtu.be/NCxAzkzsMLw'),
  ('hane-makikomi', 'Yoko-sutemi-waza', 'https://youtu.be/S68DY1o4uqc'),
  ('hara-gatame', 'Kansetsu-waza', 'https://youtu.be/-Dqq3DVJRXs'),
  ('harai-goshi', 'Koshi-waza', 'https://youtu.be/dkyU4jhvyU0'),
  ('harai-goshi-gaeshi', 'Ashi-waza', 'https://youtu.be/oo9MV1xvqVg'),
  ('harai-makikomi', 'Yoko-sutemi-waza', 'https://youtu.be/-10ZkK3sc44'),
  ('harai-tsurikomi-ashi', 'Ashi-waza', 'https://youtu.be/D08Y_diq3Mo'),
  ('hikikomi-gaeshi', 'Ma-sutemi-waza', 'https://youtu.be/Wb4xut0Riao'),
  ('hiza-gatame', 'Kansetsu-waza', 'https://youtu.be/kJOB0Ji23Yw'),
  ('hiza-guruma', 'Ashi-waza', 'https://youtu.be/b2DNT1ensAA'),
  ('ippon-seoi-nage', 'Te-waza', 'https://youtu.be/e2KDjPiTES0'),
  ('juji-gatame', 'Kansetsu-waza', 'https://youtu.be/KJByePAuVwc'),
  ('kami-shiho-gatame', 'Osaekomi-waza', 'https://youtu.be/MXPvW39dsFg'),
  ('kani-basami', 'Yoko-sutemi-waza', 'https://youtu.be/si5QaLTBZEc'),
  ('kata-gatame', 'Osaekomi-waza', 'https://youtu.be/P3CA_5cfDJ8'),
  ('kata-guruma', 'Te-waza', 'https://youtu.be/nTEHhz_qtnU'),
  ('kata-juji-jime', 'Shime-waza', 'https://youtu.be/fur0vB7ahqM'),
  ('kataha-jime', 'Shime-waza', 'https://youtu.be/a5e-eyH_h6c'),
  ('katate-jime', 'Shime-waza', 'https://youtu.be/OJdLJ74n5s0'),
  ('kawazu-gake', 'Yoko-sutemi-waza', 'https://youtu.be/1Asfvk5Epys'),
  ('kesa-gatame', 'Osaekomi-waza', 'https://youtu.be/hTgmhUR0NoQ'),
  ('kibisu-gaeshi', 'Te-waza', 'https://youtu.be/xjBY4YAquEc'),
  ('ko-soto-gake', 'Ashi-waza', 'https://youtu.be/qn4gMnOVWyM'),
  ('ko-soto-gari', 'Ashi-waza', 'https://youtu.be/w8DMzM93abY'),
  ('ko-uchi-gaeshi', 'Te-waza', 'https://youtu.be/rnl_-nHXYUA'),
  ('ko-uchi-gari', 'Ashi-waza', 'https://youtu.be/n_DjvcbBRac'),
  ('ko-uchi-makikomi', 'Yoko-sutemi-waza', 'https://youtu.be/uQ4-7-t2-Mw'),
  ('koshi-guruma', 'Koshi-waza', 'https://youtu.be/btTTUT6b9Nw'),
  ('kuchiki-taoshi', 'Te-waza', 'https://youtu.be/UkHEd-TuhZQ'),
  ('kuzure-kami-shiho-gatame', 'Osaekomi-waza', 'https://youtu.be/O5xXxtfD1eU'),
  ('kuzure-kesa-gatame', 'Osaekomi-waza', 'https://youtu.be/ZfsRXCotDRo'),
  ('morote-gari', 'Te-waza', 'https://youtu.be/ZT_21mbjqXc'),
  ('nami-juji-jime', 'Shime-waza', 'https://youtu.be/RKlrb_x_0Ic'),
  ('o-goshi', 'Koshi-waza', 'https://youtu.be/DKKGfLGswpY'),
  ('o-guruma', 'Ashi-waza', 'https://youtu.be/aOxp0IqWJVo'),
  ('o-soto-gaeshi', 'Ashi-waza', 'https://youtu.be/jkPH48qyc04'),
  ('o-soto-gari', 'Ashi-waza', 'https://youtu.be/PsNQYtA0AbA'),
  ('o-soto-guruma', 'Ashi-waza', 'https://youtu.be/Bck9kF_TR34'),
  ('o-soto-makikomi', 'Yoko-sutemi-waza', 'https://youtu.be/DchG01qtafw'),
  ('o-soto-otoshi', 'Ashi-waza', 'https://youtu.be/BQoxtD6nTQU'),
  ('o-uchi-gaeshi', 'Ashi-waza', 'https://youtu.be/kLUasbXJX6Q'),
  ('o-uchi-gari', 'Ashi-waza', 'https://youtu.be/iBPllkkMRrQ'),
  ('obi-otoshi', 'Te-waza', 'https://youtu.be/M52piCaamys'),
  ('obi-tori-gaeshi', 'Te-waza', 'https://youtu.be/IiO3Goyb_M4'),
  ('okuri-ashi-harai', 'Ashi-waza', 'https://youtu.be/HMOM_0yGNcs'),
  ('okuri-eri-jime', 'Shime-waza', 'https://youtu.be/Bas51bRjgX4'),
  ('ryote-jime', 'Shime-waza', 'https://youtu.be/k5y-koUBulk'),
  ('sankaku-gatame', 'Kansetsu-waza', 'https://youtu.be/mNyFYT4w-m8'),
  ('sankaku-jime', 'Shime-waza', 'https://youtu.be/5M_PsJbLgII'),
  ('sasae-tsurikomi-ashi', 'Ashi-waza', 'https://youtu.be/-aSv1xNBlqU'),
  ('seoi-nage', 'Te-waza', 'https://youtu.be/aM0eMxVFL78'),
  ('seoi-otoshi', 'Te-waza', 'https://youtu.be/3A_kWJ85iRU'),
  ('sode-guruma-jime', 'Shime-waza', 'https://youtu.be/lZfXR2Qk9mM'),
  ('sode-tsurikomi-goshi', 'Koshi-waza', 'https://youtu.be/iIrxzF9cvkc'),
  ('soto-makikomi', 'Yoko-sutemi-waza', 'https://youtu.be/2DXTeIWRVIY'),
  ('sukui-nage', 'Te-waza', 'https://youtu.be/7Rj2QDegi-g'),
  ('sumi-gaeshi', 'Ma-sutemi-waza', 'https://youtu.be/_qLypMcm_As'),
  ('sumi-otoshi', 'Te-waza', 'https://youtu.be/9LP5w6Ql4nE'),
  ('tai-otoshi', 'Te-waza', 'https://youtu.be/C_9d2WZKy44'),
  ('tani-otoshi', 'Yoko-sutemi-waza', 'https://youtu.be/GlWh7Zi-nmk'),
  ('tate-shiho-gatame', 'Osaekomi-waza', 'https://youtu.be/0jOFwtIYURk'),
  ('tawara-gaeshi', 'Ma-sutemi-waza', 'https://youtu.be/56Fdb-hx0Dc'),
  ('te-gatame', 'Kansetsu-waza', 'https://youtu.be/wkjK1MAK9o8'),
  ('tomoe-nage', 'Ma-sutemi-waza', 'https://youtu.be/yEyx65nI4WM'),
  ('tsubame-gaeshi', 'Ashi-waza', 'https://youtu.be/asPjlKBTmEE'),
  ('tsukomi-jime', 'Shime-waza', 'https://youtu.be/CUgg3hpv9vk'),
  ('tsuri-goshi', 'Koshi-waza', 'https://youtu.be/jcujlpRFuDo'),
  ('tsurikomi-goshi', 'Koshi-waza', 'https://youtu.be/MhyhroJIPAY'),
  ('uchi-makikomi', 'Yoko-sutemi-waza', 'https://youtu.be/9jQfWxMJYpM'),
  ('uchi-mata', 'Ashi-waza', 'https://youtu.be/F27ReC9AALM'),
  ('uchi-mata-makikomi', 'Yoko-sutemi-waza', 'https://youtu.be/TBMyho7n5e8'),
  ('uchi-mata-sukashi', 'Te-waza', 'https://youtu.be/7rCe9M_wu24'),
  ('uchimata-gaeshi', 'Ashi-waza', 'https://youtu.be/6CbcIRSK93k'),
  ('ude-garami', 'Kansetsu-waza', 'https://youtu.be/AeiL6o7vfeE'),
  ('ude-gatame', 'Kansetsu-waza', 'https://youtu.be/pCrqiF6bXgo'),
  ('uki-gatame', 'Osaekomi-waza', 'https://youtu.be/KKeYFN8ArY0'),
  ('uki-goshi', 'Koshi-waza', 'https://youtu.be/ThXpT0qt_uQ'),
  ('uki-otoshi', 'Te-waza', 'https://youtu.be/nIvrGDejOko'),
  ('uki-waza', 'Yoko-sutemi-waza', 'https://youtu.be/673X6aTz9O0'),
  ('ura-gatame', 'Osaekomi-waza', 'https://youtu.be/iJ_UcM0bu2M'),
  ('ura-nage', 'Ma-sutemi-waza', 'https://youtu.be/09jPRGmlCq0'),
  ('ushiro-goshi', 'Koshi-waza', 'https://youtu.be/7dSXrwyP3V8'),
  ('ushiro-kesa-gatame', 'Osaekomi-waza', 'https://youtu.be/4oOTNgvnpVk'),
  ('utsuri-goshi', 'Koshi-waza', 'https://youtu.be/aIW1J9acUtc'),
  ('waki-gatame', 'Kansetsu-waza', 'https://youtu.be/vxfqI0n5qj4'),
  ('yama-arashi', 'Te-waza', 'https://youtu.be/B6PrbslJ_AA'),
  ('yoko-gake', 'Yoko-sutemi-waza', 'https://youtu.be/u7lEntYM_6c'),
  ('yoko-guruma', 'Yoko-sutemi-waza', 'https://youtu.be/sdbv4DGUvAU'),
  ('yoko-otoshi', 'Yoko-sutemi-waza', 'https://youtu.be/D62VoTiUibo'),
  ('yoko-shiho-gatame', 'Osaekomi-waza', 'https://youtu.be/ZGsNMs0Gl74'),
  ('yoko-wakare', 'Yoko-sutemi-waza', 'https://youtu.be/fVn2AEE8jYk')
on conflict (name) do nothing;

-- Проверка после импорта: ровно 100 строк и распределение по категориям
-- 1-в-1 с ожидаемым списком задания. Останавливает применение миграции
-- (ROLLBACK всей транзакции) громким исключением, а не тихим расхождением,
-- если что-то не совпало (например, миграция применяется повторно на базе,
-- где часть строк уже была вручную изменена/удалена админом).
do $$
declare
  v_total integer;
  v_mismatch text;
begin
  select count(*) into v_total from public.judo_techniques;
  if v_total <> 100 then
    raise exception 'judo_techniques: expected 100 rows after seed, found %', v_total;
  end if;

  -- LEFT JOIN (не INNER): категория, у которой actual-строк стало 0
  -- (например, все строки этой категории случайно удалены), не должна
  -- молча выпасть из проверки только из-за отсутствия строки для JOIN —
  -- coalesce(actual, 0) явно ловит и этот случай тоже.
  select string_agg(cat || ': expected ' || expected || ', actual ' || coalesce(actual, 0), '; ')
  into v_mismatch
  from (
    values
      ('Te-waza', 16), ('Koshi-waza', 10), ('Ashi-waza', 21), ('Ma-sutemi-waza', 5),
      ('Yoko-sutemi-waza', 16), ('Osaekomi-waza', 10), ('Shime-waza', 12), ('Kansetsu-waza', 10)
  ) as expected_counts(cat, expected)
  left join (
    select category, count(*) as actual
    from public.judo_techniques
    group by category
  ) as actual_counts(cat2, actual) on expected_counts.cat = actual_counts.cat2
  where expected_counts.expected <> coalesce(actual_counts.actual, 0);

  if v_mismatch is not null then
    raise exception 'judo_techniques: category count mismatch: %', v_mismatch;
  end if;
end $$;
