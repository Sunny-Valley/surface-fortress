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

  // --- 游戏内部状态引用 (避免 React 闭包陷阱) ---
  const gameState = useRef({
    seed: Math.random(),
    tiles: [] as number[],
    modifiedTiles: {} as Record<number, number>, // 记录由于玩家操作改变的地块
    dwarves: [] as Dwarf[],
    tasks: [] as { index: number, type: 'MINE' | 'CHOP' }[], // 任务队列
  });

  useEffect(() => {
    let isMounted = true;
    let app: PIXI.Application | null = null;
    
    // 图层引用
    const layers = {
      terrain: new PIXI.Graphics(),
      tasks: new PIXI.Graphics(), // 显示哪里被标记了挖掘/砍伐
      dwarves: new PIXI.Graphics(),
      selection: new PIXI.Graphics(),
    };

    const initGame = async () => {
      const _app = new PIXI.Application();
      await _app.init({ resizeTo: window, backgroundColor: 0x111111, antialias: false });
      if (!isMounted) { _app.destroy(); return; }
      app = _app;
      if (mapRef.current) mapRef.current.appendChild(app.canvas);

      // --- 1. 生成/加载世界 ---
      // 这里先生成默认世界，后面可以用 Load 覆盖
      const { tiles, spawnPoint } = generateMap(gameState.current.seed);
      gameState.current.tiles = tiles;

      // 初始化矮人
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

      // 搭建舞台
      const world = new PIXI.Container();
      world.addChild(layers.terrain);
      world.addChild(layers.tasks); // 任务标记层 (比如打红叉)
      world.addChild(layers.dwarves);
      world.addChild(layers.selection);
      app.stage.addChild(world);

      // 初始视角
      world.x = app.screen.width / 2 - spawnPoint.x;
      world.y = app.screen.height / 2 - spawnPoint.y;

      // --- 辅助渲染函数 ---
      const renderTerrain = () => {
        layers.terrain.clear();
        gameState.current.tiles.forEach((baseType, i) => {
          // 如果这个格子被修改过，使用修改后的类型，否则使用原始类型
          const type = gameState.current.modifiedTiles[i] ?? baseType;
          
          const x = (i % MAP_WIDTH) * TILE_SIZE;
          const y = Math.floor(i / MAP_WIDTH) * TILE_SIZE;
          layers.terrain.rect(x, y, TILE_SIZE, TILE_SIZE);
          layers.terrain.fill(type);
        });
      };
      renderTerrain(); // 首次渲染

      // --- 2. 游戏循环 (AI逻辑) ---
      app.ticker.add(() => {
        // A. 渲染任务标记 (比如要挖的地方画个框)
        layers.tasks.clear();
        gameState.current.tasks.forEach(task => {
          const tx = (task.index % MAP_WIDTH) * TILE_SIZE;
          const ty = Math.floor(task.index / MAP_WIDTH) * TILE_SIZE;
          layers.tasks.rect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
          // 挖矿是红色框，砍树是黄色框
          layers.tasks.stroke({ width: 2, color: task.type === 'MINE' ? 0xff0000 : 0xffff00 });
        });

        // B. 矮人 AI
        layers.dwarves.clear();
        gameState.current.dwarves.forEach(dwarf => {
          // --- 逻辑部分 ---
          if (dwarf.state === 'IDLE') {
            // 没事做？找个任务！
            const task = gameState.current.tasks.find(t => true); // 简单取第一个任务
            if (task) {
              dwarf.state = 'MOVING';
              dwarf.targetIndex = task.index;
            }
          } else if (dwarf.state === 'MOVING' && dwarf.targetIndex !== undefined) {
            // 移动向目标
            const tx = (dwarf.targetIndex % MAP_WIDTH) * TILE_SIZE;
            const ty = Math.floor(dwarf.targetIndex / MAP_WIDTH) * TILE_SIZE;
            
            const dx = tx - dwarf.x;
            const dy = ty - dwarf.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < 4) {
              // 到了！开始工作
              dwarf.state = 'WORKING';
              dwarf.workTimer = 60; // 需要 60 帧 (约1秒)
            } else {
              dwarf.x += (dx / dist) * 2;
              dwarf.y += (dy / dist) * 2;
            }
          } else if (dwarf.state === 'WORKING' && dwarf.targetIndex !== undefined) {
            // 工作中
            dwarf.workTimer--;
            if (dwarf.workTimer <= 0) {
              // 工作完成！
              const index = dwarf.targetIndex;
              const taskIndex = gameState.current.tasks.findIndex(t => t.index === index);
              
              if (taskIndex !== -1) {
                const task = gameState.current.tasks[taskIndex];
                
                // 修改地形
                if (task.type === 'MINE') gameState.current.modifiedTiles[index] = TileType.FLOOR;
                if (task.type === 'CHOP') gameState.current.modifiedTiles[index] = TileType.STUMP;
                
                // 移除任务
                gameState.current.tasks.splice(taskIndex, 1);
                
                // 重绘地形
                renderTerrain();
              }
              
              dwarf.state = 'IDLE';
              dwarf.targetIndex = undefined;
            }
          }

          // --- 绘制部分 ---
          // 矮人主体
          layers.dwarves.rect(dwarf.x, dwarf.y, 24, 24);
          layers.dwarves.fill(dwarf.color);
          
          // 如果在工作，头顶显示个叹号
          if (dwarf.state === 'WORKING') {
            layers.dwarves.circle(dwarf.x + 12, dwarf.y - 5, 3);
            layers.dwarves.fill(0xffffff);
          }
        });
      });

      // --- 3. 交互逻辑 (点击下达指令) ---
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      // 简单的拖拽相机逻辑
      let isDragging = false;
      let lastPos = { x: 0, y: 0 };

      app.stage.on('pointerdown', (e) => {
        // 如果按住 CTRL 或者当前是 SELECT 模式，则是拖拽地图
        // 这里为了简单，我们规定：左键是操作，中键/右键是拖拽 (或者 Select 模式下左键拖拽)
        isDragging = true;
        lastPos = { x: e.global.x, y: e.global.y };

        // --- 核心：点击地图下达指令 ---
        if (tool !== 'SELECT') {
           const worldPos = world.toLocal(e.global);
           const gx = Math.floor(worldPos.x / TILE_SIZE);
           const gy = Math.floor(worldPos.y / TILE_SIZE);
           const index = gy * MAP_WIDTH + gx;

           if (gx >= 0 && gx < MAP_WIDTH && gy >= 0 && gy < MAP_HEIGHT) {
             // 检查当前地形类型
             const currentType = gameState.current.modifiedTiles[index] ?? gameState.current.tiles[index];

             if (tool === 'MINE' && currentType === TileType.MOUNTAIN) {
               gameState.current.tasks.push({ index, type: 'MINE' });
             } else if (tool === 'CHOP' && currentType === TileType.FOREST) {
               gameState.current.tasks.push({ index, type: 'CHOP' });
             }
           }
           isDragging = false; // 如果是点击操作，就不要触发拖拽
        }
      });

      app.stage.on('pointermove', (e) => {
        if (isDragging) {
          world.x += e.global.x - lastPos.x;
          world.y += e.global.y - lastPos.y;
          lastPos = { x: e.global.x, y: e.global.y };
        }
        
        // 鼠标高亮
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
    return () => { isMounted = false; if (app) app.destroy({ removeView: true }, { children: true }); };
  }, [tool]); // 当 tool 变化时，useEffect 其实不需要重跑，这里利用 ref 规避了重置

  // --- 存档功能 ---
  const handleSave = async () => {
    setIsSaving(true);
    setInfo("正在云端存档...");
    
    const dataToSave: SaveData = {
      seed: gameState.current.seed,
      dwarves: gameState.current.dwarves,
      modifiedTiles: gameState.current.modifiedTiles
    };
    
    // 压缩数据
    const jsonStr = JSON.stringify(dataToSave);
    const compressed = LZString.compressToUTF16(jsonStr);
    
    const res = await saveGameAction(1, compressed);
    if (res.success) setInfo("存档成功！");
    else setInfo("存档失败: " + res.error);
    
    setIsSaving(false);
  };

  const handleLoad = async () => {
    setInfo("正在读取云端数据...");
    const compressed = await loadGameAction(1);
    if (compressed) {
      const jsonStr = LZString.decompressFromUTF16(compressed);
      const data: SaveData = JSON.parse(jsonStr);
      
      // 简单粗暴：刷新页面让 useEffect 重新用新数据初始化 (实际项目应该用更优雅的状态更新)
      // 但为了演示，我们至少证明读到了数据
      alert(`读取成功！种子: ${data.seed}。请刷新页面查看效果(暂未做热重载)`);
    } else {
      setInfo("未找到存档");
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <div ref={mapRef} className="w-full h-full" />
      
      {/* UI 工具栏 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-gray-900/90 p-2 rounded-xl flex gap-2 border border-gray-700 shadow-2xl">
        <button 
          onClick={() => setTool('SELECT')}
          className={`px-4 py-2 rounded font-bold ${tool === 'SELECT' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
        >
          ✋ 移动/观察
        </button>
        <button 
          onClick={() => setTool('MINE')}
          className={`px-4 py-2 rounded font-bold ${tool === 'MINE' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'}`}
        >
          ⛏️ 挖掘岩石
        </button>
        <button 
          onClick={() => setTool('CHOP')}
          className={`px-4 py-2 rounded font-bold ${tool === 'CHOP' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'}`}
        >
          🪓 砍伐树木
        </button>
      </div>

      {/* 顶部状态栏 */}
      <div className="absolute top-4 right-4 flex gap-2">
        <div className="bg-black/60 text-white px-4 py-2 rounded backdrop-blur">
          {info}
        </div>
        <button onClick={handleSave} disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded font-bold transition">
          💾 保存
        </button>
        <button onClick={handleLoad} className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded font-bold transition">
          📂 读取
        </button>
      </div>
    </div>
  );
}