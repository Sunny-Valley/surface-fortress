'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import LZString from 'lz-string';
import { generateMap, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TileType, Dwarf } from '../utils/mapGen';
import { saveGameAction, loadGameAction, SaveData } from './actions';

export default function GameMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  
  // UI 状态
  const [info, setInfo] = useState("✅ 系统就绪：矮人正在待命 (请下达指令)");
  const [tool, setTool] = useState<'SELECT' | 'MINE' | 'CHOP'>('SELECT');
  const [isSaving, setIsSaving] = useState(false);

  // 游戏核心数据
  const gameState = useRef({
    seed: Math.random(),
    tiles: [] as number[],
    modifiedTiles: {} as Record<number, number>,
    dwarves: [] as Dwarf[],
    tasks: [] as { id: number, index: number, type: 'MINE' | 'CHOP' }[], // 给任务加个ID
  });

  useEffect(() => {
    let isMounted = true;
    let app: PIXI.Application | null = null;
    
    // 图层
    const layers = {
      terrain: new PIXI.Graphics(),
      tasks: new PIXI.Graphics(),
      dwarves: new PIXI.Graphics(),
      selection: new PIXI.Graphics(),
    };

    const initGame = async () => {
      const _app = new PIXI.Application();
      await _app.init({ resizeTo: window, backgroundColor: 0x111111, antialias: false });
      
      if (!isMounted) { _app.destroy(); return; }
      app = _app;
      if (mapRef.current) mapRef.current.appendChild(app.canvas);

      // 1. 初始化地图
      const { tiles, spawnPoint } = generateMap(gameState.current.seed);
      gameState.current.tiles = tiles;

      // 2. 初始化矮人 (如果列表为空才生成)
      if (gameState.current.dwarves.length === 0) {
        for (let i = 0; i < 5; i++) { // 生成 5 个矮人
          gameState.current.dwarves.push({
            id: i,
            x: spawnPoint.x + Math.random() * 64,
            y: spawnPoint.y + Math.random() * 64,
            color: 0xe74c3c,
            state: 'IDLE',
            workTimer: 0
          });
        }
      }

      // 3. 组装场景
      const world = new PIXI.Container();
      world.addChild(layers.terrain);
      world.addChild(layers.tasks);
      world.addChild(layers.dwarves);
      world.addChild(layers.selection);
      app.stage.addChild(world);

      // 初始视角居中
      world.x = app.screen.width / 2 - spawnPoint.x;
      world.y = app.screen.height / 2 - spawnPoint.y;

      // 地形绘制函数
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

      // --- 4. 核心 AI 循环 (每一帧都在跑) ---
      app.ticker.add(() => {
        // A. 绘制任务标记
        layers.tasks.clear();
        gameState.current.tasks.forEach(task => {
          const tx = (task.index % MAP_WIDTH) * TILE_SIZE;
          const ty = Math.floor(task.index / MAP_WIDTH) * TILE_SIZE;
          layers.tasks.rect(tx + 8, ty + 8, TILE_SIZE - 16, TILE_SIZE - 16);
          layers.tasks.stroke({ width: 3, color: task.type === 'MINE' ? 0xff0000 : 0xffff00 });
        });

        // B. 矮人思考与行动
        layers.dwarves.clear();
        
        gameState.current.dwarves.forEach(dwarf => {
          // --- 状态机逻辑 ---
          
          // 状态 1: 无所事事 (IDLE)
          if (dwarf.state === 'IDLE') {
            // 优先检查有没有工作
            const task = gameState.current.tasks[0]; 
            if (task) {
              // 有工作！去干活
              dwarf.state = 'MOVING';
              dwarf.targetIndex = task.index; // 记录工作地点
            } else {
              // 没工作？那就闲逛 (Wander)
              // 1% 的概率决定换个地方发呆，避免抽搐
              if (Math.random() < 0.01) {
                // 随机找一个附近的点
                const wanderX = dwarf.x + (Math.random() * 100 - 50);
                const wanderY = dwarf.y + (Math.random() * 100 - 50);
                // 简单的平滑移动目标 (借用 targetIndex 机制，但不设为整数索引，而是临时坐标)
                // 这里为了简化，直接瞬移一点点模拟走路，或者我们加一个专门的 WANDER 状态
                // 简单起见：直接修改坐标模拟走路
                dwarf.x += (Math.random() - 0.5) * 2;
                dwarf.y += (Math.random() - 0.5) * 2;
              }
            }
          } 
          
          // 状态 2: 赶路中 (MOVING)
          else if (dwarf.state === 'MOVING' && dwarf.targetIndex !== undefined) {
            const tx = (dwarf.targetIndex % MAP_WIDTH) * TILE_SIZE;
            const ty = Math.floor(dwarf.targetIndex / MAP_WIDTH) * TILE_SIZE;
            
            const dx = tx - dwarf.x;
            const dy = ty - dwarf.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < 4) {
              // 到达目的地
              dwarf.state = 'WORKING';
              dwarf.workTimer = 60; // 干活需要 60 帧
            } else {
              // 移动
              dwarf.x += (dx / dist) * 2.5;
              dwarf.y += (dy / dist) * 2.5;
            }
          } 
          
          // 状态 3: 干活中 (WORKING)
          else if (dwarf.state === 'WORKING' && dwarf.targetIndex !== undefined) {
            dwarf.workTimer--;
            
            // 摇晃效果 (模拟在敲打)
            dwarf.x += (Math.random() - 0.5) * 2;

            if (dwarf.workTimer <= 0) {
              // 完工！
              const idx = dwarf.targetIndex;
              // 找到对应的任务并删除
              const taskIdx = gameState.current.tasks.findIndex(t => t.index === idx);
              if (taskIdx !== -1) {
                const task = gameState.current.tasks[taskIdx];
                // 修改地形
                if (task.type === 'MINE') gameState.current.modifiedTiles[idx] = TileType.FLOOR;
                if (task.type === 'CHOP') gameState.current.modifiedTiles[idx] = TileType.STUMP;
                
                gameState.current.tasks.splice(taskIdx, 1);
                renderTerrain(); // 刷新地图显示
              }
              dwarf.state = 'IDLE'; // 回家休息
            }
          }

          // --- 绘制矮人 ---
          layers.dwarves.rect(dwarf.x, dwarf.y, 20, 20);
          layers.dwarves.fill(dwarf.color);
          
          // 如果在干活，头顶画个白色感叹号
          if (dwarf.state === 'WORKING') {
            layers.dwarves.circle(dwarf.x + 10, dwarf.y - 8, 4);
            layers.dwarves.fill(0xffffff);
          }
        });
      });

      // --- 5. 交互事件 ---
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      let isDragging = false;
      let lastPos = { x: 0, y: 0 };

      app.stage.on('pointerdown', (e) => {
        isDragging = true;
        lastPos = { x: e.global.x, y: e.global.y };

        if (tool !== 'SELECT') {
           const worldPos = world.toLocal(e.global);
           const gx = Math.floor(worldPos.x / TILE_SIZE);
           const gy = Math.floor(worldPos.y / TILE_SIZE);
           const index = gy * MAP_WIDTH + gx;

           if (gx >= 0 && gx < MAP_WIDTH && gy >= 0 && gy < MAP_HEIGHT) {
             const currentType = gameState.current.modifiedTiles[index] ?? gameState.current.tiles[index];
             
             // 防止重复添加任务
             const existingTask = gameState.current.tasks.find(t => t.index === index);
             if (!existingTask) {
                if (tool === 'MINE' && currentType === TileType.MOUNTAIN) {
                  gameState.current.tasks.push({ id: Date.now(), index, type: 'MINE' });
                  setInfo(`⛏️ 已发布挖掘任务 [${gx},${gy}]`);
                } else if (tool === 'CHOP' && currentType === TileType.FOREST) {
                  gameState.current.tasks.push({ id: Date.now(), index, type: 'CHOP' });
                  setInfo(`🪓 已发布砍树任务 [${gx},${gy}]`);
                }
             }
           }
           isDragging = false; // 点击操作不触发拖拽
        }
      });

      app.stage.on('pointermove', (e) => {
        if (isDragging && tool === 'SELECT') {
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
  }, [tool]); 

  // --- 存档功能 ---
  const handleSave = async () => {
    setIsSaving(true);
    setInfo("⏳ 正在上传存档...");
    const data: SaveData = {
      seed: gameState.current.seed,
      dwarves: gameState.current.dwarves,
      modifiedTiles: gameState.current.modifiedTiles
    };
    const compressed = LZString.compressToUTF16(JSON.stringify(data));
    const res = await saveGameAction(1, compressed);
    setInfo(res.success ? "💾 存档成功！" : "❌ 存档失败");
    setIsSaving(false);
  };

  const handleLoad = async () => {
    setInfo("⏳ 正在下载存档...");
    const compressed = await loadGameAction(1);
    if (compressed) {
      const data: SaveData = JSON.parse(LZString.decompressFromUTF16(compressed));
      alert(`读取成功！即将刷新世界...`);
      window.location.reload(); // 简单粗暴刷新
    } else {
      setInfo("⚠️ 未找到存档");
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <div ref={mapRef} className="w-full h-full" />
      
      {/* 底部工具栏 */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-gray-900/90 p-3 rounded-2xl flex gap-4 border border-gray-700 shadow-2xl backdrop-blur-md">
        <button onClick={() => setTool('SELECT')} className={`px-6 py-3 rounded-xl font-bold transition ${tool==='SELECT'?'bg-blue-600 scale-105':'bg-gray-800 text-gray-400'}`}>
          ✋ 观察
        </button>
        <button onClick={() => setTool('MINE')} className={`px-6 py-3 rounded-xl font-bold transition ${tool==='MINE'?'bg-red-600 scale-105':'bg-gray-800 text-gray-400'}`}>
          ⛏️ 挖掘
        </button>
        <button onClick={() => setTool('CHOP')} className={`px-6 py-3 rounded-xl font-bold transition ${tool==='CHOP'?'bg-green-600 scale-105':'bg-gray-800 text-gray-400'}`}>
          🪓 砍树
        </button>
      </div>

      {/* 顶部状态栏 */}
      <div className="absolute top-6 left-6 right-6 flex justify-between items-start pointer-events-none">
        <div className="bg-black/70 text-white px-5 py-3 rounded-xl backdrop-blur-md border border-white/10 shadow-lg">
          <p className="font-mono text-sm">{info}</p>
        </div>
        <div className="flex gap-3 pointer-events-auto">
          <button onClick={handleSave} disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-lg font-bold shadow-lg transition">
            {isSaving ? '...' : '💾 保存'}
          </button>
          <button onClick={handleLoad} className="bg-gray-700 hover:bg-gray-600 text-white px-5 py-2 rounded-lg font-bold shadow-lg transition">
            📂 读取
          </button>
        </div>
      </div>
    </div>
  );
}