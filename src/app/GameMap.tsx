'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import LZString from 'lz-string';
import { generateMap, getRandomName, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, TileType, Dwarf } from '../utils/mapGen';
import { saveGameAction, loadGameAction, SaveData } from './actions';

type ToolType = 'SELECT' | 'MINE' | 'CHOP' | 'BUILD_WALL_WOOD' | 'BUILD_WALL_STONE';

export default function GameMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  
  // UI 状态
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null); // 新增：错误显示
  const [tool, setTool] = useState<ToolType>('SELECT');
  const [resources, setResources] = useState({ wood: 0, stone: 0, food: 10 });
  const [inspector, setInspector] = useState<{title: string, desc: string} | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // 游戏核心数据
  const gameState = useRef({
    seed: Math.random(),
    tiles: [] as number[],
    modifiedTiles: {} as Record<number, number>,
    dwarves: [] as Dwarf[],
    tasks: [] as { id: number, index: number, type: ToolType }[],
    resourceRef: { wood: 0, stone: 0, food: 10 }
  });

  const showNotify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  useEffect(() => {
    let isMounted = true;
    let app: PIXI.Application | null = null;
    
    const initGame = async () => {
      try {
        console.log("正在初始化游戏引擎...");
        const _app = new PIXI.Application();
        await _app.init({ resizeTo: window, backgroundColor: 0x0f172a, antialias: false });
        
        if (!isMounted) { _app.destroy(); return; }
        app = _app;
        if (mapRef.current) mapRef.current.appendChild(app.canvas);

        // 1. 生成地图
        console.log("正在生成地形...");
        const { tiles, spawnPoint } = generateMap(gameState.current.seed);
        gameState.current.tiles = tiles;

        // 2. 生成矮人 (注意：这里会调用 mapGen 中的 getRandomName)
        if (gameState.current.dwarves.length === 0) {
          console.log("正在生成矮人...");
          for (let i = 0; i < 7; i++) {
            gameState.current.dwarves.push({
              id: i,
              // 安全检查：如果 getRandomName 没定义，用默认名字
              name: typeof getRandomName === 'function' ? getRandomName() : `Dwarf ${i}`,
              x: spawnPoint.x + Math.random() * 100 - 50,
              y: spawnPoint.y + Math.random() * 100 - 50,
              color: 0xe74c3c,
              state: 'IDLE',
              workTimer: 0,
              energy: 100
            });
          }
        }
        setResources({...gameState.current.resourceRef});

        // 3. 组装图层
        const world = new PIXI.Container();
        const layers = {
          terrain: new PIXI.Graphics(),
          tasks: new PIXI.Graphics(),
          dwarves: new PIXI.Graphics(),
          selection: new PIXI.Graphics(),
        };
        world.addChild(layers.terrain);
        world.addChild(layers.tasks);
        world.addChild(layers.dwarves);
        world.addChild(layers.selection);
        app.stage.addChild(world);

        world.x = app.screen.width / 2 - spawnPoint.x;
        world.y = app.screen.height / 2 - spawnPoint.y;
        
        // 渲染地形
        const renderTerrain = () => {
          layers.terrain.clear();
          gameState.current.tiles.forEach((baseType, i) => {
            const type = gameState.current.modifiedTiles[i] ?? baseType;
            const x = (i % MAP_WIDTH) * TILE_SIZE;
            const y = Math.floor(i / MAP_WIDTH) * TILE_SIZE;
            layers.terrain.rect(x, y, TILE_SIZE, TILE_SIZE);
            layers.terrain.fill(type);
            // 阴影细节
            if (type === TileType.WALL_STONE || type === TileType.WALL_WOOD) {
              layers.terrain.rect(x, y + TILE_SIZE - 4, TILE_SIZE, 4);
              layers.terrain.fill({ color: 0x000000, alpha: 0.3 });
            }
          });
        };
        renderTerrain();

        // 4. 游戏循环
        app.ticker.add(() => {
          // A. 绘制蓝图
          layers.tasks.clear();
          gameState.current.tasks.forEach(task => {
            const tx = (task.index % MAP_WIDTH) * TILE_SIZE;
            const ty = Math.floor(task.index / MAP_WIDTH) * TILE_SIZE;
            layers.tasks.rect(tx, ty, TILE_SIZE, TILE_SIZE);
            if (task.type === 'MINE') layers.tasks.stroke({ width: 2, color: 0xff0000 });
            else if (task.type === 'CHOP') layers.tasks.stroke({ width: 2, color: 0xffff00 });
            else layers.tasks.fill({ color: 0x3498db, alpha: 0.5 });
          });

          // B. 矮人 AI
          layers.dwarves.clear();
          const dwarves = gameState.current.dwarves;
          
          // 防重叠
          dwarves.forEach((d, i) => {
            dwarves.forEach((other, j) => {
               if (i===j) return;
               const dx = d.x - other.x;
               const dy = d.y - other.y;
               const dist = Math.sqrt(dx*dx + dy*dy);
               if (dist < 16 && dist > 0) {
                 d.x += (dx/dist) * 0.5;
                 d.y += (dy/dist) * 0.5;
               }
            });
          });

          // AI 逻辑
          dwarves.forEach(dwarf => {
            if (dwarf.state === 'IDLE') {
              const task = gameState.current.tasks[0];
              if (task) {
                dwarf.targetIndex = task.index;
                dwarf.state = 'MOVING';
              } else {
                 if (Math.random() < 0.01) {
                   dwarf.x += (Math.random() - 0.5) * 10;
                   dwarf.y += (Math.random() - 0.5) * 10;
                 }
              }
            } 
            else if (dwarf.state === 'MOVING' && dwarf.targetIndex !== undefined) {
               const tx = (dwarf.targetIndex % MAP_WIDTH) * TILE_SIZE + 16;
               const ty = Math.floor(dwarf.targetIndex / MAP_WIDTH) * TILE_SIZE + 16;
               const dx = tx - dwarf.x;
               const dy = ty - dwarf.y;
               const dist = Math.sqrt(dx*dx + dy*dy);

               if (dist < 4) {
                 dwarf.state = 'WORKING';
                 dwarf.workTimer = 60;
               } else {
                 dwarf.x += (dx/dist) * 2;
                 dwarf.y += (dy/dist) * 2;
               }
            }
            else if (dwarf.state === 'WORKING' && dwarf.targetIndex !== undefined) {
               dwarf.workTimer--;
               dwarf.x += (Math.random() - 0.5); 
               
               if (dwarf.workTimer <= 0) {
                 const idx = dwarf.targetIndex;
                 const taskIdx = gameState.current.tasks.findIndex(t => t.index === idx);
                 if (taskIdx !== -1) {
                   const task = gameState.current.tasks[taskIdx];
                   if (task.type === 'MINE') {
                      gameState.current.modifiedTiles[idx] = TileType.FLOOR_STONE;
                      gameState.current.resourceRef.stone += 1;
                   } else if (task.type === 'CHOP') {
                      gameState.current.modifiedTiles[idx] = TileType.STUMP;
                      gameState.current.resourceRef.wood += 5;
                   } else if (task.type === 'BUILD_WALL_WOOD') {
                      gameState.current.modifiedTiles[idx] = TileType.WALL_WOOD;
                   } else if (task.type === 'BUILD_WALL_STONE') {
                      gameState.current.modifiedTiles[idx] = TileType.WALL_STONE;
                   }
                   setResources({...gameState.current.resourceRef});
                   gameState.current.tasks.splice(taskIdx, 1);
                   renderTerrain();
                 }
                 dwarf.state = 'IDLE';
               }
            }
            // 绘制
            layers.dwarves.rect(dwarf.x - 6, dwarf.y - 10, 12, 14);
            layers.dwarves.fill(dwarf.color);
            layers.dwarves.rect(dwarf.x - 6, dwarf.y - 18, 12, 8);
            layers.dwarves.fill(0xffccaa); 
            layers.dwarves.rect(dwarf.x - 6, dwarf.y - 12, 12, 6);
            layers.dwarves.fill(0xbdc3c7);
          });
        });

        // 5. 交互事件
        app.stage.eventMode = 'static';
        app.stage.hitArea = app.screen;
        let isDragging = false;
        let lastPos = { x: 0, y: 0 };

        app.stage.on('pointerdown', (e) => {
          if (e.button === 1 || tool === 'SELECT') {
            isDragging = true;
            lastPos = { x: e.global.x, y: e.global.y };
          } else {
             const worldPos = world.toLocal(e.global);
             const gx = Math.floor(worldPos.x / TILE_SIZE);
             const gy = Math.floor(worldPos.y / TILE_SIZE);
             const index = gy * MAP_WIDTH + gx;

             if (gx >= 0 && gx < MAP_WIDTH && gy >= 0 && gy < MAP_HEIGHT) {
               const currentType = gameState.current.modifiedTiles[index] ?? gameState.current.tiles[index];
               const existing = gameState.current.tasks.find(t => t.index === index);
               
               if (!existing) {
                 if (tool === 'MINE' && currentType === TileType.MOUNTAIN) {
                   gameState.current.tasks.push({ id: Date.now(), index, type: 'MINE' });
                 } else if (tool === 'CHOP' && currentType === TileType.FOREST) {
                   gameState.current.tasks.push({ id: Date.now(), index, type: 'CHOP' });
                 } else if (tool === 'BUILD_WALL_WOOD') {
                   if (gameState.current.resourceRef.wood >= 2) {
                      gameState.current.resourceRef.wood -= 2;
                      gameState.current.tasks.push({ id: Date.now(), index, type: 'BUILD_WALL_WOOD' });
                      setResources({...gameState.current.resourceRef});
                   } else {
                      showNotify("❌ 木材不足! 需要 2 个木头");
                   }
                 } else if (tool === 'BUILD_WALL_STONE') {
                   if (gameState.current.resourceRef.stone >= 2) {
                      gameState.current.resourceRef.stone -= 2;
                      gameState.current.tasks.push({ id: Date.now(), index, type: 'BUILD_WALL_STONE' });
                      setResources({...gameState.current.resourceRef});
                   } else {
                      showNotify("❌ 石材不足! 需要 2 个石头");
                   }
                 }
               }
             }
          }
        });

        app.stage.on('pointermove', (e) => {
          if (isDragging) {
            world.x += e.global.x - lastPos.x;
            world.y += e.global.y - lastPos.y;
            lastPos = { x: e.global.x, y: e.global.y };
          }
          const worldPos = world.toLocal(e.global);
          const gx = Math.floor(worldPos.x / TILE_SIZE);
          const gy = Math.floor(worldPos.y / TILE_SIZE);
          layers.selection.clear();
          layers.selection.rect(gx * TILE_SIZE, gy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          layers.selection.stroke({ width: 2, color: 0xffffff, alpha: 0.5 });

          if (gx >= 0 && gx < MAP_WIDTH && gy >= 0 && gy < MAP_HEIGHT) {
             const index = gy * MAP_WIDTH + gx;
             const type = gameState.current.modifiedTiles[index] ?? gameState.current.tiles[index];
             const dwarfHere = gameState.current.dwarves.find(d => Math.abs(d.x - (gx*TILE_SIZE+16)) < 16 && Math.abs(d.y - (gy*TILE_SIZE+16)) < 16);
             let title = "荒野", desc = `[${gx}, ${gy}]`;
             if (dwarfHere) { title = `矮人: ${dwarfHere.name}`; desc = `状态: ${dwarfHere.state}`; }
             else {
               if (type === TileType.MOUNTAIN) title = "岩石山脉";
               else if (type === TileType.FOREST) title = "森林";
               else if (type === TileType.WATER) title = "河流";
               else if (type === TileType.GRASS) title = "草地";
               else if (type === TileType.WALL_WOOD) title = "木墙";
               else if (type === TileType.WALL_STONE) title = "石墙";
             }
             setInspector({ title, desc });
          } else { setInspector(null); }
        });

        app.stage.on('pointerup', () => isDragging = false);
        const canvas = app.canvas as HTMLCanvasElement;
        canvas.addEventListener('wheel', (e) => {
          e.preventDefault();
          const scaleBy = 1.1;
          const oldScale = world.scale.x;
          const newScale = e.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
          if (newScale > 0.3 && newScale < 4) {
            const mouseX = e.clientX;
            const mouseY = e.clientY;
            const worldPos = world.toLocal({x: mouseX, y: mouseY});
            world.scale.set(newScale);
            const newScreenPos = world.toGlobal(worldPos);
            world.x -= newScreenPos.x - mouseX;
            world.y -= newScreenPos.y - mouseY;
          }
        }, { passive: false });
        
        // 只有在一切成功后，才移除 Loading
        setLoading(false);

      } catch (err: any) {
        console.error("游戏启动失败:", err);
        setErrorMsg(err.message || "未知错误");
      }
    };

    initGame();
    return () => { isMounted = false; if (app) app.destroy({ removeView: true }, { children: true }); };
  }, []);

  // 存档功能
  const handleSave = async () => {
    const data: SaveData = {
      seed: gameState.current.seed,
      resources: gameState.current.resourceRef,
      dwarves: gameState.current.dwarves,
      modifiedTiles: gameState.current.modifiedTiles,
      tasks: gameState.current.tasks
    };
    const compressed = LZString.compressToUTF16(JSON.stringify(data));
    const res = await saveGameAction(1, compressed);
    showNotify(res.success ? "✅ 保存成功" : "❌ 保存失败");
  };

  const handleLoad = async () => {
    const compressed = await loadGameAction(1);
    if (compressed) { alert("读取成功，刷新世界..."); window.location.reload(); }
    else showNotify("⚠️ 无存档");
  };

  // 错误界面渲染
  if (errorMsg) return (
    <div className="w-screen h-screen bg-red-950 flex flex-col items-center justify-center text-white p-10">
      <h1 className="text-2xl font-bold mb-4">💥 游戏崩溃了</h1>
      <p className="font-mono bg-black p-4 rounded text-red-300">{errorMsg}</p>
      <p className="mt-4 text-gray-300">请检查 src/utils/mapGen.ts 是否已更新。</p>
    </div>
  );

  // 加载界面渲染 (强制白色文字)
  if (loading) return (
    <div className="w-screen h-screen bg-slate-900 flex items-center justify-center text-white z-50">
      <div className="text-2xl font-bold animate-pulse">正在生成地表世界...</div>
    </div>
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 text-slate-200 font-sans select-none">
      <div ref={mapRef} className="w-full h-full" />
      
      {/* 资源栏 */}
      <div className="absolute top-4 left-4 bg-slate-900/60 backdrop-blur-md border border-slate-700 rounded-lg p-3 flex gap-6 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="text-xl">🪵</span>
          <div className="flex flex-col"><span className="text-xs text-slate-400 font-bold">Wood</span><span className="font-mono text-lg font-bold text-amber-500">{resources.wood}</span></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl">🪨</span>
          <div className="flex flex-col"><span className="text-xs text-slate-400 font-bold">Stone</span><span className="font-mono text-lg font-bold text-stone-400">{resources.stone}</span></div>
        </div>
      </div>

      {/* 检查器 */}
      <div className="absolute top-4 right-4 w-64 bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-lg p-4 shadow-xl">
        <h2 className="text-sm font-bold text-slate-400 uppercase mb-2">INSPECTOR</h2>
        {inspector ? (
          <div><div className="text-xl font-bold text-white mb-1">{inspector.title}</div><div className="text-sm text-slate-400 font-mono">{inspector.desc}</div></div>
        ) : (<div className="text-sm text-slate-500 italic">...</div>)}
        <div className="mt-4 border-t border-slate-700 pt-4 flex gap-2">
           <button onClick={handleSave} className="flex-1 bg-indigo-600 hover:bg-indigo-500 py-1 rounded text-sm font-bold">保存</button>
           <button onClick={handleLoad} className="flex-1 bg-slate-700 hover:bg-slate-600 py-1 rounded text-sm font-bold">读取</button>
        </div>
      </div>

      {/* 底部指令栏 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        {notification && <div className="animate-bounce bg-red-500/90 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg mb-2">{notification}</div>}
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-700 p-2 rounded-2xl shadow-2xl flex gap-2">
          <button onClick={() => setTool('SELECT')} className={`p-3 rounded-xl hover:bg-slate-700 ${tool==='SELECT'?'bg-blue-600 ring-2 ring-blue-400':''}`} title="移动视角">✋</button>
          <div className="w-px bg-slate-700 my-1 mx-1"></div>
          <button onClick={() => setTool('CHOP')} className={`p-3 rounded-xl hover:bg-slate-700 ${tool==='CHOP'?'bg-amber-700 ring-2 ring-amber-500':''}`} title="砍树">🪓</button>
          <button onClick={() => setTool('MINE')} className={`p-3 rounded-xl hover:bg-slate-700 ${tool==='MINE'?'bg-stone-600 ring-2 ring-stone-400':''}`} title="挖掘">⛏️</button>
          <div className="w-px bg-slate-700 my-1 mx-1"></div>
          <button onClick={() => setTool('BUILD_WALL_WOOD')} className={`p-3 rounded-xl hover:bg-slate-700 ${tool==='BUILD_WALL_WOOD'?'bg-amber-900 ring-2 ring-amber-600':''}`} title="木墙">🪵</button>
          <button onClick={() => setTool('BUILD_WALL_STONE')} className={`p-3 rounded-xl hover:bg-slate-700 ${tool==='BUILD_WALL_STONE'?'bg-stone-800 ring-2 ring-stone-500':''}`} title="石墙">🪨</button>
        </div>
      </div>
    </div>
  );
}