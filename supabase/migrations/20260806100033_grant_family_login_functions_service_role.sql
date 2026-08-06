-- НАЙДЕНО РУЧНЫМ РЕВЬЮ при разработке manage-family-account (не живым
-- тестом на этой стороне — но тот же класс проблемы, который живой тест УЖЕ
-- нашёл на тренерской стороне, migrations 020/022): normalize_family_nickname
-- и family_login_email отозваны от public (migration 002, "revoke all ...
-- from public;") БЕЗ последующего grant service_role. Существующая
-- create-family-account (создана раньше этой задачи, не изменяется здесь)
-- вызывает ОБЕ функции напрямую через supabaseAdmin.rpc(...) от имени
-- service_role — то есть уже сегодня, до этой миграции, любой её реальный
-- вызов падал бы с "permission denied for function family_login_email"
-- (PUBLIC ≠ service_role: GRANT/REVOKE PUBLIC определяет привилегию для
-- ВСЕХ ролей разом, но REVOKE ALL ... FROM PUBLIC снимает именно этот общий
-- грант, и explicit grant затем нужен каждой роли отдельно — ровно то, что
-- живой тест нашёл для resolve_trainer_login_email/family_club_exists/
-- normalize_login_name/rename_trainer_login). Эта миграция закрывает пробел
-- для обеих функций сразу — нужна новому manage-family-account (действия
-- create/set_login строят технический email тем же способом, что и вход) и
-- попутно чинит тот же скрытый пробел в уже существующей create-family-account
-- (её код не меняется, только права на уже вызываемые ею функции).
grant execute on function public.normalize_family_nickname(text) to service_role;
grant execute on function public.family_login_email(text, text) to service_role;
