import styles from './FamilienzugangePage.module.css';

// Раздел SuperAdmin «Familienzugänge» — пока без логики: только каркас
// поиска/фильтров и пустая таблица результатов. Запросов к базе нет,
// поиск и активация не реализуются на этом этапе (см. чат).
export default function FamilienzugangePage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Familienzugänge</h1>

      <div className={styles.searchCard}>
        <h2 className={styles.searchTitle}>Suche</h2>

        <div className={styles.searchGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Nachname</span>
            <input className={styles.input} type="text" />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Vorname</span>
            <input className={styles.input} type="text" />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Geburtsdatum</span>
            <input className={styles.input} type="date" />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Verein</span>
            <select className={styles.input}></select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Sportart</span>
            <select className={styles.input}></select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Gruppe</span>
            <select className={styles.input}></select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Familienzugang</span>
            <select className={styles.input}></select>
          </label>
        </div>
      </div>

      <div className={styles.resultsCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Schüler</th>
              <th>Geburtsdatum</th>
              <th>Verein</th>
              <th>Sportart</th>
              <th>Gruppe</th>
              <th>Familienzugang</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <div className={styles.emptyState}>Keine Ergebnisse</div>
      </div>
    </div>
  );
}
