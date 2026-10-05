import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';

export type CargoType = '集装箱' | '散货' | '重大件';
export type Deck = '主甲板' | '货舱';
export type DgStatus = '完整' | '缺类别';

export type Cargo = {
  id: string;
  bill: string;
  type: CargoType;
  bay: number;
  row: number;
  tier: number;
  deck: Deck;
  hold: string;
  weight: number;
  dimension: string;
  port: string;
  hazmat: string;
  declarationId: string | null;
  lashing: '已绑扎' | '待绑扎' | '需复核';
  color: string;
  posVersion: number;
  claimedBy: string | null;
};

export type DgDeclaration = {
  id: string;
  unNumber: string;
  category: string;
  name: string;
  segregationLevel: number;
  status: DgStatus;
  source: '码头申报' | '旧稿';
};

/** 同一货舱内允许装载的危险品箱上限（容量不足时排队）。 */
export const DG_CAPACITY_PER_HOLD = 2;

/** 按 UN 号取类别、名称与隔离等级。 */
export const UN_TABLE: Record<string, { category: string; name: string; segregation: number }> = {
  'UN 1263': { category: '3', name: '油漆类易燃液体', segregation: 2 },
  'UN 1203': { category: '3', name: '汽油', segregation: 2 },
  'UN 1805': { category: '8', name: '磷酸溶液', segregation: 1 },
  'UN 2789': { category: '8', name: '冰醋酸', segregation: 2 },
  'UN 1479': { category: '5.1', name: '氧化性固体', segregation: 2 },
  'UN 3082': { category: '9', name: '环境有害物质', segregation: 1 },
  'UN 2910': { category: '7', name: '放射性物质', segregation: 3 },
  'UN 1073': { category: '2.1', name: '冷冻液态氧', segregation: 2 },
  'UN 1993': { category: '3', name: '易燃液体（未另列明）', segregation: 2 },
  'UN 2735': { category: '8', name: '液态胺', segregation: 1 },
  'UN 1544': { category: '6.1', name: '生物碱类', segregation: 1 }
};

export function holdOf(deck: Deck, bay: number): string {
  if (deck === '主甲板') return '主甲板';
  if (bay <= 8) return '1号货舱';
  if (bay <= 13) return '2号货舱';
  return '3号货舱';
}

/** 隔离等级矩阵：两类别间所需最低隔离等级（0 = 可混装）。 */
const SEG_MATRIX: Record<string, number> = {
  '2.1|3': 2, '2.1|5.1': 2, '2.1|8': 1,
  '3|5.1': 2, '3|6.1': 1, '3|7': 2, '3|8': 1,
  '4.1|5.1': 2, '4.1|8': 1,
  '5.1|6.1': 1, '5.1|7': 2, '5.1|8': 2,
  '6.1|7': 2, '6.1|8': 1,
  '7|8': 2,
  '1|2.1': 3, '1|3': 3, '1|4.1': 3, '1|5.1': 3, '1|6.1': 3, '1|7': 3, '1|8': 3, '1|9': 2
};

export function requiredSegregation(catA: string, catB: string): number {
  if (!catA || !catB) return 0;
  if (catA === catB) return catA === '1' ? 3 : 0;
  const [x, y] = [catA, catB].sort();
  return SEG_MATRIX[`${x}|${y}`] ?? 0;
}

export type SegRelation = '上下层' | '相邻层' | '同舱' | '远舱';

/** 两只箱子的空间关系：同 Bay 同 Row 差一层为上下层；同舱差一层为相邻层；同舱同层为同舱。 */
export function segRelation(a: Cargo, b: Cargo): SegRelation {
  const sameBayRow = a.bay === b.bay && a.row === b.row;
  const tierDiff = Math.abs(a.tier - b.tier);
  if (sameBayRow && tierDiff === 1) return '上下层';
  if (a.hold === b.hold && tierDiff === 1) return '相邻层';
  if (a.hold === b.hold && tierDiff === 0) return '同舱';
  return '远舱';
}

const voyageData = {
  id: 'V-2609-17',
  vessel: '海岳轮',
  imo: 'IMO 9782214',
  route: '上海 → 釜山 → 温哥华',
  departure: '2026-10-02 14:00',
  revision: 5,
  cargo: [
    { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75' },
    { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835' },
    { id: 'BL-88227', bill: 'SEA-88227', type: '集装箱', bay: 6, row: 2, tier: 1, deck: '主甲板', weight: 22.4, dimension: '20 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1805', lashing: '已绑扎', color: '#b06a8f' },
    { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94' },
    { id: 'BL-88236', bill: 'SEA-88236', type: '集装箱', bay: 7, row: 1, tier: 1, deck: '货舱', weight: 26.8, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: 'UN 1479', lashing: '已绑扎', color: '#c08a3e' },
    { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d' },
    { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49' },
    { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836' }
  ].map((item) => ({ ...item, hold: holdOf(item.deck as Deck, item.bay), declarationId: item.hazmat === '无' ? null : `DG-${item.id.slice(-3)}`, posVersion: 1, claimedBy: null })) as Cargo[],
  declarations: [
    { id: 'DG-219', unNumber: 'UN 1263', category: '3', name: '油漆类易燃液体', segregationLevel: 2, status: '完整', source: '码头申报' },
    { id: 'DG-227', unNumber: 'UN 1805', category: '8', name: '磷酸溶液', segregationLevel: 1, status: '完整', source: '码头申报' },
    { id: 'DG-236', unNumber: 'UN 1479', category: '5.1', name: '氧化性固体', segregationLevel: 2, status: '完整', source: '码头申报' }
  ] as DgDeclaration[]
};

export type ImportResult =
  | { status: 'ok'; cargoId: string; declaration: DgDeclaration }
  | { status: 'failed'; cargoId: string; message: string }
  | { status: 'draft'; cargoId: string; declaration: DgDeclaration };

const mockBaseQuery: BaseQueryFn = async (arg) => {
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (arg === 'voyage' || (typeof arg === 'object' && arg && 'url' in arg && (arg as { url: string }).url === 'voyage')) return { data: voyageData };
  return { error: { status: 404, data: 'Not found' } };
};

export const stowageApi = createApi({
  reducerPath: 'stowageApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Voyage', 'Declaration'],
  endpoints: (builder) => ({
    getVoyage: builder.query<typeof voyageData, void>({ query: () => 'voyage', providesTags: ['Voyage'] }),
    importDeclaration: builder.mutation<ImportResult, { cargoId: string; unNumber: string }>({
      queryFn: async ({ cargoId, unNumber }) => {
        await new Promise((resolve) => setTimeout(resolve, 650));
        const un = unNumber.trim();
        // 模拟码头申报接口超时 / 网络异常：保留原货位与旧申报，可重试。
        if (un === 'UN 0000') {
          return { data: { status: 'failed', cargoId, message: '码头申报接口超时，未取到危险品类别与隔离等级' } };
        }
        // 模拟旧稿：申报能导回，但缺少危险品类别，需升级补齐后才能重排。
        if (un === 'UN 9999') {
          return {
            data: {
              status: 'draft',
              cargoId,
              declaration: { id: `DG-${cargoId.slice(-3)}`, unNumber: un, category: '', name: '旧稿危险品（待补齐）', segregationLevel: 0, status: '缺类别', source: '旧稿' }
            }
          };
        }
        const entry = UN_TABLE[un];
        if (!entry) {
          return { data: { status: 'failed', cargoId, message: `未在码头申报中找到 ${un}，请核对 UN 号后重试` } };
        }
        return {
          data: {
            status: 'ok',
            cargoId,
            declaration: { id: `DG-${cargoId.slice(-3)}`, unNumber: un, category: entry.category, name: entry.name, segregationLevel: entry.segregation, status: '完整', source: '码头申报' }
          }
        };
      },
      invalidatesTags: ['Declaration']
    })
  })
});

export const { useGetVoyageQuery, useImportDeclarationMutation } = stowageApi;
