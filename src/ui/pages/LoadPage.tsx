import { useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { ROW_REJECT_LABELS, ROW_REJECT_REASONS } from '../../core/data/schema';
import type { ValidationReport } from '../../core/data/schema';
import { asOfFromDateValue, formatAsOf, utcDateValue } from '../asOf';
import type { UiError } from '../state';

// Load page (CL §1.3 steps 1-2, §2.8): upload with an explicit asOf (prefilled with today, read here at the UI
// boundary — PLAN C14), one-click sample, validation report. Every untrusted string (file name, ids, raw cell
// values) is rendered as a React text node; nothing is interpreted as HTML.

export interface LoadPageProps {
  busy: boolean;
  progressText: string | null;
  report: ValidationReport | null;
  error: UiError | null;
  canViewRanking: boolean;
  onLoadSample: () => void;
  onLoadFile: (file: File, asOf: number) => void;
  onCancel: () => void;
  onViewRanking: () => void;
}

const sectionStyle: CSSProperties = { margin: '1.5rem 0' };
const tableStyle: CSSProperties = { borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' };
const cellStyle: CSSProperties = { borderBottom: '1px solid #ddd', padding: '0.25rem 0.5rem', textAlign: 'left', verticalAlign: 'top' };
const numStyle: CSSProperties = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const warnStyle: CSSProperties = { background: '#fff4e5', border: '1px solid #f0b46c', padding: '0.75rem', borderRadius: 4 };
const errorStyle: CSSProperties = { background: '#fdecea', border: '1px solid #e57373', padding: '0.75rem', borderRadius: 4 };

export function LoadPage(props: LoadPageProps) {
  // The UI may read the clock (core never does): today's UTC date, editable.
  const [asOfValue, setAsOfValue] = useState<string>(() => utcDateValue(new Date()));
  const [file, setFile] = useState<File | null>(null);
  const asOf = asOfFromDateValue(asOfValue);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0] ?? null;
    setFile(f);
  };

  return (
    <div>
      <section style={sectionStyle}>
        <h2>Load reviews</h2>
        <p>
          CSV columns: <code>review_id, item_id, category, rating, timestamp</code>, optional <code>verified</code> and{' '}
          <code>text</code>. Up to 25,000,000 bytes and 200,000 data rows. The file is read in your browser only.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}>
          <label>
            CSV file
            <br />
            <input type="file" accept=".csv,text/csv" onChange={onFileChange} disabled={props.busy} />
          </label>
          <label>
            As of (end of this UTC day)
            <br />
            <input type="date" value={asOfValue} onChange={(e) => setAsOfValue(e.target.value)} disabled={props.busy} />
          </label>
          <button type="button" disabled={props.busy || file === null || asOf === null} onClick={() => file && asOf !== null && props.onLoadFile(file, asOf)}>
            Load file
          </button>
          <button type="button" disabled={props.busy} onClick={props.onLoadSample}>
            Load sample
          </button>
          {props.busy && (
            <button type="button" onClick={props.onCancel}>
              Cancel
            </button>
          )}
        </div>
        {asOf === null && <p style={warnStyle}>Enter a valid date for “As of”.</p>}
        <p style={{ fontSize: '0.85rem', color: '#555' }}>
          Reviews dated after “As of” are rejected as future timestamps. The sample uses its own fixed date.
        </p>
        {props.busy && <p role="status">{props.progressText ?? 'Working…'}</p>}
      </section>

      {props.error && (
        <section style={errorStyle} role="alert">
          <strong>{props.error.message}</strong>
          {props.error.details.length > 0 && (
            <ul>
              {props.error.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {props.report && <ReportView report={props.report} canViewRanking={props.canViewRanking} onViewRanking={props.onViewRanking} />}
    </div>
  );
}

function ReportView(props: { report: ValidationReport; canViewRanking: boolean; onViewRanking: () => void }) {
  const r = props.report;
  if (r.fileRejection) {
    return (
      <section style={{ ...sectionStyle, ...errorStyle }} role="alert">
        <h3>File rejected: {r.fileRejection.reason}</h3>
        <p>{r.fileRejection.message}</p>
        {r.fileRejection.columns.length > 0 && <p>Columns: {r.fileRejection.columns.join(', ')}</p>}
        <p>Nothing from this file was used.</p>
      </section>
    );
  }
  const reasons = ROW_REJECT_REASONS.filter((reason) => r.reasonCounts[reason] > 0);
  return (
    <section style={sectionStyle}>
      <h3>Validation report</h3>
      <p>
        Source: {r.sourceName} · as of {formatAsOf(r.asOf)} · {r.bytes.toLocaleString()} bytes
      </p>
      <table style={tableStyle}>
        <tbody>
          <tr>
            <th style={cellStyle}>Data rows</th>
            <td style={numStyle}>{r.dataRows}</td>
          </tr>
          <tr>
            <th style={cellStyle}>Accepted</th>
            <td style={numStyle}>{r.accepted}</td>
          </tr>
          <tr>
            <th style={cellStyle}>Rejected</th>
            <td style={numStyle}>{r.rejected}</td>
          </tr>
          <tr>
            <th style={cellStyle}>Items / categories</th>
            <td style={numStyle}>
              {r.itemCount} / {r.categoryCount}
            </td>
          </tr>
          <tr>
            <th style={cellStyle}>verified column</th>
            <td style={numStyle}>{r.verifiedColumnPresent ? 'present' : 'absent (all unknown, weight 1)'}</td>
          </tr>
        </tbody>
      </table>

      {reasons.length > 0 && (
        <>
          <h4>Rejected rows by reason</h4>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Reason</th>
                <th style={numStyle}>Rows</th>
              </tr>
            </thead>
            <tbody>
              {reasons.map((reason) => (
                <tr key={reason}>
                  <td style={cellStyle}>{ROW_REJECT_LABELS[reason]}</td>
                  <td style={numStyle}>{r.reasonCounts[reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>Example rows ({r.examples.length} kept; at most 50 per reason)</summary>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={numStyle}>Row</th>
                  <th style={cellStyle}>Reason</th>
                  <th style={cellStyle}>Values</th>
                </tr>
              </thead>
              <tbody>
                {r.examples.map((ex) => (
                  <tr key={`${ex.row}-${ex.reason}`}>
                    <td style={numStyle}>{ex.row}</td>
                    <td style={cellStyle}>{ex.reason}</td>
                    <td style={cellStyle}>{ex.values.join(' | ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}

      {r.insufficientCount > 0 && (
        <>
          <h4>Insufficient items (fewer than 3 reviews; kept and ranked, but labelled)</h4>
          <p>
            {r.insufficientCount} item(s){r.insufficientCount > r.insufficientItems.length ? `, first ${r.insufficientItems.length} shown` : ''}:{' '}
            {r.insufficientItems.join(', ')}
          </p>
        </>
      )}

      {props.canViewRanking && (
        <button type="button" onClick={props.onViewRanking}>
          View ranking →
        </button>
      )}
    </section>
  );
}
