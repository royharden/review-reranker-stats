import type { ValidationReport as Report } from '../../core/data/schema';
import { ROW_REJECT_LABELS, ROW_REJECT_REASONS } from '../../core/data/schema';
import { formatAsOf } from '../asOf';

export function ValidationReport({ report }: { report: Report }) {
  return <section className="card"><h2>Validation report</h2><p>{report.sourceName} · As of {formatAsOf(report.asOf)}</p>
    {report.fileRejection && <p className="error" role="alert">{report.fileRejection.message}</p>}
    <dl className="stats"><div><dt>Accepted</dt><dd>{report.accepted}</dd></div><div><dt>Rejected</dt><dd>{report.rejected}</dd></div><div><dt>Items</dt><dd>{report.itemCount}</dd></div><div><dt>Insufficient</dt><dd>{report.insufficientCount}</dd></div></dl>
    <p>{report.bytes} bytes · {report.dataRows} data rows · {report.categoryCount} categories. {report.verifiedColumnPresent ? 'Verified column present; blanks remain unknown.' : 'Verified status unknown; unknown status keeps full weight.'}</p>
    <div className="table-scroll"><table><caption>Rejected rows by first failing rule</caption><thead><tr><th>Reason</th><th>Rows</th></tr></thead><tbody>{ROW_REJECT_REASONS.filter((reason) => report.reasonCounts[reason] > 0).map((reason) => <tr key={reason}><td>{ROW_REJECT_LABELS[reason]}</td><td>{report.reasonCounts[reason]}</td></tr>)}</tbody></table></div>
    {report.examples.length > 0 && <details><summary>Bounded rejected-row examples ({report.examples.length})</summary><div className="table-scroll"><table><thead><tr><th>Data row</th><th>Reason</th><th>Raw fields (truncated)</th></tr></thead><tbody>{report.examples.map((e, i) => <tr key={i}><td>{e.row}</td><td>{ROW_REJECT_LABELS[e.reason]}</td><td>{e.values.join(' · ')}</td></tr>)}</tbody></table></div></details>}
    {report.insufficientItems.length > 0 && <details><summary>Insufficient item IDs (bounded list)</summary><p>{report.insufficientItems.join(', ')}</p></details>}
    {report.datasetHash && <details><summary>Dataset SHA-256</summary><code className="hash">{report.datasetHash}</code></details>}
  </section>;
}
