import { createNoise2D } from 'simplex-noise';

// 地形类型定义
export enum TileType {
  WATER = 0,    // 水 (蓝色)
  GRASS = 1,    // 草地 (绿色)
  FOREST = 2,   // 森林 (深绿)
  MOUNTAIN = 3, // 高山 (灰色)
}

export const TILE_SIZE = 16; // 每个格子 16x16 像素
export const MAP_WIDTH = 100; // 地图宽 100 格
export const MAP_HEIGHT = 100; // 地图高 100 格

export function generateMap(seed: number) {
  const noise2D = createNoise2D(() => {
    // 简单的伪随机数生成器 (为了让同一个种子生成的地图永远一样)
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  });

  const tiles: number[] = [];

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      // 核心算法：根据坐标获取噪点值 (-1 到 1 之间)
      // 除以 20 是为了让地形更平滑，不要太细碎
      const elevation = noise2D(x / 20, y / 20);
      
      let type = TileType.GRASS;

      if (elevation < -0.2) {
        type = TileType.WATER;
      } else if (elevation > 0.5) {
        type = TileType.MOUNTAIN;
      } else if (elevation > 0.2) {
        type = TileType.FOREST;
      }

      tiles.push(type);
    }
  }

  return tiles;
}