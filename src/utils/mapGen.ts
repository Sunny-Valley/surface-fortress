import { createNoise2D } from 'simplex-noise';

export const TILE_SIZE = 32;
export const MAP_WIDTH = 80; // 地图宽
export const MAP_HEIGHT = 60; // 地图高

// 1. 定义所有地形和建筑类型
export enum TileType {
  DEEP_WATER = 0x1e3799,
  WATER = 0x4a69bd,
  SAND = 0xf6e58d,
  GRASS = 0x2ecc71,
  FOREST = 0x27ae60,
  MOUNTAIN = 0x95a5a6,
  SNOW = 0xffffff,
  
  // 新增：建筑类型
  FLOOR_STONE = 0x7f8c8d,
  FLOOR_WOOD = 0xd35400,
  WALL_STONE = 0x2c3e50, 
  WALL_WOOD = 0xa04000,
  STUMP = 0x8d6e63,
}

// 2. 名字生成器 (GameMap 需要调用这个)
const DWARF_NAMES = ["Urist", "Zon", "Bomrek", "Kogan", "Dastot", "Mebzuth", "Iden", "Sodel"];
const DWARF_SURNAMES = ["Ironfist", "Alelover", "Rockseeker", "Goldbeard", "Axebreaker", "Deepdelver"];

export function getRandomName() {
  return `${DWARF_NAMES[Math.floor(Math.random() * DWARF_NAMES.length)]} ${DWARF_SURNAMES[Math.floor(Math.random() * DWARF_SURNAMES.length)]}`;
}

// 3. 矮人数据结构
export interface Dwarf {
  id: number;
  name: string;
  x: number;
  y: number;
  color: number;
  state: 'IDLE' | 'MOVING' | 'WORKING' | 'BUILDING';
  targetIndex?: number;
  workTimer: number;
  energy: number;
}

// 4. 地图生成算法
export function generateMap(seed: number) {
  const noise2D = createNoise2D(() => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  });

  const tiles: number[] = [];
  let spawnPoint = { x: 0, y: 0 };

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const elevation = noise2D(x / 20, y / 20);
      let color = TileType.GRASS;

      if (elevation < -0.6) color = TileType.DEEP_WATER;
      else if (elevation < -0.25) color = TileType.WATER;
      else if (elevation < -0.15) color = TileType.SAND;
      else if (elevation < 0.35) {
        color = TileType.GRASS;
        spawnPoint = { x: x * TILE_SIZE, y: y * TILE_SIZE };
      }
      else if (elevation < 0.65) color = TileType.FOREST;
      else if (elevation < 0.85) color = TileType.MOUNTAIN;
      else color = TileType.SNOW;

      tiles.push(color);
    }
  }
  return { tiles, spawnPoint };
}