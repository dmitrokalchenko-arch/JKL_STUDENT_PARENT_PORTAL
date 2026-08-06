import styles from './DashboardLayout.module.css';

export default function DashboardLayout({ header, selector, children }) {
  return (
    <div className={styles.layout}>
      {header}
      {selector}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
