import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';

export type CargoType = '集装箱' | '散货' | '重大件';
export type Cargo = {
  id: string;
  bill: string;
  type: CargoType;
  bay: number;
  row: number;
  tier: number;
  deck: '主甲板' | '货舱';
  weight: number;
  dimension: string;
  port: string;
  hazmat: string;
  lashing: '已绑扎' | '待绑扎' | '需复核';
  color: string;
};

export type TerminalImport = {
  receivedAt: string;
  declarations: { bill: string; un: string }[];
};

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
    { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94' },
    { id: 'BL-88236', bill: 'SEA-88236', type: '集装箱', bay: 14, row: 4, tier: 2, deck: '主甲板', weight: 21.8, dimension: '20 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 2014', lashing: '已绑扎', color: '#8a5a2b' },
    { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d' },
    { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49' },
    { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836' }
  ] as Cargo[]
};

/** 码头侧待导入的危险品申报 */
const terminalPayload: TerminalImport = {
  receivedAt: '2026-10-05 09:20',
  declarations: [
    { bill: 'SEA-88219', un: '1950' },
    { bill: 'SEA-88231', un: '1790' },
    { bill: 'SEA-88240', un: '9999' }
  ]
};

let importAttempts = 0;

const mockBaseQuery: BaseQueryFn = async (arg) => {
  await new Promise((resolve) => setTimeout(resolve, 180));
  const url = typeof arg === 'object' && arg && 'url' in arg ? (arg as { url: string }).url : arg;
  if (url === 'voyage') return { data: voyageData };
  if (url === 'terminal-declarations') {
    importAttempts += 1;
    // 模拟码头接口不稳定：奇数次超时失败，重试成功
    if (importAttempts % 2 === 1) return { error: { status: 503, data: '码头接口超时，申报未写入' } };
    return { data: terminalPayload };
  }
  return { error: { status: 404, data: 'Not found' } };
};

export const stowageApi = createApi({
  reducerPath: 'stowageApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Voyage'],
  endpoints: (builder) => ({
    getVoyage: builder.query<typeof voyageData, void>({ query: () => 'voyage', providesTags: ['Voyage'] }),
    importDgDeclarations: builder.mutation<TerminalImport, void>({ query: () => ({ url: 'terminal-declarations', method: 'POST' }) })
  })
});

export const { useGetVoyageQuery, useImportDgDeclarationsMutation } = stowageApi;
