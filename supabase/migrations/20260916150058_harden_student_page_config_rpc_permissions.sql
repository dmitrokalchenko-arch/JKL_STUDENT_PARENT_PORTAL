-- Security hardening: закрывает permission-gap, найденный при post-migration
-- проверке grants миграции 20260916140057 (club_student_page_settings) —
-- три новых RPC получили EXECUTE у anon, несмотря на `revoke all ... from
-- public` в исходной миграции. Причина (ТА ЖЕ, что уже была
-- диагностирована и исправлена ранее в этом проекте для четырёх
-- family-функций, см. migration 20260829120002_harden_family_public_rpc_permissions.sql):
-- в этом Supabase-проекте default privileges на новые функции public-схемы
-- выдают EXECUTE anon/authenticated НАПРЯМУЮ (не только через членство в
-- роли PUBLIC) — `REVOKE ... FROM PUBLIC` такую прямую роль-специфичную
-- привилегию не снимает, нужен явный `REVOKE ... FROM anon`.
--
-- Эмпирически подтверждено (реальные HTTP RPC-вызовы к production с одним
-- только anon key, без сессии, до этой миграции): все три функции
-- fail-closed через внутреннюю проверку auth.uid() — get_*_student_page_config
-- возвращали null, save_trainer_student_page_config возвращала false и не
-- писала ни одной строки. То есть эксплуатация НЕ была возможна — это
-- исправление grant-поверхности до задуманного состояния (defense in
-- depth), а не закрытие активной уязвимости.
--
-- Эта миграция НЕ меняет: тела функций, authenticated-грант, RLS,
-- club_student_page_settings, auth-архитектуру, Block 1, frontend — только
-- три REVOKE EXECUTE ... FROM anon.

revoke execute on function public.get_family_student_page_config() from anon;
revoke execute on function public.get_trainer_student_page_config() from anon;
revoke execute on function public.save_trainer_student_page_config(jsonb) from anon;
