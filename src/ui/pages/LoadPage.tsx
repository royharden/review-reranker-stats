import { useState } from 'react';
import type { ValidationReport as Report } from '../../core/data/schema';
import { asOfFromDateValue, utcDateValue } from '../asOf';
import type { UiError } from '../state';
import { ValidationReport } from '../components/ValidationReport';

export interface LoadPageProps {
  busy: boolean; progressText: string | null; report: Report | null; error: UiError | null; canViewRanking: boolean;
  onLoadSample: () => void; onLoadFile: (file: File, asOf: number) => void; onCancel: () => void; onViewRanking: () => void;
}
export function LoadPage(props: LoadPageProps) {
  const [asOfValue, setAsOfValue] = useState(() => utcDateValue(new Date()));
  const [file, setFile] = useState<File | null>(null);
  const asOf = asOfFromDateValue(asOfValue);
  return <><section className="card"><p className="eyebrow">Start with the evidence</p><h2>Load reviews</h2>
    <p>Compare raw averages with shrinkage and weighted estimates. Inspect unusual review bursts and record your own rulings. All analysis stays in this browser.</p>
    <div className="toolbar"><label>CSV file<input type="file" accept=".csv,text/csv" disabled={props.busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <label>As of (end of UTC day)<input type="date" value={asOfValue} disabled={props.busy} onChange={(e) => setAsOfValue(e.target.value)} /></label>
      <button disabled={props.busy || !file || asOf === null} onClick={() => { if (file && asOf !== null) props.onLoadFile(file, asOf); }}>Load file</button>
      <button className="primary" disabled={props.busy} onClick={props.onLoadSample}>Load sample</button>
      {props.busy && <button onClick={props.onCancel}>Cancel</button>}
    </div>
    {asOf === null && <p className="error" role="alert">Enter a valid date.</p>}
    {props.busy && <p role="status">{props.progressText ?? 'Working…'}</p>}
    {props.error && <div className="error" role="alert">{props.error.message}{props.error.details.length > 0 && <ul>{props.error.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}</div>}
    <details><summary>CSV format and privacy</summary><p>Required columns: <code>review_id,item_id,category,rating,timestamp</code>. Optional: <code>verified,text</code>. Exact headers; integer ratings from 1 through 5; zoned ISO timestamps or epoch milliseconds. Hard limits: 25,000,000 bytes and 200,000 data rows, including rejected rows.</p>
      <p>Reviews after the editable “As of” date are rejected. The sample has a fixed date. Free text does not affect any score. Only compact rulings are persisted; reviews and the CSV are held in memory. Reload the same file or sample to replay saved rulings.</p></details>
  </section>
  {props.report && <ValidationReport report={props.report} />}
  {props.canViewRanking && <button className="primary" onClick={props.onViewRanking}>View Ranking →</button>}
  </>;
}
