import { createNoise2D } from 'simplex-noise';

// --- 配置常量 ---
export const TILE_SIZE = 32; // 改大一点，看得更清楚
export const MAP_WIDTH = 64; 
export const MAP_HEIGHT = 64;

export enum TileType {
  DEEP_WATER = 0x1e3799, // 深水
  WATER = 0x4a69bd,      // 浅水
  SAND = 0xf6e58d,       // 沙滩
  GRASS = 0x78e08f,      // 草地
  FOREST = 0x079992,     // 森林
  MOUNTAIN = 0x60a3bc,   // 岩石
  SNOW = 0xffffff,       // 雪顶
}

// --- 矮人数据结构 ---
export interface Dwarf {
  id: number;
  x: number; // 像素坐标
  y: number;
  color: number;
  targetX?: number; // 移动目标
  targetY?: number;
}

export function generateMap(seed: number) {
  const noise2D = createNoise2D(() => {
    // 伪随机数算法
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  });

  const tiles: number[] = [];
  let spawnPoint = { x: 0, y: 0 }; // 寻找一个适合出生的地方（草地）

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const elevation = noise2D(x / 15, y / 15); // 地形噪点
      
      let color = TileType.GRASS;

      // 根据高度决定地形颜色
      if (elevation < -0.6) color = TileType.DEEP_WATER;
      else if (elevation < -0.2) color = TileType.WATER;
      else if (elevation < -0.1) color = TileType.SAND;
      else if (elevation < 0.3) {
        color = TileType.GRASS;
        // 如果是草地，记录为潜在出生点
        spawnPoint = { x: x * TILE_SIZE, y: y * TILE_SIZE };
      }
      else if (elevation < 0.6) color = TileType.FOREST;
      else if (elevation < 0.8) color = TileType.MOUNTAIN;
      else color = TileType.SNOW;

      tiles.push(color);
    }
  }

  return { tiles, spawnPoint };
}