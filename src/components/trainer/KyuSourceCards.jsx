import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import djbLogo from '../../assets/logos/djb.png';
import goKyuLogo from '../../assets/logos/go-kyu.png';
import styles from './KyuSourceCards.module.css';

// Селектор источника программы Kyu (Trainer → Kyu-Programm, этап
// "Source cards"). ТОЛЬКО frontend view/filter state — sourceMode нигде не
// сохраняется в БД и не отправляется ни в одну RPC. draftSelectedIds/
// savedSelectedIds родителя этим компонентом не читаются и не трогаются:
// переключение источника — чистая смена того, что показано в области
// каталога ниже (см. TrainerKyuProgramPage), выбранные техники остаются
// как есть при любом переключении.
//
// DJB/Go Kyu шаблоны техник по Kyu ещё не переданы (реальных данных нет) —
// сюда сознательно НЕ вписан список техник ни в каком виде (см. задание,
// раздел 10). Пустое состояние для этих двух режимов рендерит родитель.
//
// Логотипы — локальные статические ассеты (src/assets/logos/), не
// Supabase Storage: на этом этапе Storage не трогаем (см. задание,
// раздел 19). Оригиналы пользователя (C:\VSCode_Projects\LOGO) не
// изменялись, сюда просто скопированы как есть.
export default function KyuSourceCards({ mode, onSelect }) {
  const { t } = useTranslation();

  return (
    <div className={styles.cardsRow}>
      <SourceCard
        active={mode === 'djb'}
        onClick={() => onSelect('djb')}
        badgeClassName={styles.badgeLight}
        badge={<img src={djbLogo} alt="" className={styles.badgeImage} draggable={false} />}
        title="DJB"
        subtitle={t('trainerKyuProgram.source.djb.subtitle')}
        description={t('trainerKyuProgram.source.djb.description')}
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
        onClick={() => onSelect('goKyu')}
        badgeClassName={styles.badgeLight}
        badge={<img src={goKyuLogo} alt="" className={styles.badgeImage} draggable={false} />}
        title={t('trainerKyuProgram.source.goKyu.title')}
        description={t('trainerKyuProgram.source.goKyu.description')}
      />
    </div>
  );
}

function SourceCard({ active, onClick, badge, badgeClassName, title, subtitle, description }) {
  return (
    <button
      type="button"
      className={`${styles.card} ${active ? styles.cardActive : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className={`${styles.badge} ${badgeClassName}`}>{badge}</span>
      <span className={styles.textBlock}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        <span className={styles.description}>{description}</span>
      </span>
      {active && (
        <span className={styles.checkIndicator}>
          <Icon name="check" size={12} />
        </span>
      )}
    </button>
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
