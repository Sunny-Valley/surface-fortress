import { createNoise2D } from 'simplex-noise';

export const TILE_SIZE = 32;
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 64;

export enum TileType {
  DEEP_WATER = 0x1e3799,
  WATER = 0x4a69bd,
  SAND = 0xf6e58d,
  GRASS = 0x78e08f,
  FOREST = 0x079992, // 树木 (可砍伐)
  MOUNTAIN = 0x60a3bc,// 岩石 (可挖掘)
  SNOW = 0xffffff,
  FLOOR = 0x57606f,   // 被挖开后的地板
  STUMP = 0x8d6e63,   // 树桩
}

export interface Dwarf {
  id: number;
  x: number;
  y: number;
  color: number;
  state: 'IDLE' | 'MOVING' | 'WORKING';
  targetIndex?: number; // 目标的格子索引
  workTimer: number;    // 工作还需要多久完成
}

export function generateMap(seed: number) {
  const noise2D = createNoise2D(() => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  });

  const tiles: number[] = [];
  let spawnPoint = { x: 0, y: 0 };

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const elevation = noise2D(x / 15, y / 15);
      let color = TileType.GRASS;

      if (elevation < -0.6) color = TileType.DEEP_WATER;
      else if (elevation < -0.2) color = TileType.WATER;
      else if (elevation < -0.1) color = TileType.SAND;
      else if (elevation < 0.3) {
        color = TileType.GRASS;
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