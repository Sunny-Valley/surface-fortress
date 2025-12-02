'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { generateMap, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, Dwarf } from '../utils/mapGen';

export default function GameMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  // 用 React 状态来显示 UI 信息
  const [debugInfo, setDebugInfo] = useState("初始化中...");

  useEffect(() => {
    let isMounted = true;
    let app: PIXI.Application | null = null;
    
    // --- 游戏状态变量 ---
    const world = new PIXI.Container(); // 世界容器 (用于缩放拖拽)
    const dwarves: Dwarf[] = [];        // 矮人数据
    const dwarfGraphics = new PIXI.Graphics(); // 专门画矮人的层
    let selectionBox: PIXI.Graphics;    // 鼠标选框

    const initGame = async () => {
      // 1. 初始化 Pixi v8
      const _app = new PIXI.Application();
      await _app.init({ 
        resizeTo: window,
        backgroundColor: 0x111111,
        antialias: false, // 像素风不需要抗锯齿
      });

      if (!isMounted) { _app.destroy(); return; }
      app = _app;
      if (mapRef.current) mapRef.current.appendChild(app.canvas);

      // 2. 设置舞台
      app.stage.addChild(world);
      
      // 开启事件交互 (允许拖拽)
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      // 3. 生成地图数据
      const seed = Math.random();
      const { tiles, spawnPoint } = generateMap(seed);
      setDebugInfo(`地图种子: ${seed.toFixed(4)} | 矮人数量: 5`);

      // 4. 渲染静态地形 (使用 Graphics 缓存为纹理，性能极高)
      const terrain = new PIXI.Graphics();
      tiles.forEach((color, i) => {
        const x = (i % MAP_WIDTH) * TILE_SIZE;
        const y = Math.floor(i / MAP_WIDTH) * TILE_SIZE;
        terrain.rect(x, y, TILE_SIZE, TILE_SIZE);
        terrain.fill(color);
      });
      world.addChild(terrain);

      // 5. 添加交互选框
      selectionBox = new PIXI.Graphics();
      world.addChild(selectionBox);

      // 6. 添加矮人层
      world.addChild(dwarfGraphics);
      
      // 初始化 5 个矮人
      for (let i = 0; i < 5; i++) {
        dwarves.push({
          id: i,
          x: spawnPoint.x + Math.random() * 100,
          y: spawnPoint.y + Math.random() * 100,
          color: 0xe74c3c, // 红色矮人
          targetX: spawnPoint.x + Math.random() * 200 - 100,
          targetY: spawnPoint.y + Math.random() * 200 - 100,
        });
      }

      // 7. 把视角移到出生点中心
      world.x = app.screen.width / 2 - spawnPoint.x;
      world.y = app.screen.height / 2 - spawnPoint.y;

      // --- 核心机制：游戏循环 (Ticker) ---
      app.ticker.add((ticker) => {
        // A. 清空并重画所有矮人
        dwarfGraphics.clear();
        
        dwarves.forEach(dwarf => {
          // 简单的 AI：向目标移动
          if (dwarf.targetX !== undefined && dwarf.targetY !== undefined) {
            const dx = dwarf.targetX - dwarf.x;
            const dy = dwarf.targetY - dwarf.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist > 2) {
              dwarf.x += (dx / dist) * 2; // 速度 2
              dwarf.y += (dy / dist) * 2;
            } else {
              // 到达目标，随机找新目标 (模拟闲逛)
              dwarf.targetX = dwarf.x + (Math.random() * 200 - 100);
              dwarf.targetY = dwarf.y + (Math.random() * 200 - 100);
            }
          }

          // 画矮人 (简单的方块 + 名字)
          dwarfGraphics.rect(dwarf.x, dwarf.y, TILE_SIZE * 0.8, TILE_SIZE * 0.8);
          dwarfGraphics.fill(dwarf.color);
        });
      });

      // --- 核心机制：相机控制 (拖拽与缩放) ---
      let isDragging = false;
      let lastPos = { x: 0, y: 0 };

      // 鼠标按下
      app.stage.on('pointerdown', (e) => {
        isDragging = true;
        lastPos = { x: e.global.x, y: e.global.y };
      });

      // 鼠标移动
      app.stage.on('pointermove', (e) => {
        // 1. 处理拖拽
        if (isDragging) {
          const dx = e.global.x - lastPos.x;
          const dy = e.global.y - lastPos.y;
          world.x += dx;
          world.y += dy;
          lastPos = { x: e.global.x, y: e.global.y };
        }

        // 2. 处理选框高亮 (计算鼠标在世界坐标系的位置)
        // 将屏幕坐标 转换为 世界坐标
        const worldPos = world.toLocal(e.global);
        const gridX = Math.floor(worldPos.x / TILE_SIZE);
        const gridY = Math.floor(worldPos.y / TILE_SIZE);

        selectionBox.clear();
        if (gridX >= 0 && gridX < MAP_WIDTH && gridY >= 0 && gridY < MAP_HEIGHT) {
          selectionBox.rect(gridX * TILE_SIZE, gridY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          selectionBox.stroke({ width: 2, color: 0xffff00 }); // 黄色描边
          
          // 更新 UI
          setDebugInfo(`坐标: [${gridX}, ${gridY}]`);
        }
      });

      // 鼠标松开
      app.stage.on('pointerup', () => { isDragging = false; });
      app.stage.on('pointerupoutside', () => { isDragging = false; });

      // 鼠标滚轮 (缩放)
      const canvas = app.canvas as HTMLCanvasElement;
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const scaleBy = 1.1;
        const oldScale = world.scale.x;
        const newScale = e.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
        
        // 限制缩放范围
        if (newScale > 0.2 && newScale < 5) {
          // 简单的中心缩放逻辑
          const mouseX = e.clientX;
          const mouseY = e.clientY;
          
          // 计算鼠标相对于世界的位置
          const worldPos = world.toLocal({x: mouseX, y: mouseY});
          
          world.scale.set(newScale);
          
          // 修正位置，让鼠标指向的点保持不变
          const newScreenPos = world.toGlobal(worldPos);
          world.x -= newScreenPos.x - mouseX;
          world.y -= newScreenPos.y - mouseY;
        }
      }, { passive: false });

    };

    initGame();

    return () => {
      isMounted = false;
      if (app) app.destroy({ removeView: true }, { children: true });
    };
  }, []);

  return (
    <div className="relative">
      {/* 游戏画布 */}
      <div ref={mapRef} style={{ width: '100vw', height: '100vh' }} />
      
      {/* UI 覆盖层 */}
      <div className="absolute top-4 left-4 bg-black/70 text-white p-4 rounded shadow-lg pointer-events-none select-none">
        <h1 className="text-xl font-bold mb-2">Surface Fortress</h1>
        <p className="text-sm text-gray-300">{debugInfo}</p>
        <p className="text-xs text-gray-500 mt-2">
          操作指南:<br/>
          🖱️ 拖拽移动地图<br/>
          📜 滚轮缩放视角
        </p>
      </div>
    </div>
  );
}