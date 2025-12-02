'use client';

import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { generateMap, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TileType } from '../utils/mapGen';

export default function GameMap() {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    let app: PIXI.Application | null = null;

    const initGame = async () => {
      // 1. 初始化 Pixi
      const _app = new PIXI.Application();
      await _app.init({ 
        resizeTo: window,
        backgroundColor: 0x1a1a1a, // 深色背景
      });

      if (!isMounted) { _app.destroy(); return; }
      app = _app;
      if (mapRef.current) mapRef.current.appendChild(app.canvas);

      // 2. 生成地图数据 (使用随机种子)
      const mapData = generateMap(Math.random()); 

      // 3. 创建一个容器来放地图 (方便以后做缩放/拖拽)
      const worldContainer = new PIXI.Container();
      app.stage.addChild(worldContainer);

      // 4. 高效绘制地图 (使用 Graphics 一次性画完，性能最高)
      const terrain = new PIXI.Graphics();
      
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const index = y * MAP_WIDTH + x;
          const type = mapData[index];

          // 根据类型上色
          let color = 0x2ecc71; // 默认草地绿
          if (type === TileType.WATER) color = 0x3498db; // 蓝水
          if (type === TileType.FOREST) color = 0x27ae60; // 深绿森林
          if (type === TileType.MOUNTAIN) color = 0x95a5a6; // 灰山

          // 画一个小方块
          terrain.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          terrain.fill(color);
        }
      }
      
      // 把画好的地形加入容器
      worldContainer.addChild(terrain);

      // 5. 把地图居中显示
      const mapPixelWidth = MAP_WIDTH * TILE_SIZE;
      const mapPixelHeight = MAP_HEIGHT * TILE_SIZE;
      
      worldContainer.x = (app.screen.width - mapPixelWidth) / 2;
      worldContainer.y = (app.screen.height - mapPixelHeight) / 2;

      // 6. 简单的鼠标交互：按住空格键拖拽地图 (简易版)
      // *注：为了不让代码太复杂，这里暂时不做拖拽，先只做显示*
    };

    initGame();

    return () => {
      isMounted = false;
      if (app) app.destroy({ removeView: true }, { children: true });
    };
  }, []);

  return <div ref={mapRef} style={{ width: '100vw', height: '100vh' }} />;
}