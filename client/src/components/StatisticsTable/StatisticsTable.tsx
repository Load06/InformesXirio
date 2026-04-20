import type { StatRow } from '../../types/study';
import styles from './StatisticsTable.module.css';

interface StatisticsTableProps {
  rows: StatRow[];
  title?: string;
  unit?: string;
  /** Si true, resalta filas que superen el 95% (objetivos) */
  highlightObjective?: boolean;
}

export function StatisticsTable({
  rows,
  title,
  unit,
  highlightObjective = true,
}: StatisticsTableProps) {
  if (!rows || rows.length === 0) {
    return (
      <div className={styles.empty}>
        <span>Sin datos estadísticos disponibles para este resultado</span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {title && <div className={styles.title}>{title}</div>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Umbral{unit ? ` (${unit})` : ''}</th>
            <th className={styles.th}>% Superficie</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isObjective = highlightObjective && row.percentage >= 95;
            return (
              <tr
                key={idx}
                className={`${styles.tr} ${isObjective ? styles.objective : ''}`}
              >
                <td className={styles.td}>
                  {row.label ? (
                    <span className={styles.labelCell}>
                      <span className={styles.threshold}>{row.threshold}</span>
                      <span className={styles.rowLabel}>{row.label}</span>
                    </span>
                  ) : (
                    <span className={styles.threshold}>{row.threshold}</span>
                  )}
                </td>
                <td className={styles.tdRight}>
                  <div className={styles.pctBar}>
                    <div
                      className={styles.pctFill}
                      style={{
                        width: `${Math.min(row.percentage, 100)}%`,
                        background: isObjective
                          ? 'rgba(16, 185, 129, 0.5)'
                          : 'rgba(124, 58, 237, 0.4)',
                      }}
                    />
                    <span className={styles.pctText}>
                      {row.percentage.toFixed(2)}%
                    </span>
                  </div>
                  {isObjective && (
                    <span className={styles.objectiveBadge}>✓ Objetivo</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
