import { STATIONS } from './data';
import type { Issue, Train } from './types';

export function calculateIntermediateTimes(travelSeconds: number[], dwellSeconds: number[], direction: Train['direction']): number[] {
  if (travelSeconds.length !== STATIONS.length - 1 || dwellSeconds.length !== STATIONS.length) {
    throw new Error('駅数と駅間・停車時間の数が一致しません。');
  }
  if ([...travelSeconds, ...dwellSeconds].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('走行時間と停車時間は0以上の有限値で指定してください。');
  }
  const orderedTravel = direction === '下り' ? travelSeconds : [...travelSeconds].reverse();
  const orderedDwell = direction === '下り' ? dwellSeconds : [...dwellSeconds].reverse();
  const times = [0];
  for (let i = 0; i < orderedTravel.length; i += 1) {
    times.push(times[i] + orderedDwell[i] + orderedTravel[i]);
  }
  return times;
}

export function validateTrain(train: Train): Issue[] {
  const issues: Issue[] = [];
  const calls = [...train.calls].sort((a, b) => train.direction === '下り' ? a.stationId - b.stationId : b.stationId - a.stationId);
  for (const call of calls) {
    if (call.arrival !== null && call.departure !== null && call.departure < call.arrival) {
      issues.push({ id: `reverse-${train.id}-${call.stationId}`, severity: '要確認', message: `${stationLabel(call.stationId)}で到着が出発より後です。`, trainIds: [train.id], stationId: call.stationId, time: call.arrival });
    }
  }
  for (let i = 1; i < calls.length; i += 1) {
    const previous = calls[i - 1];
    const current = calls[i];
    const departure = previous.departure ?? previous.arrival;
    const arrival = current.arrival ?? current.departure;
    if (departure !== null && arrival !== null && arrival < departure) {
      issues.push({ id: `run-reverse-${train.id}-${current.stationId}`, severity: '要確認', message: '駅間の時刻が逆転しています。', trainIds: [train.id], stationId: current.stationId, time: arrival });
    }
    if (departure !== null && arrival !== null && arrival - departure > 3600) {
      issues.push({ id: `run-long-${train.id}-${current.stationId}`, severity: '要確認', message: '駅間走行時間が1時間を超えています。要確認です。', trainIds: [train.id], stationId: current.stationId, time: departure });
    }
  }
  if (calls.some((call) => call.arrival === null && call.departure === null)) {
    issues.push({ id: `missing-${train.id}`, severity: '判定不能', message: '時刻が未入力の駅があるため一部判定できません。', trainIds: [train.id] });
  }
  return issues;
}

function stationLabel(id: number) {
  return STATIONS.find((station) => station.id === id)?.name ?? `駅${id}`;
}

export function checkConflicts(trains: Train[]): Issue[] {
  const issues = trains.flatMap(validateTrain);
  for (let i = 0; i < trains.length; i += 1) {
    for (let j = i + 1; j < trains.length; j += 1) {
      const a = trains[i];
      const b = trains[j];
      for (const aCall of a.calls) {
        const bCall = b.calls.find((call) => call.stationId === aCall.stationId);
        if (!bCall || !aCall.stop || !bCall.stop) continue;
        const aStart = aCall.arrival ?? aCall.departure;
        const aEnd = aCall.departure ?? aCall.arrival;
        const bStart = bCall.arrival ?? bCall.departure;
        const bEnd = bCall.departure ?? bCall.arrival;
        if (aStart === null || aEnd === null || bStart === null || bEnd === null) continue;
        if (Math.max(aStart, bStart) <= Math.min(aEnd, bEnd)) {
          const samePlatform = Boolean(aCall.platform) && aCall.platform === bCall.platform;
          const message = samePlatform
            ? `${stationLabel(aCall.stationId)} ${aCall.platform}番線の停車時刻が重複しています。閉そく等の情報がないため安全性は判定しません。`
            : `${stationLabel(aCall.stationId)}の停車時刻が重複しています。番線情報が不足しているため要確認です。`;
          issues.push({ id: `station-${a.id}-${b.id}-${aCall.stationId}`, severity: samePlatform ? '競合の可能性あり' : '要確認', message, trainIds: [a.id, b.id], stationId: aCall.stationId, time: Math.max(aStart, bStart) });
        }
      }
      for (let k = 0; k < STATIONS.length - 1; k += 1) {
        const aFrom = a.calls.find((call) => call.stationId === k + 1);
        const aTo = a.calls.find((call) => call.stationId === k + 2);
        const bFrom = b.calls.find((call) => call.stationId === k + 1);
        const bTo = b.calls.find((call) => call.stationId === k + 2);
        if (!aFrom || !aTo || !bFrom || !bTo) continue;
        const aStart = aFrom.departure ?? aFrom.arrival;
        const aEnd = aTo.arrival ?? aTo.departure;
        const bStart = bFrom.departure ?? bFrom.arrival;
        const bEnd = bTo.arrival ?? bTo.departure;
        if ([aStart, aEnd, bStart, bEnd].some((value) => value === null)) continue;
        if (aStart === null || aEnd === null || bStart === null || bEnd === null) continue;
        if (Math.max(Math.min(aStart, aEnd), Math.min(bStart, bEnd)) <= Math.min(Math.max(aStart, aEnd), Math.max(bStart, bEnd))) {
          issues.push({ id: `section-${a.id}-${b.id}-${k}`, severity: '要確認', message: `${stationLabel(k + 1)}〜${stationLabel(k + 2)}の列車時刻が重なります。線路構造が未登録のため要確認です。`, trainIds: [a.id, b.id], stationId: k + 1, time: Math.max(aStart, bStart) });
        } else if (Math.abs(aEnd - bStart) <= 30 || Math.abs(bEnd - aStart) <= 30) {
          issues.push({ id: `near-${a.id}-${b.id}-${k}`, severity: '要確認', message: '前後30秒以内に関連列車があります（安全間隔を示すものではありません）。', trainIds: [a.id, b.id], stationId: k + 1, time: Math.min(aEnd, bEnd) });
        }
      }
    }
  }
  const grouped = new Map<string, Train[]>();
  for (const train of trains.filter((item) => item.trainNumber.trim())) {
    const list = grouped.get(train.trainNumber.trim()) ?? [];
    list.push(train);
    grouped.set(train.trainNumber.trim(), list);
  }
  for (const [number, group] of grouped) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => (a.operationOrder ?? firstTime(a)) - (b.operationOrder ?? firstTime(b)));
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1];
      const next = ordered[i];
      const previousRoute = [...previous.calls].sort((a, b) => previous.direction === '下り' ? a.stationId - b.stationId : b.stationId - a.stationId);
      const nextRoute = [...next.calls].sort((a, b) => next.direction === '下り' ? a.stationId - b.stationId : b.stationId - a.stationId);
      const last = [...previousRoute].reverse().find((call) => call.arrival !== null || call.departure !== null);
      const first = nextRoute.find((call) => call.arrival !== null || call.departure !== null);
      if (!last || !first || last.stationId !== first.stationId || (last.arrival ?? last.departure ?? 0) > (first.departure ?? first.arrival ?? 0)) {
        issues.push({ id: `operation-${number}-${previous.id}-${next.id}`, severity: '要確認', message: `列番${number}の接続駅・時刻が自動判定できません。運用順序を確認してください。`, trainIds: [previous.id, next.id] });
      }
    }
  }
  return issues;
}

function firstTime(train: Train) {
  return Math.min(...train.calls.map((call) => call.departure ?? call.arrival ?? Number.MAX_SAFE_INTEGER));
}
