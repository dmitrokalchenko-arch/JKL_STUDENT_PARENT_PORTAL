-- Security hotfix (перед trainer_accounts.portal_role): закрывает прямой
-- клиентский доступ к внутренностям Trainer Account / Family Account.
--
-- Найдено production PRECHECK 3 / 3B / 3C (2026-09): default privileges этого
-- Supabase-проекта выдают anon/authenticated ПРЯМЫЕ права на каждый новый
-- объект схемы public. `revoke ... from public` в исходных миграциях
-- (011, 023, 032, 039) их не снимал — тот же класс пробела, что уже закрыт
-- для семейных функций в 20260829120002_harden_family_public_rpc_permissions.sql.
-- 039 пересоздала log_trainer_account_operation через DROP + CREATE — новый
-- объект заново получил default privileges.
--
-- Repository audit: единственные легитимные вызывающие —
--   trainer_accounts (select/insert/update) и rename_trainer_login /
--   log_trainer_account_operation — Edge Function manage-trainer-account;
--   rename_family_nickname — Edge Function manage-family-account;
-- обе работают только через service_role. Клиентских обращений (портал,
-- JCL_Gruppen) нет; все SQL-читатели trainer_accounts — SECURITY DEFINER
-- (owner postgres) и от прав вызывающего не зависят.
--
-- Только REVOKE/GRANT + самопроверка. Тела функций, схема, данные, RLS и
-- policies НЕ меняются. portal_role и ALTER DEFAULT PRIVILEGES — вне этой
-- миграции.
--
-- АТОМАРНОСТЬ: явная транзакция. Любая ошибка (отсутствующая сигнатура в
-- REVOKE/GRANT или exception самопроверки) переводит транзакцию в aborted
-- state; COMMIT в таком состоянии Postgres выполняет как ROLLBACK — ни одно
-- изменение не фиксируется.
--
-- Проверка после применения (READ-ONLY):
-- docs/database/TRAINER_ACCOUNT_GRANTS_HOTFIX_VERIFICATION.md

begin;

-- ── public.trainer_accounts ─────────────────────────────────────────────
revoke all on table public.trainer_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.trainer_accounts to service_role;

-- ── public.rename_trainer_login(uuid, text) ─────────────────────────────
revoke all on function public.rename_trainer_login(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_trainer_login(uuid, text) to service_role;

-- ── public.log_trainer_account_operation(...) — 6-аргументная версия 039 ─
revoke all on function public.log_trainer_account_operation(bigint, uuid, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.log_trainer_account_operation(bigint, uuid, bigint, text, text, text)
  to service_role;

-- ── public.rename_family_nickname(uuid, text) ───────────────────────────
revoke all on function public.rename_family_nickname(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_family_nickname(uuid, text) to service_role;

-- ── Самопроверка (только чтение каталога). Любое расхождение — exception
-- внутри транзакции → COMMIT ниже не фиксирует ничего.
do $$
declare
  v_ta   regclass := to_regclass('public.trainer_accounts');
  v_fn   regprocedure;
  v_sig  text;
  v_role text;
  v_priv text;
begin
  if v_ta is null then
    raise exception 'hotfix check: public.trainer_accounts not found';
  end if;

  if exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = v_ta and a.grantee = 0
  ) then
    raise exception 'hotfix check: PUBLIC still has privileges on public.trainer_accounts';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, v_ta, v_priv) then
        raise exception 'hotfix check: % still has % on public.trainer_accounts', v_role, v_priv;
      end if;
    end loop;
  end loop;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', v_ta, v_priv) then
      raise exception 'hotfix check: service_role lost % on public.trainer_accounts', v_priv;
    end if;
  end loop;

  if not (select c.relrowsecurity from pg_class c where c.oid = v_ta) then
    raise exception 'hotfix check: RLS is not enabled on public.trainer_accounts';
  end if;

  foreach v_sig in array array[
    'public.rename_trainer_login(uuid,text)',
    'public.log_trainer_account_operation(bigint,uuid,bigint,text,text,text)',
    'public.rename_family_nickname(uuid,text)'
  ] loop
    v_fn := to_regprocedure(v_sig);
    if v_fn is null then
      raise exception 'hotfix check: function % not found', v_sig;
    end if;
    if exists (
      select 1
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'hotfix check: PUBLIC still has EXECUTE on %', v_sig;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'hotfix check: anon/authenticated still has EXECUTE on %', v_sig;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'hotfix check: service_role lost EXECUTE on %', v_sig;
    end if;
  end loop;
end
$$;

commit;
