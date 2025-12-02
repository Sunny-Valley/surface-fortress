'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import LZString from 'lz-string';
import { generateMap, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TileType, Dwarf } from '../utils/mapGen';
import { saveGameAction, loadGameAction, SaveData } from './actions';

export default function GameMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  
  // --- UI 状态 ---
  const [info, setInfo] = useState("欢迎来到地表要塞");
  const [tool, setTool] = useState<'SELECT' | 'MINE' | 'CHOP'>('SELECT');
  const [isSaving, setIsSaving] = useState(false);

  // --- 游戏数据引用 (使用 ref 避免闭包问题) ---
  const gameState = useRef({
    seed: Math.random(),
    tiles: [] as number[],
    modifiedTiles: {} as Record<number, number>,
    dwarves: [] as Dwarf[],
    tasks: [] as { index: number, type: 'MINE' | 'CHOP' }[],
  });

  useEffect(() => {
    let isMounted = true;
    let app: PIXI.Application | null = null;
    
    // 图层管理
    const layers = {
      terrain: new PIXI.Graphics(),
      tasks: new PIXI.Graphics(),
      dwarves: new PIXI.Graphics(),
      selection: new PIXI.Graphics(),
    };

    const initGame = async () => {
      // 1. 初始化 Pixi v8
      const _app = new PIXI.Application();
      await _app.init({ resizeTo: window, backgroundColor: 0x111111, antialias: false });
      
      if (!isMounted) { _app.destroy(); return; }
      app = _app;
      if (mapRef.current) mapRef.current.appendChild(app.canvas);

      // 生成初始世界
      const { tiles, spawnPoint } = generateMap(gameState.current.seed);
      gameState.current.tiles = tiles;

      // 初始化3个矮人
      for (let i = 0; i < 3; i++) {
        gameState.current.dwarves.push({
          id: i,
          x: spawnPoint.x + Math.random() * 50,
          y: spawnPoint.y + Math.random() * 50,
          color: 0xe74c3c,
          state: 'IDLE',
          workTimer: 0
        });
      }

      // 组装舞台
      const world = new PIXI.Container();
      world.addChild(layers.terrain);
      world.addChild(layers.tasks);
      world.addChild(layers.dwarves);
      world.addChild(layers.selection);
      app.stage.addChild(world);

      // 居中视角
      world.x = app.screen.width / 2 - spawnPoint.x;
      world.y = app.screen.height / 2 - spawnPoint.y;

      // --- 渲染地形函数 ---
      const renderTerrain = () => {
        layers.terrain.clear();
        gameState.current.tiles.forEach((baseType, i) => {
          const type = gameState.current.modifiedTiles[i] ?? baseType;
          const x = (i % MAP_WIDTH) * TILE_SIZE;
          const y = Math.floor(i / MAP_WIDTH) * TILE_SIZE;
          layers.terrain.rect(x, y, TILE_SIZE, TILE_SIZE);
          layers.terrain.fill(type);
        });
      };
      renderTerrain();

      // --- 2. 游戏主循环 (AI & 动画) ---
      app.ticker.add(() => {
        // A. 绘制任务标记
        layers.tasks.clear();
        gameState.current.tasks.forEach(task => {
          const tx = (task.index % MAP_WIDTH) * TILE_SIZE;
          const ty = Math.floor(task.index / MAP_WIDTH) * TILE_SIZE;
          layers.tasks.rect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
          // 挖掘=红框，砍树=黄框
          layers.tasks.stroke({ width: 2, color: task.type === 'MINE' ? 0xff0000 : 0xffff00 });
        });

        // B. 矮人 AI 逻辑
        layers.dwarves.clear();
        gameState.current.dwarves.forEach(dwarf => {
          // AI: 找工作
          if (dwarf.state === 'IDLE') {
            const task = gameState.current.tasks[0]; // 简单取第一个任务
            if (task) {
              dwarf.state = 'MOVING';
              dwarf.targetIndex = task.index;
            }
          } 
          // AI: 移动
          else if (dwarf.state === 'MOVING' && dwarf.targetIndex !== undefined) {
            const tx = (dwarf.targetIndex % MAP_WIDTH) * TILE_SIZE;
            const ty = Math.floor(dwarf.targetIndex / MAP_WIDTH) * TILE_SIZE;
            const dx = tx - dwarf.x;
            const dy = ty - dwarf.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < 4) {
              dwarf.state = 'WORKING';
              dwarf.workTimer = 60; // 工作需60帧
            } else {
              dwarf.x += (dx / dist) * 3; // 移动速度
              dwarf.y += (dy / dist) * 3;
            }
          } 
          // AI: 工作
          else if (dwarf.state === 'WORKING' && dwarf.targetIndex !== undefined) {
            dwarf.workTimer--;
            if (dwarf.workTimer <= 0) {
              // 任务完成！修改地形
              const idx = dwarf.targetIndex;
              const taskIdx = gameState.current.tasks.findIndex(t => t.index === idx);
              
              if (taskIdx !== -1) {
                const task = gameState.current.tasks[taskIdx];
                if (task.type === 'MINE') gameState.current.modifiedTiles[idx] = TileType.FLOOR;
                if (task.type === 'CHOP') gameState.current.modifiedTiles[idx] = TileType.STUMP;
                
                gameState.current.tasks.splice(taskIdx, 1); // 移除任务
                renderTerrain(); // 重绘地图
              }
              dwarf.state = 'IDLE'; // 变回空闲
            }
          }

          // 绘制矮人
          layers.dwarves.rect(dwarf.x, dwarf.y, 20, 20);
          layers.dwarves.fill(dwarf.color);
          // 工作时头顶有个点
          if (dwarf.state === 'WORKING') {
            layers.dwarves.circle(dwarf.x + 10, dwarf.y - 5, 3);
            layers.dwarves.fill(0xffffff);
          }
        });
      });

      // --- 3. 交互逻辑 (点击) ---
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      let isDragging = false;
      let lastPos = { x: 0, y: 0 };

      app.stage.on('pointerdown', (e) => {
        isDragging = true;
        lastPos = { x: e.global.x, y: e.global.y };

        // 点击下达指令
        if (tool !== 'SELECT') {
           const worldPos = world.toLocal(e.global);
           const gx = Math.floor(worldPos.x / TILE_SIZE);
           const gy = Math.floor(worldPos.y / TILE_SIZE);
           const index = gy * MAP_WIDTH + gx;

           if (gx >= 0 && gx < MAP_WIDTH && gy >= 0 && gy < MAP_HEIGHT) {
             const currentType = gameState.current.modifiedTiles[index] ?? gameState.current.tiles[index];
             
             // 只有对着山才能挖，对着树才能砍
             if (tool === 'MINE' && currentType === TileType.MOUNTAIN) {
               gameState.current.tasks.push({ index, type: 'MINE' });
             } else if (tool === 'CHOP' && currentType === TileType.FOREST) {
               gameState.current.tasks.push({ index, type: 'CHOP' });
             }
           }
           isDragging = false; // 如果是下指令，就不拖拽
        }
      });

      app.stage.on('pointermove', (e) => {
        if (isDragging && tool === 'SELECT') {
          world.x += e.global.x - lastPos.x;
          world.y += e.global.y - lastPos.y;
          lastPos = { x: e.global.x, y: e.global.y };
        }
        
        // 鼠标高亮框
        const worldPos = world.toLocal(e.global);
        const gx = Math.floor(worldPos.x / TILE_SIZE);
        const gy = Math.floor(worldPos.y / TILE_SIZE);
        
        layers.selection.clear();
        layers.selection.rect(gx * TILE_SIZE, gy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        layers.selection.stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
      });

      app.stage.on('pointerup', () => isDragging = false);
    };

    initGame();

    return () => {
      isMounted = false;
      if (app) app.destroy({ removeView: true }, { children: true });
    };
  }, [tool]); 

  // --- 按钮逻辑 ---
  const handleSave = async () => {
    setIsSaving(true);
    setInfo("正在保存...");
    const data: SaveData = {
      seed: gameState.current.seed,
      dwarves: gameState.current.dwarves,
      modifiedTiles: gameState.current.modifiedTiles
    };
    // 压缩数据
    const compressed = LZString.compressToUTF16(JSON.stringify(data));
    const res = await saveGameAction(1, compressed);
    setInfo(res.success ? "存档成功！" : "存档失败");
    setIsSaving(false);
  };

  const handleLoad = async () => {
    setInfo("正在读取...");
    const compressed = await loadGameAction(1);
    if (compressed) {
      const data: SaveData = JSON.parse(LZString.decompressFromUTF16(compressed));
      alert(`读取成功！种子: ${data.seed}。请刷新页面查看变化。`);
    } else {
      setInfo("没有找到存档");
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <div ref={mapRef} className="w-full h-full" />
      
      {/* 底部工具栏 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-gray-900/90 p-2 rounded-xl flex gap-4 border border-gray-700 shadow-2xl">
        <button onClick={() => setTool('SELECT')} className={`px-4 py-2 rounded font-bold ${tool==='SELECT'?'bg-blue-600':'bg-gray-700'}`}>
          ✋ 移动视角
        </button>
        <button onClick={() => setTool('MINE')} className={`px-4 py-2 rounded font-bold ${tool==='MINE'?'bg-red-600':'bg-gray-700'}`}>
          ⛏️ 挖掘 (点山)
        </button>
        <button onClick={() => setTool('CHOP')} className={`px-4 py-2 rounded font-bold ${tool==='CHOP'?'bg-green-600':'bg-gray-700'}`}>
          🪓 砍树 (点树)
        </button>
      </div>

      {/* 顶部信息栏 */}
      <div className="absolute top-4 right-4 flex gap-2 text-white">
        <div className="bg-black/60 px-4 py-2 rounded">{info}</div>
        <button onClick={handleSave} disabled={isSaving} className="bg-indigo-600 px-4 py-2 rounded hover:bg-indigo-500">💾 保存</button>
        <button onClick={handleLoad} className="bg-gray-600 px-4 py-2 rounded hover:bg-gray-500">📂 读取</button>
      </div>
    </div>
  );
}