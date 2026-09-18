-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- SECURITY FIX для migration 20260921100066 (уже применена к production).
--
-- НАЙДЕНО post-apply security QA этой же сессии: для
-- public.log_student_page_access_operation(uuid, uuid, bigint, text, jsonb,
-- jsonb) миграция 066 выполнила ТОЛЬКО `revoke all ... from public;` — в
-- отличие от трёх set_student_page_*-функций той же миграции, где
-- дополнительно ЯВНО указаны `revoke ... from anon;`/`revoke ... from
-- authenticated;`. Тот самый, уже неоднократно задокументированный в этом
-- проекте класс проблемы (миграции 20260720120009/20260829120001/
-- 20260918140063 и др.): default privileges в этом Supabase-проекте шире
-- ожидаемого, `revoke ... from public` НЕ гарантированно убирает права,
-- ранее/отдельно выданные ИМЕННО ролям anon/authenticated.
--
-- ЭМПИРИЧЕСКИ ПОДТВЕРЖДЕНО (read-only privilege inspection + один
-- контролируемый вызов под `set local role anon`, тестовая строка сразу
-- удалена): anon мог УСПЕШНО вызвать эту функцию и вставить в
-- public.student_page_access_audit_log произвольную фиктивную запись —
-- любой performed_by_super_admin_id/target_student_id (существующего
-- студента)/operation/old_value/new_value. public.student_page_access САМА
-- НЕ пострадала — все три set_student_page_*-функции и прямой доступ к
-- таблице уже были и остаются защищены только service_role (подтверждено
-- отдельно). Риск ограничен целостностью audit-трейла, не утечкой данных.
--
-- ИСПРАВЛЕНИЕ — МИНИМАЛЬНОЕ: только явный revoke/grant на ТОЧНУЮ
-- сигнатуру этой одной функции. Тело функции, audit-таблица, три
-- set_student_page_*-функции (их ACL уже корректны — подтверждено
-- отдельно) — НЕ трогаются вообще.
revoke all on function public.log_student_page_access_operation(uuid, uuid, bigint, text, jsonb, jsonb) from public;
revoke all on function public.log_student_page_access_operation(uuid, uuid, bigint, text, jsonb, jsonb) from anon;
revoke all on function public.log_student_page_access_operation(uuid, uuid, bigint, text, jsonb, jsonb) from authenticated;
grant execute on function public.log_student_page_access_operation(uuid, uuid, bigint, text, jsonb, jsonb) to service_role;
