export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.replace(/[^a-z-]/g, '')}`}>{status}</span>;
}
