import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import djbLogo from '../../assets/logos/djb.png';
import goKyuLogo from '../../assets/logos/go-kyu.png';
import styles from './KyuSourceCards.module.css';

// Селектор источника программы Kyu (Trainer → Kyu-Programm, этап
// "Source cards"). sourceMode сам по себе — frontend view-state; но клик
// по САМОЙ карточке DJB/Go Kyu — единственное среди трёх действие,
// которое реально подставляет данные (см. onApplyDjb/onApplyGoKyu в
// TrainerKyuProgramPage.jsx). draftSelectedIds/savedSelectedIds родителя
// этим компонентом не читаются и не трогаются напрямую.
//
// Логотипы — локальные статические ассеты (src/assets/logos/), не
// Supabase Storage: на этом этапе Storage не трогаем. Оригиналы
// пользователя (C:\VSCode_Projects\LOGO) не изменялись, сюда просто
// скопированы как есть.
//
// ⚙️ НА КАРТОЧКАХ DJB И GO KYU (этап "DJB template" раздел 1, "Go Kyu
// template" раздел 3): два РАЗНЫХ клика на каждой — клик по карточке
// целиком = применить шаблон как источник draft текущего Kyu
// (onApplyDjb/onApplyGoKyu); клик именно по ⚙️ = открыть редактор
// соответствующего шаблона текущего Kyu (djbEditorHref/goKyuEditorHref —
// /trainer/kyu-program/djb/:kyuId и /trainer/kyu-program/go-kyu/:kyuId,
// оба разбираются в App.jsx одним и тем же способом). Корень карточки —
// div[role=button] (не <button>), потому что <button> не может валидно
// содержать другой интерактивный элемент (вложенная ⚙️-кнопка) — тот же
// паттерн, что уже применён в KyuProgramBlocks.jsx для активации блока
// целиком. Клик по ⚙️ останавливает propagation, чтобы НЕ активировать
// карточку одновременно. У "Все техники" шестерёнки нет и не будет —
// это уже рабочий ручной режим, не шаблон.
export default function KyuSourceCards({ mode, onSelect, onApplyDjb, djbEditorHref, onApplyGoKyu, goKyuEditorHref }) {
  const { t } = useTranslation();

  return (
    <div className={styles.cardsRow}>
      <SourceCard
        active={mode === 'djb'}
        onClick={onApplyDjb}
        badgeClassName={styles.badgeLight}
        badge={<img src={djbLogo} alt="" className={styles.badgeImage} draggable={false} />}
        title="DJB"
        subtitle={t('trainerKyuProgram.source.djb.subtitle')}
        description={t('trainerKyuProgram.source.djb.description')}
        gearHref={djbEditorHref}
        gearLabel={t('trainerKyuProgram.djb.editTemplate')}
      />

      <SourceCard
        active={mode === 'all'}
        onClick={() => onSelect('all')}
        badgeClassName={styles.badgeNeutral}
        badge={<BookIcon className={styles.badgeBookIcon} />}
        title={t('trainerKyuProgram.source.all.title')}
        description={t('trainerKyuProgram.source.all.description')}
      />

      <SourceCard
        active={mode === 'goKyu'}
        onClick={onApplyGoKyu}
        badgeClassName={styles.badgeLight}
        badge={<img src={goKyuLogo} alt="" className={styles.badgeImage} draggable={false} />}
        title={t('trainerKyuProgram.source.goKyu.title')}
        description={t('trainerKyuProgram.source.goKyu.description')}
        gearHref={goKyuEditorHref}
        gearLabel={t('trainerKyuProgram.goKyu.editTemplate')}
      />
    </div>
  );
}

function SourceCard({ active, onClick, badge, badgeClassName, title, subtitle, description, gearHref, gearLabel }) {
  const hasGear = Boolean(gearHref);

  return (
    <div
      className={`${styles.card} ${active ? styles.cardActive : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <span className={`${styles.badge} ${badgeClassName}`}>{badge}</span>
      <span className={styles.textBlock}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        <span className={styles.description}>{description}</span>
      </span>
      {active && (
        <span className={`${styles.checkIndicator} ${hasGear ? styles.checkIndicatorShifted : ''}`}>
          <Icon name="check" size={12} />
        </span>
      )}
      {hasGear && (
        <a
          href={gearHref}
          className={styles.gearButton}
          aria-label={gearLabel}
          title={gearLabel}
          onClick={(event) => event.stopPropagation()}
        >
          <GearIcon className={styles.gearIcon} />
        </a>
      )}
    </div>
  );
}

// Нейтральная иконка каталога/книги — в существующем общем Icon.jsx такой
// пока нет (см. src/components/common/Icon.jsx), а добавлять новую запись
// в общий набор ради одной этой карточки на этапе, где сам источник "Все
// техники" — единственный уже рабочий и никак не меняется, избыточно.
// Держим маленькую самодостаточную SVG прямо здесь.
function BookIcon({ className }) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 4.5C4 3.67 4.67 3 5.5 3H11v18H5.5A1.5 1.5 0 0 1 4 19.5v-15Z" />
      <path d="M20 4.5c0-.83-.67-1.5-1.5-1.5H13v18h5.5c.83 0 1.5-.67 1.5-1.5v-15Z" />
      <path d="M11 7h2M11 11h2M11 15h2" />
    </svg>
  );
}

// Тот же принцип, что BookIcon — маленькая самодостаточная SVG, общего
// gear-значка в Icon.jsx пока нет.
function GearIcon({ className }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.8 6.2l-1.55 1.55M7.75 16.25l-1.55 1.55M17.8 17.8l-1.55-1.55M7.75 7.75 6.2 6.2" />
    </svg>
  );
}
