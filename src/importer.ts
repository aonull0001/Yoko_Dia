import type { WorkSheet } from '@e965/xlsx';
import { destinationNumber, parseTime, serviceCode, STATIONS, stationName } from './data';
import type { Train, TrainCall } from './types';

export type ImportPreview = { sheetNames: string[]; selectedSheet: string; trains: Train[]; warnings: string[] };
export async function previewWorkbook(file: File, requestedSheet?: string): Promise<ImportPreview> {
  const XLSX = await import('@e965/xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: false, raw: true });
  if (!workbook.SheetNames.length) throw new Error('Excelに読み込めるシートがありません。');
  const defaultSheet = workbook.SheetNames.includes('表からスタフ') ? '表からスタフ' : workbook.SheetNames.includes('下り') ? '下り' : workbook.SheetNames[0];
  const selectedSheet = requestedSheet && workbook.SheetNames.includes(requestedSheet) ? requestedSheet : defaultSheet;
  const sheet = workbook.Sheets[selectedSheet];
  if (!sheet) throw new Error(`シート「${selectedSheet}」を読み込めません。`);
  const warnings: string[] = [];
  if (hasFormulas(sheet)) warnings.push('Excel数式はブラウザーで再実行せず、ファイルに保存された計算結果を取り込みます。');
  let trains: Train[];
  if (selectedSheet === '表からスタフ') trains = parseStaffSheet(sheet, warnings, XLSX);
  else if (selectedSheet === '下り' || selectedSheet === '上り') trains = parseDirectionalSheet(sheet, selectedSheet, warnings, XLSX);
  else trains = parseGenericSheet(sheet, warnings, XLSX);
  if (trains.length === 0) warnings.push('取り込み可能な列車がありません。');
  return { sheetNames: workbook.SheetNames, selectedSheet, trains, warnings };
}

function parseStaffSheet(sheet: WorkSheet, warnings: string[], XLSX: typeof import('@e965/xlsx')): Train[] {
  const directionValue = String(cellValue(sheet, 'K1') ?? '下り').trim();
  const direction = directionValue === '上り' ? '上り' : '下り';
  const typeId = parseTypeId(cellValue(sheet, 'F2'));
  const trainNumber = String(cellValue(sheet, 'G4') ?? cellValue(sheet, 'M2') ?? '').trim();
  const callsByStation = new Map<number, TrainCall>();
  for (let row = 6; row <= 16; row += 2) {
    const stationId = stationIdFromName(cellValue(sheet, XLSX.utils.encode_cell({ r: row, c: 3 })));
    if (stationId === null) continue;
    const arrival = valueAsSeconds(cellValue(sheet, XLSX.utils.encode_cell({ r: row, c: 5 })));
    const departure = valueAsSeconds(cellValue(sheet, XLSX.utils.encode_cell({ r: row, c: 6 })));
    const platform = String(cellValue(sheet, XLSX.utils.encode_cell({ r: row, c: 7 })) || '').trim();
    callsByStation.set(stationId, { stationId, arrival, departure, stop: Boolean(platform), platform });
  }
  const orderedCalls = [...callsByStation.values()].sort((a, b) => eventTime(a) - eventTime(b));
  const first = orderedCalls[0];
  const last = orderedCalls[orderedCalls.length - 1];
  if (!trainNumber || !first || !last) {
    warnings.push('「表からスタフ」から列番または駅時刻を取得できませんでした。');
    return [];
  }
  const calls = STATIONS.map((station) => {
    const source = callsByStation.get(station.id);
    if (!source) return { stationId: station.id, arrival: null, departure: null, stop: true, platform: '' };
    const isOrigin = station.id === first.stationId;
    const isDestination = station.id === last.stationId;
    if (isOrigin) return { ...source, arrival: null, departure: source.departure ?? source.arrival, stop: true };
    if (isDestination) return { ...source, arrival: source.arrival ?? source.departure, departure: null, stop: true };
    if (!source.stop) {
      const passTime = source.departure ?? source.arrival;
      return { ...source, arrival: passTime, departure: passTime };
    }
    return source;
  }).sort((a, b) => eventTime(a) - eventTime(b));
  const originId = first.stationId;
  const destinationId = last.stationId;
  const cachedCode = String(cellValue(sheet, 'B4') ?? '').trim();
  return [makeTrain({
    trainNumber,
    typeId,
    originId,
    destinationId,
    direction,
    serviceCode: /^A\d+\d+$/.test(cachedCode) ? cachedCode : serviceCode(typeId, destinationNumber(destinationId)),
    calls,
  })];
}

function parseDirectionalSheet(sheet: WorkSheet, direction: '上り' | '下り', warnings: string[], XLSX: typeof import('@e965/xlsx')): Train[] {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const eventRows: { row: number; stationId: number; event: 'arrival' | 'departure' | 'platform' }[] = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const label = normalizeLabel(cellValue(sheet, XLSX.utils.encode_cell({ r: row, c: 1 })));
    const platformMatch = /^(.*)番線$/.exec(label);
    const eventMatch = /^(.*)(着|発)$/.exec(label);
    const stationId = stationIdFromName(platformMatch?.[1] ?? eventMatch?.[1]);
    if (stationId === null) continue;
    eventRows.push({ row, stationId, event: platformMatch ? 'platform' : eventMatch?.[2] === '着' ? 'arrival' : 'departure' });
  }

  const trains: Train[] = [];
  let blankColumns = 0;
  for (let column = 2; column <= range.e.c; column += 1) {
    const trainNumber = String(cellValue(sheet, XLSX.utils.encode_cell({ r: 1, c: column })) ?? '').trim();
    if (!trainNumber) {
      if (cellValue(sheet, XLSX.utils.encode_cell({ r: 2, c: column })) !== undefined) blankColumns += 1;
      continue;
    }
    const typeId = parseTypeId(cellValue(sheet, XLSX.utils.encode_cell({ r: 2, c: column })));
    const originId = stationIdFromName(cellValue(sheet, XLSX.utils.encode_cell({ r: 7, c: column })));
    const destinationId = stationIdFromName(cellValue(sheet, XLSX.utils.encode_cell({ r: 8, c: column })));
    if (originId === null || destinationId === null) {
      warnings.push(`${trainNumber}: 始発駅または終着駅を認識できず除外しました。`);
      continue;
    }
    const stationEvents = new Map<number, { arrival: number | null; departure: number | null; platform: string }>();
    for (const entry of eventRows) {
      const event = stationEvents.get(entry.stationId) ?? { arrival: null, departure: null, platform: '' };
      const cell = cellValue(sheet, XLSX.utils.encode_cell({ r: entry.row, c: column }));
      if (entry.event === 'platform') event.platform = String(cell ?? '').trim();
      else {
        const time = valueAsSeconds(cell);
        if (time !== null) event[entry.event] = time;
      }
      stationEvents.set(entry.stationId, event);
    }
    const calls = STATIONS.map((station) => {
      const source = stationEvents.get(station.id) ?? { arrival: null, departure: null, platform: '' };
      const hasTime = source.arrival !== null || source.departure !== null;
      const isTerminal = station.id === originId || station.id === destinationId;
      const stop = isTerminal || Boolean(source.platform) || (source.arrival !== null && source.departure !== null);
      const passTime = source.departure ?? source.arrival;
      return {
        stationId: station.id,
        arrival: !stop && hasTime ? passTime : source.arrival,
        departure: !stop && hasTime ? passTime : source.departure,
        stop: hasTime ? stop : true,
        platform: source.platform,
      };
    }).sort((a, b) => eventTime(a) - eventTime(b));
    const first = calls.find((call) => call.arrival !== null || call.departure !== null);
    const last = [...calls].reverse().find((call) => call.arrival !== null || call.departure !== null);
    if (!first || !last) { warnings.push(`${trainNumber}: 駅時刻がないため除外しました。`); continue; }
    const cachedCode = String(cellValue(sheet, XLSX.utils.encode_cell({ r: 0, c: column })) ?? '').trim();
    const destinationCode = Number(cellValue(sheet, XLSX.utils.encode_cell({ r: 4, c: column }))) || destinationNumber(destinationId);
    trains.push(makeTrain({ trainNumber, typeId, originId, destinationId, direction, serviceCode: /^A\d+\d+$/.test(cachedCode) ? cachedCode : serviceCode(typeId, destinationCode), calls }));
  }
  if (blankColumns) warnings.push(`${direction}シートの列番未入力の${blankColumns}列は、既定値を繰り返す空欄テンプレートとして除外しました。`);
  return trains;
}

function parseGenericSheet(sheet: WorkSheet, warnings: string[], XLSX: typeof import('@e965/xlsx')): Train[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell ?? '').includes('列番') || String(cell ?? '').includes('列車番号')));
  if (headerIndex < 0) {
    warnings.push('列番を含む表を検出できません。このシートは取込対象外です。');
    return [];
  }
  const headers = rows[headerIndex].map((value) => normalizeLabel(value));
  const numberColumn = headers.findIndex((value) => value.includes('列番') || value.includes('列車番号'));
  const typeColumn = headers.findIndex((value) => value.includes('種別'));
  const destinationColumn = headers.findIndex((value) => value.includes('行先') || value.includes('行き先'));
  const trains: Train[] = [];
  for (const [rowIndex, row] of rows.slice(headerIndex + 1).entries()) {
    if (!row.some((cell) => cell !== null && cell !== '')) continue;
    const trainNumber = String(row[numberColumn] ?? '').trim();
    if (!trainNumber) { warnings.push(`${headerIndex + rowIndex + 2}行目: 列番がないため除外しました。`); continue; }
    const calls = STATIONS.map((station) => {
      const arrival = valueAsSeconds(row[headers.findIndex((value) => value === normalizeLabel(`${station.name}着`) || value === normalizeLabel(`${station.name}到着`))]);
      const departure = valueAsSeconds(row[headers.findIndex((value) => value === normalizeLabel(`${station.name}発`) || value === normalizeLabel(`${station.name}出発`))]);
      const platformIndex = headers.findIndex((value) => value === normalizeLabel(`${station.name}番線`));
      return { stationId: station.id, arrival, departure, stop: arrival !== null || departure !== null, platform: String(row[platformIndex] ?? '') };
    }).sort((a, b) => eventTime(a) - eventTime(b));
    const timedCalls = calls.filter((call) => call.arrival !== null || call.departure !== null);
    const first = timedCalls[0];
    const last = timedCalls[timedCalls.length - 1];
    if (!first || !last) { warnings.push(`${headerIndex + rowIndex + 2}行目: 駅時刻がないため除外しました。`); continue; }
    const typeId = parseTypeId(row[typeColumn]);
    const destinationId = last.stationId;
    const destinationText = String(row[destinationColumn] ?? stationName(destinationId));
    const callsWithPasses = calls.map((call) => {
      if (call.arrival !== null && call.departure !== null) return { ...call, stop: true };
      if (call.arrival === null && call.departure === null) return call;
      const time = call.departure ?? call.arrival;
      return { ...call, arrival: time, departure: time, stop: call.stationId === first.stationId || call.stationId === last.stationId };
    });
    trains.push(makeTrain({ trainNumber, typeId, originId: first.stationId, destinationId, direction: first.stationId >= destinationId ? '下り' : '上り', serviceCode: serviceCode(typeId, destinationNumber(destinationId)), destination: destinationText, calls: callsWithPasses }));
  }
  return trains;
}

function makeTrain(input: { trainNumber: string; typeId: number; originId: number; destinationId: number; direction: Train['direction']; serviceCode: string; calls: TrainCall[]; destination?: string }): Train {
  return {
    id: crypto.randomUUID(), originId: input.originId, destinationId: input.destinationId, typeId: input.typeId,
    direction: input.direction, serviceCode: input.serviceCode, trainNumber: input.trainNumber, name: '',
    destination: input.destination ?? stationName(input.destinationId),
    calls: input.calls, operationOrder: null,
  };
}

function valueAsSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value >= 0 ? Math.round(value * 86400) : null;
  const text = String(value).trim();
  if (!text || text === '…' || text === 'ﾚ' || text === 'レ' || text === '＝' || text === '=') return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 86400);
  return parseTime(text);
}

function parseTypeId(value: unknown): number {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  const name = normalizeLabel(value);
  if (name.includes('各駅停車') || name === '各停') return 6;
  if (name.includes('快速')) return name.includes('特別') || name.includes('特快') ? 8 : 7;
  return 1;
}

function stationIdFromName(value: unknown): number | null {
  const name = normalizeLabel(value);
  return STATIONS.find((station) => normalizeLabel(station.name) === name)?.id ?? null;
}

function normalizeLabel(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/[\s\u3000]/g, '');
}

function cellValue(sheet: WorkSheet, address: string): unknown {
  return sheet[address]?.v;
}

function eventTime(call: Pick<TrainCall, 'arrival' | 'departure'>): number {
  return call.departure ?? call.arrival ?? Number.MAX_SAFE_INTEGER;
}

function hasFormulas(sheet: WorkSheet): boolean {
  return Object.values(sheet).some((cell) => typeof cell === 'object' && cell !== null && 'f' in cell);
}
