// One numeric formatting policy for templates, grounding, tables and exports' human labels.
export function fmt(field: string, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const leaf = field.split('.').at(-1) ?? field;
  const decimals = leaf === 'n' || leaf.endsWith('_count') || leaf.endsWith('_clamps') || field.startsWith('rank_') ? 0
    : leaf === 'tau2' || leaf === 'sigma2' ? 3 : leaf === 'pValue' ? 5 : 2;
  const rendered = value.toFixed(decimals);
  return /^-0(?:\.0+)?$/.test(rendered) ? rendered.slice(1) : rendered;
}
