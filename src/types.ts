export type Direction = '上り' | '下り';
export type ViewMode = '上下線' | Direction;
export type TrainCall = {
  stationId: number;
  arrival: number | null;
  departure: number | null;
  stop: boolean;
  platform: string;
};
export type Train = {
  id: string;
  originId: number;
  destinationId: number;
  typeId: number;
  direction: Direction;
  serviceCode: string;
  trainNumber: string;
  name: string;
  destination: string;
  calls: TrainCall[];
  operationOrder: number | null;
};
export type TrainType = { id: number; name: string; color: string; dash: string };
export type DiagramData = {
  format: 'YokohamaTrainDiagram';
  version: 1;
  railwayName: string;
  lineName: string;
  trains: Train[];
};
export type Issue = {
  id: string;
  severity: '要確認' | '競合の可能性あり' | '判定不能';
  message: string;
  trainIds: string[];
  stationId?: number;
  time?: number;
};
