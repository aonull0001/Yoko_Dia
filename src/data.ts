import type { Direction, Train, TrainCall, TrainType } from './types';

export const STATIONS = [
  { id: 1, name: '東神奈川' },
  { id: 2, name: '大口' },
  { id: 3, name: '横浜ゲートウェイ' },
  { id: 4, name: '菊名' },
  { id: 5, name: '新横浜' },
  { id: 6, name: '小机' },
] as const;

export const TRAIN_TYPES: TrainType[] = [
  { id: 1, name: '普通', color: '#3182ce', dash: '' },
  { id: 2, name: '快速', color: '#e53e3e', dash: '' },
  { id: 3, name: '特別快速', color: '#38a169', dash: '' },
  { id: 4, name: '回送', color: '#718096', dash: '8 5' },
  { id: 5, name: '臨時', color: '#805ad5', dash: '2 5' },
  { id: 6, name: '各駅停車', color: '#3182ce', dash: '' },
  { id: 7, name: '快速', color: '#e53e3e', dash: '' },
  { id: 8, name: '特別快速', color: '#38a169', dash: '' },
];

export const stationName = (id: number) => STATIONS.find((station) => station.id === id)?.name ?? `駅${id}`;
export const stationsForDirection = (direction: Direction) => direction === '上り' ? [...STATIONS].reverse() : STATIONS;
export const trainType = (id: number) => TRAIN_TYPES.find((type) => type.id === id) ?? { id, name: `種別${id}`, color: '#475569', dash: '' };
export const destinationNumber = (stationId: number) => workbookDestinationStations.indexOf(stationId) + 1 || stationId;
export const serviceCode = (typeId: number, destinationId: number) => `A${typeId}${destinationId}`;

const workbookDestinationStations = [1, 3, 5, 6];

export function createTrain(): Train {
  const calls: TrainCall[] = [...STATIONS].reverse().map((station, index, route) => ({
    stationId: station.id,
    arrival: index === 0 ? null : 6 * 3600 + index * 300,
    departure: index === route.length - 1 ? null : 6 * 3600 + index * 300 + 30,
    stop: true,
    platform: '',
  }));
  return {
    id: crypto.randomUUID(), originId: 6, destinationId: 1, typeId: 6,
    direction: '下り', serviceCode: serviceCode(6, destinationNumber(1)), trainNumber: '', name: '',
    destination: stationName(1), calls, operationOrder: null,
  };
}

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function parseTime(value: string): number | null {
  const match = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}
