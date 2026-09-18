-- PRODUKTENTSCHEIDUNG GEÄNDERT (2026-09-24): "1 Kind <-> bis zu 2 aktive
-- Familienkonten" (BUSINESS_RULES.md, altes Rule 24; FAMILY_ACCOUNT_CONCEPT.md
-- Abschnitt 15.7; FAMILY_ACCOUNT_DATA_MODEL_DRAFT.md) wird durch die neue
-- Regel ERSETZT:
--
--   EIN Schüler <-> MAXIMAL EIN aktives Familienkonto.
--   EIN Familienkonto <-> BELIEBIG VIELE Schüler (unverändert, siehe
--   Migration 20260720120001, unique(family_id, student_id) — reines
--   Paar-Constraint, nie ein family_id-Cap).
--
-- Getrennt lebende Eltern nutzen ab jetzt dasselbe gemeinsame Familienkonto
-- (gemeinsamer Login), statt je ein eigenes — die alte Begründung für "bis
-- zu 2" entfällt damit vollständig, nicht nur technisch.
--
-- Bewusst NICHT umbenannt: Funktion/Trigger heißen weiterhin
-- enforce_max_active_families_per_student()/trg_family_students_max_active
-- (kleinstmöglicher Diff, siehe Migration 20260720120001) — ihr Verhalten
-- wird unten von ">= 2" auf ">= 1" geändert, das ist jetzt "maximal 1 aktiv",
-- nicht mehr "maximal 2".
--
-- Dokumentation im selben PR aktualisiert (siehe Abschlussbericht):
-- memory/BUSINESS_RULES.md (Rule 24), docs/architecture/FAMILY_ACCOUNT_CONCEPT.md
-- (Abschnitt 9 + 15.7), docs/database/FAMILY_ACCOUNT_DATA_MODEL_DRAFT.md,
-- docs/database/FAMILY_AUTH_AND_TECHNIQUE_PROGRESS_SCHEMA.md,
-- memory/CURRENT_STATUS.md.

-- ══════════════════════════════════════════════════════════════════════
-- SCHRITT 1 — Defensive Vorab-Prüfung: die Migration MUSS fehlschlagen,
-- falls bereits ein Schüler mit >1 aktiver Familie existiert, STATT
-- automatisch eine Familie zu wählen oder Zeilen zu löschen/zu ändern.
-- Read-only vor dieser Migration bestätigt: 0 Konflikte in Production
-- (siehe Sitzungsverlauf) — dieser Block bleibt trotzdem als echte,
-- eigenständige Absicherung bestehen (nicht nur "vertrauen, dass der
-- Audit weiterhin stimmt").
-- ══════════════════════════════════════════════════════════════════════
do $$
declare
  v_conflicting_student_ids bigint[];
begin
  select array_agg(student_id order by student_id)
    into v_conflicting_student_ids
  from (
    select student_id
    from public.family_students
    where status = 'active'
    group by student_id
    having count(*) > 1
  ) conflicts;

  if v_conflicting_student_ids is not null then
    raise exception
      'Migration abgebrochen: % Schüler mit mehr als 1 aktiver Familie gefunden (student_id: %) — manuelle Klärung erforderlich, BEVOR diese Migration erneut ausgeführt wird. Keine automatische Auswahl/Löschung wurde vorgenommen.',
      array_length(v_conflicting_student_ids, 1), v_conflicting_student_ids;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════
-- SCHRITT 2 — Trigger-Funktion: Schwelle >= 2 -> >= 1. Bleibt die
-- freundliche, sofortige Fehlermeldung INNERHALB einer einzelnen
-- Transaktion/Anfrage (kein Race-Schutz zwischen zwei GLEICHZEITIGEN
-- Transaktionen — dafür siehe Schritt 3, der eigentliche, race-freie
-- Schutz).
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.enforce_max_active_families_per_student()
returns trigger
language plpgsql
as $$
declare
  v_active_count integer;
begin
  if new.status = 'active' then
    select count(*) into v_active_count
    from public.family_students
    where student_id = new.student_id
      and status = 'active'
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if v_active_count >= 1 then
      raise exception 'student_id % already has an active Familienkonto — one student may have at most 1 active family (product decision 2026-09-24, replaces the old 2-family rule)', new.student_id;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_max_active_families_per_student() is
  'Setzt seit 2026-09-24 EIN aktives Familienkonto pro Schüler durch (vorher: bis zu 2). Name unverändert gelassen (kleinstmöglicher Diff) — siehe Migration 20260924100069. Freundliche Fehlermeldung pro Anfrage; die eigentliche, race-freie Garantie ist idx_family_students_one_active_per_student unten.';

-- ══════════════════════════════════════════════════════════════════════
-- SCHRITT 3 — Race-freier, echter DB-Schutz: partieller UNIQUE INDEX.
-- Der Trigger oben prüft per SELECT COUNT vor dem eigenen INSERT/UPDATE —
-- zwei GLEICHZEITIGE Transaktionen könnten beide die Zählung passieren,
-- bevor eine von beiden committet (klassische TOCTOU-Lücke bei
-- SELECT-basierten Prüfungen in Triggern). Dieser Index ist die
-- eigentliche, vom Datenbank-Server selbst garantierte Invariante —
-- unabhängig vom Trigger, unabhängig von jeglichem Anwendungscode
-- (Edge Function/Frontend). "Die Datenbank selbst verhindert eine zweite
-- aktive Familie" im Sinne der Aufgabenstellung ist DIESER Index, nicht
-- (nur) der Trigger.
-- ══════════════════════════════════════════════════════════════════════
create unique index if not exists idx_family_students_one_active_per_student
  on public.family_students (student_id)
  where status = 'active';

comment on index public.idx_family_students_one_active_per_student is
  'Race-freie Durchsetzung von "1 Schüler -> maximal 1 aktives Familienkonto" (2026-09-24) — garantiert vom Datenbank-Server selbst, unabhängig vom Trigger enforce_max_active_families_per_student() oder jeglichem Anwendungscode.';

-- Veralteten Tabellenkommentar aus Migration 20260720120001 korrigieren
-- (dort "Maximum 2 active..." — Text selbst wird hier NICHT verändert,
-- nur der aktuell gültige Kommentar per COMMENT ON neu gesetzt).
comment on table public.family_students is
  'Связь семьи с учеником (students.id — bigint, реальный PK). Удаление строки не удаляет students. linked_by — id сотрудника клуба, подтвердившего связь (без FK — таблица администраторов ещё не создана). С 2026-09-24: МАКСИМУМ 1 активная запись на student_id (продуктовое решение, см. migration 20260924100069) — обеспечено триггером trg_family_students_max_active И партиальным unique index idx_family_students_one_active_per_student. Один family_id по-прежнему может иметь произвольное число активных записей (несколько детей в одной семье) — это НЕ ограничено.';
