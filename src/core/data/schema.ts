// CSV input schema and validation-report contract (CL §1.1 item 1, §2.4; PLAN §1 row 7).
//
// Columns: review_id, item_id, category, rating, timestamp are required; verified and text are optional. Header
// names must match exactly (case-sensitive, no surrounding whitespace); duplicate or unknown headers reject the file.

export const REQUIRED_COLUMNS = ['review_id', 'item_id', 'category', 'rating', 'timestamp'] as const;
export const OPTIONAL_COLUMNS = ['verified', 'text'] as const;
/** Column order used when this app writes a CSV (sample assembly). Reading accepts any order. */
export const CANONICAL_COLUMNS = ['review_id', 'item_id', 'category', 'rating', 'timestamp', 'verified', 'text'] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];
export type Column = RequiredColumn | OptionalColumn;

/**
 * Why a single data row was rejected. Exactly one reason per row, assigned in the order listed in ROW_REJECT_REASONS
 * (the first failing check wins), so reason totals always add up to the rejected-row count.
 */
export type RowRejectReason =
  | 'malformed_row'
  | 'missing_review_id'
  | 'missing_item_id'
  | 'missing_category'
  | 'bad_rating'
  | 'bad_timestamp'
  | 'bad_timestamp_epoch_seconds'
  | 'bad_timestamp_zoneless'
  | 'future_timestamp'
  | 'malformed_verified'
  | 'duplicate_review_id'
  | 'inconsistent_category';

/** Check order and display order. */
export const ROW_REJECT_REASONS: readonly RowRejectReason[] = [
  'malformed_row',
  'missing_review_id',
  'missing_item_id',
  'missing_category',
  'bad_rating',
  'bad_timestamp',
  'bad_timestamp_epoch_seconds',
  'bad_timestamp_zoneless',
  'future_timestamp',
  'malformed_verified',
  'duplicate_review_id',
  'inconsistent_category',
];

export const ROW_REJECT_LABELS: Readonly<Record<RowRejectReason, string>> = {
  malformed_row: 'malformed row (wrong number of fields or broken quoting)',
  missing_review_id: 'missing review_id',
  missing_item_id: 'missing item_id',
  missing_category: 'missing category',
  bad_rating: 'rating not an integer in 1..5',
  bad_timestamp: 'bad timestamp',
  bad_timestamp_epoch_seconds: 'bad timestamp (looks like epoch seconds)',
  bad_timestamp_zoneless: 'bad timestamp (ISO date/time without a zone is ambiguous)',
  future_timestamp: 'timestamp after asOf',
  malformed_verified: 'malformed verified value',
  duplicate_review_id: 'duplicate review_id (first accepted row kept)',
  inconsistent_category: "category differs from the item's first accepted row",
};

/** Why the whole file was rejected (nothing from it is used). */
export type FileRejectReason =
  | 'too_many_bytes'
  | 'too_many_rows'
  | 'empty_file'
  | 'missing_header'
  | 'duplicate_header'
  | 'unknown_header';

export interface FileRejection {
  reason: FileRejectReason;
  message: string;
  /** Offending header names, when relevant (sorted by code unit). */
  columns: string[];
}

/** A retained example of a rejected row (bounded: at most max_examples_per_reason per reason). */
export interface RejectedExample {
  /** 1-based data-row number (header excluded, blank lines skipped). Line numbers are ambiguous with quoted newlines. */
  row: number;
  reason: RowRejectReason;
  /** Raw field values, each truncated to EXAMPLE_FIELD_MAX characters, at most EXAMPLE_FIELDS_MAX fields. */
  values: string[];
}

export const EXAMPLE_FIELD_MAX = 120;
export const EXAMPLE_FIELDS_MAX = 8;
/** At most this many insufficient item ids are listed in the report; the total is always given. */
export const INSUFFICIENT_LIST_MAX = 200;

export type SourceKind = 'upload' | 'text' | 'sample';

export interface ValidationReport {
  source: SourceKind;
  /** File name for uploads, a label otherwise. Untrusted when it comes from an upload: render as text only. */
  sourceName: string;
  asOf: number;
  /** Set when the whole file was rejected; then accepted = 0 and no dataset exists. */
  fileRejection: FileRejection | null;
  /** UTF-8 bytes of the input (File.size for uploads). */
  bytes: number;
  /** Data rows seen (up to the abort point when the row cap was hit). */
  dataRows: number;
  accepted: number;
  rejected: number;
  /** Complete totals for every reason (zeros included). */
  reasonCounts: Record<RowRejectReason, number>;
  /** Bounded examples, in row order. */
  examples: RejectedExample[];
  verifiedColumnPresent: boolean;
  textColumnPresent: boolean;
  itemCount: number;
  categoryCount: number;
  /** Items with fewer than insufficient_below accepted reviews (kept and ranked, but labelled). */
  insufficientCount: number;
  /** First INSUFFICIENT_LIST_MAX insufficient item ids, sorted by code unit. */
  insufficientItems: string[];
  /** SHA-256 of the canonical accepted reviews; null when the file was rejected. */
  datasetHash: string | null;
}

export function emptyReasonCounts(): Record<RowRejectReason, number> {
  return {
    malformed_row: 0,
    missing_review_id: 0,
    missing_item_id: 0,
    missing_category: 0,
    bad_rating: 0,
    bad_timestamp: 0,
    bad_timestamp_epoch_seconds: 0,
    bad_timestamp_zoneless: 0,
    future_timestamp: 0,
    malformed_verified: 0,
    duplicate_review_id: 0,
    inconsistent_category: 0,
  };
}

export function isRequiredColumn(name: string): name is RequiredColumn {
  return (REQUIRED_COLUMNS as readonly string[]).includes(name);
}

export function isKnownColumn(name: string): name is Column {
  return isRequiredColumn(name) || (OPTIONAL_COLUMNS as readonly string[]).includes(name);
}
