import type { Cargo } from './api';

export type SlotRef = Pick<Cargo, 'deck' | 'bay' | 'row' | 'tier'>;

export type UnEntry = { name: string; dgClass: string; group: string };

/** 按 UN 号取危险品类别与隔离分组 */
export const UN_TABLE: Record<string, UnEntry> = {
  '1017': { name: '氯', dgClass: '2.3', group: '有毒气体' },
  '1090': { name: '丙酮', dgClass: '3', group: '易燃液体' },
  '1203': { name: '汽油', dgClass: '3', group: '易燃液体' },
  '1263': { name: '涂料及涂料溶液', dgClass: '3', group: '易燃液体' },
  '1389': { name: '碱金属汞齐', dgClass: '4.3', group: '遇水放出易燃气体' },
  '1790': { name: '氢氟酸', dgClass: '8', group: '腐蚀性物质' },
  '1950': { name: '气雾剂', dgClass: '2.1', group: '易燃气体' },
  '2014': { name: '过氧化氢水溶液', dgClass: '5.1', group: '氧化性物质' },
  '3077': { name: '对环境有害的固体物质', dgClass: '9', group: '杂项危险物质' },
  '3481': { name: '含在设备中的锂离子电池', dgClass: '9', group: '杂项危险物质' }
};

export const DG_CLASSES = ['2.1', '2.3', '3', '4.3', '5.1', '8', '9'];

/** 隔离等级：0 无要求 / 1 远离 / 2 隔离 / 3 用整个舱室隔离 / 4 纵向隔整个舱室 */
export const LEVEL_LABELS = ['无隔离要求', '隔离1 · 远离', '隔离2 · 隔离', '隔离3 · 用整个舱室隔离', '隔离4 · 纵向隔整个舱室'];

const PAIR_RULES: [string, string, number][] = [
  ['2.1', '3', 1], ['2.1', '4.3', 2], ['2.1', '5.1', 2], ['2.1', '8', 1],
  ['2.3', '2.1', 2], ['2.3', '3', 2], ['2.3', '4.3', 2], ['2.3', '5.1', 2], ['2.3', '8', 2], ['2.3', '9', 1],
  ['3', '4.3', 1], ['3', '5.1', 2], ['3', '8', 1],
  ['4.3', '5.1', 2], ['4.3', '8', 1],
  ['5.1', '8', 2], ['5.1', '9', 1],
  ['8', '9', 1]
];

const MATRIX: Record<string, Record<string, number>> = {};
PAIR_RULES.forEach(([a, b, level]) => {
  MATRIX[a] = { ...MATRIX[a], [b]: level };
  MATRIX[b] = { ...MATRIX[b], [a]: level };
});

/** 两类危险品之间的隔离等级要求 */
export function requiredLevel(classA: string, classB: string): number {
  if (!classA || !classB || classA === classB) return 0;
  return MATRIX[classA]?.[classB] ?? 0;
}

/** 各隔离等级要求的最小分隔分数 */
const MIN_SCORE = [0, 3, 4, 5, 6];
export function minScoreFor(level: number): number {
  return MIN_SCORE[level] ?? 0;
}

export function holdOf(bay: number): string {
  return bay <= 9 ? '第一货舱' : '第二货舱';
}

export type Relation = { score: number; label: string };

/** 两个货位的相对关系：同舱、相邻层、上下层、分舱等 */
export function relationOf(a: SlotRef, b: SlotRef): Relation {
  if (a.deck === b.deck && a.bay === b.bay && a.row === b.row && a.tier === b.tier) return { score: 0, label: '同一箱位' };
  const bayGap = Math.abs(a.bay - b.bay);
  if (a.deck !== b.deck) return bayGap >= 9 ? { score: 6, label: '跨甲板纵向远隔' } : { score: 4, label: '甲板与舱内分隔' };
  if (holdOf(a.bay) !== holdOf(b.bay)) return bayGap >= 9 ? { score: 5, label: '纵向间隔一个货舱' } : { score: 4, label: '不同货舱' };
  if (a.bay === b.bay && a.row === b.row) return { score: 1, label: `上下层（T${a.tier}↔T${b.tier}）` };
  if (Math.abs(a.tier - b.tier) <= 1 && bayGap <= 1 && Math.abs(a.row - b.row) <= 1) return { score: 2, label: '相邻层/紧邻' };
  return { score: 3, label: `同舱（${holdOf(a.bay)}）` };
}

/** 主甲板危险品货位区与容量 */
export const DG_ZONE = { deck: '主甲板', bayFrom: 10, bayTo: 14, rowFrom: 3, rowTo: 6, capacity: 2, label: '主甲板 B10–B14 / R3–R6' };

export function inDgZone(cargo: SlotRef): boolean {
  return cargo.deck === DG_ZONE.deck && cargo.bay >= DG_ZONE.bayFrom && cargo.bay <= DG_ZONE.bayTo && cargo.row >= DG_ZONE.rowFrom && cargo.row <= DG_ZONE.rowTo;
}

/** 单箱堆码校核 */
export function checkStack(cargo: Cargo, all: Cargo[]): string[] {
  const issues: string[] = [];
  if (cargo.type === '集装箱' && cargo.tier >= 3 && cargo.weight > 30) issues.push(`第 ${cargo.tier} 层堆重 ${cargo.weight}t 超限`);
  if (cargo.type === '重大件' && cargo.tier > 1) issues.push('重大件未置于底层');
  const above = all.find((o) => o.id !== cargo.id && o.deck === cargo.deck && o.bay === cargo.bay && o.row === cargo.row && o.tier === cargo.tier + 1);
  if (above && above.weight > cargo.weight + 10) issues.push(`上重下轻：上方 ${above.id} ${above.weight}t`);
  return issues;
}

export function parseUn(hazmat: string): string {
  return (hazmat.match(/(\d{4})/) ?? [])[1] ?? '';
}
