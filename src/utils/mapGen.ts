import { createNoise2D } from 'simplex-noise';

export const TILE_SIZE = 32;
export const MAP_WIDTH = 80; // 地图变大一点
export const MAP_HEIGHT = 60;

// 扩展地形定义
export enum TileType {
  DEEP_WATER = 0x1e3799,
  WATER = 0x4a69bd,
  SAND = 0xf6e58d,
  GRASS = 0x2ecc71,      // 调整为更鲜艳的草地
  FOREST = 0x27ae60,
  MOUNTAIN = 0x95a5a6,
  SNOW = 0xffffff,
  
  // 人工建筑
  FLOOR_STONE = 0x7f8c8d,
  FLOOR_WOOD = 0xd35400,
  WALL_STONE = 0x2c3e50, // 深色石墙
  WALL_WOOD = 0xa04000,  // 深色木墙
  STUMP = 0x8d6e63,
}

// 矮人名字库
const DWARF_NAMES = ["Urist", "Zon", "Bomrek", "Kogan", "Dastot", "Mebzuth", "Iden", "Sodel"];
const DWARF_SURNAMES = ["Ironfist", "Alelover", "Rockseeker", "Goldbeard", "Axebreaker", "Deepdelver"];

export function getRandomName() {
  return `${DWARF_NAMES[Math.floor(Math.random() * DWARF_NAMES.length)]} ${DWARF_SURNAMES[Math.floor(Math.random() * DWARF_SURNAMES.length)]}`;
}

export interface Dwarf {
  id: number;
  name: string;
  x: number;
  y: number;
  color: number;
  state: 'IDLE' | 'MOVING' | 'WORKING' | 'BUILDING';
  targetIndex?: number;
  workTimer: number;
  // 简单的需求系统
  energy: number; // 0-100
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
      const elevation = noise2D(x / 20, y / 20); // 噪声系数调整，地形更平缓
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