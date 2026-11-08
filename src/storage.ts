import { destinationNumber, serviceCode } from './data';
import type { DiagramData, Train } from './types';

const DB_NAME = 'yokohama-train-diagram';
const STORE_NAME = 'documents';
const CURRENT_KEY = 'current';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('このブラウザーはIndexedDBに対応していません。'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けませんでした。'));
  });
}

export async function saveLocal(data: DiagramData): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(data, CURRENT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('自動保存に失敗しました。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('自動保存が中止されました。'));
  });
  db.close();
}

export async function loadLocal(): Promise<DiagramData | null> {
  const db = await openDatabase();
  const result = await new Promise<DiagramData | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(CURRENT_KEY);
    request.onsuccess = () => resolve((request.result as DiagramData | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('保存データの読み込みに失敗しました。'));
  });
  db.close();
  return result;
}

export function parseYtd(text: string): DiagramData {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('YTDファイルのJSON形式が不正です。'); }
  if (!value || typeof value !== 'object') throw new Error('YTDファイルの内容が不正です。');
  const candidate = value as Partial<DiagramData>;
  if (candidate.format !== 'YokohamaTrainDiagram' || !Array.isArray(candidate.trains)) throw new Error('対応していないYTD形式です。');
  const version = Number(candidate.version ?? 0);
  if (version > 1 || version < 0) throw new Error(`YTDバージョン${version}には対応していません。`);
  const trains = candidate.trains.map((raw, index) => migrateTrain(raw, index));
  return { format: 'YokohamaTrainDiagram', version: 1, railwayName: candidate.railwayName || '横浜鉄道', lineName: candidate.lineName || '横浜鉄道線', trains };
}

function migrateTrain(raw: unknown, index: number): Train {
  if (!raw || typeof raw !== 'object') throw new Error(`${index + 1}件目の列車データが不正です。`);
  const train = raw as Partial<Train>;
  if (!Array.isArray(train.calls)) throw new Error(`${index + 1}件目の列車の駅時刻情報がありません。`);
  const calls = train.calls.map((call) => {
    if (!call || typeof call !== 'object' || !Number.isInteger((call as {stationId?: number}).stationId)) throw new Error(`${index + 1}件目の駅情報が不正です。`);
    const value = call as {stationId: number; arrival?: number | null; departure?: number | null; stop?: boolean; platform?: string};
    return { stationId: value.stationId, arrival: value.arrival ?? null, departure: value.departure ?? null, stop: value.stop ?? true, platform: value.platform ?? '' };
  });
  const typeId = Number.isInteger(train.typeId) ? train.typeId! : 1;
  const destinationId = Number.isInteger(train.destinationId) ? train.destinationId! : 6;
  return { id: train.id || `migrated-${index}`, originId: train.originId ?? 1, destinationId, typeId, direction: train.direction === '上り' ? '上り' : '下り', serviceCode: train.serviceCode || serviceCode(typeId, destinationNumber(destinationId)), trainNumber: train.trainNumber ?? '', name: train.name ?? '', destination: train.destination || `駅${destinationId}`, calls, operationOrder: train.operationOrder ?? null };
}
