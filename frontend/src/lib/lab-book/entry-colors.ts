const labBookEntryColorClasses: Record<string, string> = {
  publication: 'bg-violet-700',
  masters_delivery: 'bg-sky-700',
  phd_delivery: 'bg-indigo-700',
  results_delivery: 'bg-emerald-700',
  maintenance: 'bg-amber-700',
  calibration: 'bg-cyan-700',
  incident: 'bg-rose-700',
  quality_control: 'bg-teal-700',
  software: 'bg-blue-700',
  infrastructure: 'bg-orange-700',
  sample_analysis: 'bg-blue-700',
  general: 'bg-slate-700',
};

export function labBookEntryColorClass(entryType: string) {
  return labBookEntryColorClasses[entryType] ?? labBookEntryColorClasses.general;
}
