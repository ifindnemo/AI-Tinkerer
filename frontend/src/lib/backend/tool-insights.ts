import type {AgentReply, MaintenanceRecord, Severity} from './contract';

// Rough fault families used only to match the current assessment against seeded
// maintenance records. Keyword matching is a presentation aid, not a diagnosis.
export type FaultTopic = 'cooling' | 'lean' | 'rich' | 'misfire' | 'electrical';
const TOPICS: [FaultTopic, RegExp][] = [
  ['cooling', /làm mát|quá nhiệt|nóng máy|két nước|quạt|hằng nhiệt|bơm nước|nước mát|coolant|overheat|thermostat|radiator|cooling|\bfan\b|P0217/i],
  ['lean', /nghèo|\blean\b/i],
  ['rich', /giàu|\brich\b/i],
  ['misfire', /bỏ máy|đánh lửa|misfire|ignition/i],
  ['electrical', /ắc quy|điện áp|máy phát|sạc|battery|voltage|alternator/i],
];
export const topicsOf = (text: string): FaultTopic[] => TOPICS.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);

export type HistoryInsight = {
  total: number;
  similar: MaintenanceRecord[];
  last: MaintenanceRecord | null;
  regularGarage: {name: string; visits: number} | null;
  topics: FaultTopic[];
};

const byDateDesc = (a: MaintenanceRecord, b: MaintenanceRecord) => b.date.localeCompare(a.date);

export function historyInsight(reply: AgentReply): HistoryInsight | null {
  const trace = reply.tool_trace.find(item => item.tool === 'get_maintenance_history');
  const records = trace?.result.records;
  if (!trace || trace.result.error || !Array.isArray(records)) return null;
  const valid = records.filter(record => typeof record?.date === 'string').sort(byDateDesc);
  const a = reply.assessment;
  // Only the agent's suspected faults/diagnosis and backend safety reasons describe the
  // current batch; evidence may quote history and would cause self-matches.
  const current = a.severity === 'normal' ? [] : topicsOf([...a.suspected_faults, ...(a.suspected_faults.length ? [] : [a.diagnosis]), ...reply.hard_safety_guardrail.reasons].join(' '));
  const similar = current.length ? valid.filter(record => (record.fault_code ?? 0) > 0 && topicsOf(`${record.fault_label ?? ''} ${record.diagnosis ?? ''}`).some(topic => current.includes(topic))) : [];
  const visits = new Map<string, number>();
  for (const record of valid) if (record.garage) visits.set(record.garage, (visits.get(record.garage) ?? 0) + 1);
  const [name, count] = [...visits.entries()].sort((x, y) => y[1] - x[1])[0] ?? [];
  return {total: valid.length, similar, last: valid[0] ?? null, regularGarage: name && count && count > 1 ? {name, visits: count} : null, topics: current};
}

export type ToolStep =
  | {kind: 'guardrail'; triggered: boolean; minimum: Severity; reasons: string[]}
  | {kind: 'weather'; ok: boolean; temperature?: number; gridKm?: number}
  | {kind: 'history'; ok: boolean; total?: number; lastDate?: string}
  | {kind: 'garages'; ok: boolean; count?: number; radiusKm?: number}
  | {kind: 'booking'; ok: boolean; garage?: string; slot?: string}
  | {kind: 'other'; name: string; ok: boolean}
  | {kind: 'verdict'; severity: Severity; confidence: number};

// The backend applies its hard safety rule before the agent runs, then the agent calls
// tools in the recorded order; the verdict closes the sequence.
export function toolSteps(reply: AgentReply): ToolStep[] {
  const g = reply.hard_safety_guardrail;
  const steps: ToolStep[] = [{kind: 'guardrail', triggered: g.triggered, minimum: g.minimum_severity, reasons: g.reasons}];
  for (const item of reply.tool_trace) {
    const r = item.result ?? {};
    const ok = !r.error && r.success !== false;
    if (item.tool === 'get_external_environment_context') steps.push({kind: 'weather', ok: ok && !!r.data, temperature: r.data?.outside_temperature_c, gridKm: r.data?.weather_grid_distance_km});
    else if (item.tool === 'get_maintenance_history') steps.push({kind: 'history', ok, total: r.total_records ?? r.records?.length, lastDate: r.records?.map(x => x.date).sort().at(-1)});
    else if (item.tool === 'search_nearby_garages') steps.push({kind: 'garages', ok, count: r.options?.length, radiusKm: typeof r.radius_meters === 'number' ? r.radius_meters / 1000 : undefined});
    else if (item.tool === 'propose_booking') steps.push({kind: 'booking', ok: ok && r.proposed === true, garage: r.garage, slot: r.slot});
    else steps.push({kind: 'other', name: item.tool, ok});
  }
  steps.push({kind: 'verdict', severity: reply.assessment.severity, confidence: reply.assessment.confidence});
  return steps;
}
