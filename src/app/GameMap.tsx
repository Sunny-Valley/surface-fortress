'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import LZString from 'lz-string';
import { createNoise2D } from 'simplex-noise';
import { saveGameAction, loadGameAction } from './actions';

// --- 1. ASCII 风格配置 ---
const TILE_SIZE = 20; // 字符占用空间 (像素)
const FONT_SIZE = 16; // 字体大小
const MAP_WIDTH = 60;
const MAP_HEIGHT = 45;

// 字符映射表
const ASCII_MAP: Record<number, { char: string, color: string }> = {
  0: { char: '≈', color: '#1e3799' }, // WATER (深蓝)
  1: { char: '.', color: '#2ecc71' }, // GRASS (亮绿)
  2: { char: '♣', color: '#006400' }, // FOREST (深绿)
  3: { char: '▲', color: '#7f8c8d' }, // MOUNTAIN (灰色)
  4: { char: '#', color: '#bdc3c7' }, // WALL (白灰)
  5: { char: '+', color: '#34495e' }, // FLOOR (深灰)
  99: { char: '☼', color: '#f1c40f' } // BASE (金色太阳)
};

enum TileType {
  WATER = 0, GRASS = 1, FOREST = 2, MOUNTAIN = 3, WALL = 4, FLOOR = 5, BASE = 99
}

interface Task { id: number; index: number; type: string; assignedTo?: number; }
interface Dwarf { 
  id: number; name: string; x: number; y: number; color: string; // 颜色存为字符串
  state: string; targetIndex?: number; workTimer: number; energy: number; 
}

const NAMES = ["Urist", "Zon", "Bomrek", "Kogan", "Dastot", "Mebzuth", "Iden", "Sodel"];
const getRandomName = () => NAMES[Math.floor(Math.random() * NAMES.length)];

export default function GameMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // --- React UI 状态 (用于侧边栏显示) ---
  const [tool, setTool] = useState('SELECT');
  const [resources, setResources] = useState({ gold: 0, wood: 0, stone: 0, food: 20 });
  const [dwarfStats, setDwarfStats] = useState<Dwarf[]>([]);
  const [logs, setLogs] = useState<string[]>(["[系统] 世界生成完毕，准备殖民。"]);

  // --- 游戏核心数据 (Ref, 高频读写) ---
  const game = useRef({
    app: null as PIXI.Application | null,
    seed: Math.random(),
    tiles: [] as number[],
    modified: {} as Record<number, number>,
    dwarves: [] as Dwarf[],
    tasks: [] as Task[],
    spawn: { x: 0, y: 0 },
    // 缓存网格: 存储地图上的每一个字符对象，避免重复创建
    textGrid: [] as PIXI.Text[],
    // 缓存生物: 存储矮人的字符对象
    dwarfSprites: new Map<number, PIXI.Text>()
  });

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString().slice(0,5)}] ${msg}`, ...prev].slice(0, 50));
  };

  useEffect(() => {
    let isCancelled = false;
    const currentContainer = containerRef.current;

    const init = async () => {
      if (!currentContainer) return;
      
      const app = new PIXI.Application();
      await app.init({
        resizeTo: currentContainer,
        backgroundColor: 0x000000, // 纯黑背景
        antialias: true
      });

      if (isCancelled) { app.destroy(); return; }
      currentContainer.innerHTML = '';
      currentContainer.appendChild(app.canvas);
      game.current.app = app;

      // 1. 地图生成
      const noise = createNoise2D(() => game.current.seed);
      const tiles = [];
      let spawn = { x: 0, y: 0 };
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const h = noise(x/15, y/15);
          let t = TileType.GRASS;
          if (h < -0.2) t = TileType.WATER;
          else if (h > 0.45) t = TileType.MOUNTAIN;
          else if (h > 0.2) t = TileType.FOREST;
          if (t === TileType.GRASS && h > 0 && h < 0.1) spawn = {x:x*TILE_SIZE, y:y*TILE_SIZE};
          tiles.push(t);
        }
      }
      game.current.tiles = tiles;
      game.current.spawn = spawn;

      // 2. 矮人生成
      if (game.current.dwarves.length === 0) {
        for (let i = 0; i < 5; i++) {
          game.current.dwarves.push({
            id: i,
            name: getRandomName(),
            x: spawn.x + (Math.random()-0.5)*100, 
            y: spawn.y + (Math.random()-0.5)*100,
            color: ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#2ecc71'][i%5],
            state: 'IDLE',
            workTimer: 0,
            energy: 100
          });
        }
        const idx = Math.floor(spawn.y/TILE_SIZE)*MAP_WIDTH + Math.floor(spawn.x/TILE_SIZE);
        game.current.modified[idx] = TileType.BASE;
      }

      // 3. 构建字符场景
      const world = new PIXI.Container();
      const mapLayer = new PIXI.Container(); // 地图字符
      const entityLayer = new PIXI.Container(); // 生物字符
      const uiLayer = new PIXI.Graphics(); // 选中框
      
      world.addChild(mapLayer, uiLayer, entityLayer); // UI层放在中间，可以在字符之上
      app.stage.addChild(world);

      // 初始化地图字符网格 (一次性创建所有Text对象，性能优化关键)
      for (let i = 0; i < MAP_WIDTH * MAP_HEIGHT; i++) {
        const text = new PIXI.Text({
          text: '', 
          style: { fontFamily: 'Courier New', fontSize: FONT_SIZE, fontWeight: 'bold', fill: '#ffffff' }
        });
        text.x = (i % MAP_WIDTH) * TILE_SIZE;
        text.y = Math.floor(i / MAP_WIDTH) * TILE_SIZE;
        text.anchor.set(0.5); // 居中对齐
        mapLayer.addChild(text);
        game.current.textGrid.push(text);
      }

      // 居中显示世界
      world.x = (app.screen.width - MAP_WIDTH*TILE_SIZE)/2;
      world.y = (app.screen.height - MAP_HEIGHT*TILE_SIZE)/2;

      // --- 渲染更新函数 ---
      const updateMapVisuals = () => {
        game.current.tiles.forEach((base, i) => {
          const type = game.current.modified[i] ?? base;
          const conf = ASCII_MAP[type] || ASCII_MAP[TileType.GRASS];
          const textObj = game.current.textGrid[i];
          
          // 只有当字符改变时才更新，极大提升性能
          if (textObj.text !== conf.char) {
            textObj.text = conf.char;
            textObj.style.fill = conf.color;
          }
        });
      };
      updateMapVisuals();

      // --- 游戏主循环 (Ticker) ---
      app.ticker.add((time) => {
        const delta = time.deltaTime;

        // AI 逻辑 (保持之前的快速移动)
        game.current.dwarves.forEach(d => {
          if (d.state === 'IDLE') {
            if (d.energy < 20) {
               // 回基地
               const baseIdx = Math.floor(game.current.spawn.y/TILE_SIZE)*MAP_WIDTH + Math.floor(game.current.spawn.x/TILE_SIZE);
               d.targetIndex = baseIdx; 
               d.state = 'MOVING';
            } else {
               const freeTask = game.current.tasks.find(t => t.assignedTo === undefined);
               if (freeTask) {
                 freeTask.assignedTo = d.id;
                 d.targetIndex = freeTask.index;
                 d.state = 'MOVING';
               } else if (Math.random() < 0.02) {
                 d.x += (Math.random()-0.5)*10; d.y += (Math.random()-0.5)*10;
               }
            }
          }
          else if (d.state === 'MOVING' && d.targetIndex !== undefined) {
            // 计算目标中心点
            const tx = (d.targetIndex % MAP_WIDTH) * TILE_SIZE + TILE_SIZE/2;
            const ty = Math.floor(d.targetIndex / MAP_WIDTH) * TILE_SIZE + TILE_SIZE/2;
            const dx = tx - d.x;
            const dy = ty - d.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < 5) {
               if (d.energy < 20) d.state = 'SLEEPING';
               else { d.state = 'WORKING'; d.workTimer = 30; }
            } else {
               // 排斥力场
               let px=0, py=0;
               game.current.dwarves.forEach(o => {
                 if (d.id!==o.id) {
                   const odx=d.x-o.x, ody=d.y-o.y, odist=Math.sqrt(odx*odx+ody*ody);
                   if (odist<15 && odist>0) { px+=odx/odist; py+=ody/odist; }
                 }
               });
               const speed = d.energy < 20 ? 2 : 4;
               d.x += (dx/dist)*speed*delta + px*0.5;
               d.y += (dy/dist)*speed*delta + py*0.5;
            }
          }
          else if (d.state === 'WORKING') {
             d.workTimer -= delta;
             d.x += Math.sin(Date.now()/50); // 工作抖动
             if (d.workTimer <= 0) {
               const tIdx = game.current.tasks.findIndex(t => t.index === d.targetIndex);
               if (tIdx !== -1) {
                 const task = game.current.tasks[tIdx];
                 const i = task.index;
                 if (task.type === 'CHOP') {
                    game.current.modified[i] = TileType.GRASS;
                    setResources(r => { 
                      addLog(`${d.name} 砍伐了木材 (+5)`);
                      return {...r, wood: r.wood+5};
                    });
                 } else if (task.type === 'MINE') {
                    game.current.modified[i] = TileType.FLOOR;
                    const gotGold = Math.random() > 0.8;
                    setResources(r => {
                      addLog(`${d.name} 开采了岩石 ${gotGold ? '(发现金币!)' : ''}`);
                      return {...r, stone: r.stone+1, gold: r.gold + (gotGold?1:0)};
                    });
                 } else if (task.type === 'BUILD') {
                    game.current.modified[i] = TileType.WALL;
                    addLog(`${d.name} 建造了城墙`);
                 }
                 game.current.tasks.splice(tIdx, 1);
                 updateMapVisuals(); // 刷新地图字符
               }
               d.state = 'IDLE';
               d.targetIndex = undefined;
             }
          }
          else if (d.state === 'SLEEPING') {
             d.energy += 0.5;
             if (d.energy >= 100) d.state = 'IDLE';
          }
        });

        // --- 渲染生物字符 (☺) ---
        game.current.dwarves.forEach(d => {
           let txt = game.current.dwarfSprites.get(d.id);
           if (!txt) {
             txt = new PIXI.Text({ text: '☺', style: { fontSize: TILE_SIZE, fontWeight: 'bold' } });
             txt.anchor.set(0.5);
             entityLayer.addChild(txt);
             game.current.dwarfSprites.set(d.id, txt);
           }
           // 插值移动
           txt.x += (d.x - txt.x) * 0.5 * delta;
           txt.y += (d.y - txt.y) * 0.5 * delta;
           txt.style.fill = d.color;
           txt.text = d.state === 'SLEEPING' ? 'Z' : '☺';
        });

        // --- 绘制 UI 框 ---
        uiLayer.clear();
        game.current.tasks.forEach(t => {
           const tx = (t.index%MAP_WIDTH)*TILE_SIZE, ty = Math.floor(t.index/MAP_WIDTH)*TILE_SIZE;
           uiLayer.rect(tx, ty, TILE_SIZE, TILE_SIZE).stroke({width:1, color: 0xffffff});
        });

        // --- 数据同步 (节流) ---
        // 每 30 帧 (约0.5秒) 同步一次数据到 React 侧边栏，避免 UI 渲染过重卡顿
        if (Math.floor(Date.now() / 100) % 5 === 0) {
           setDwarfStats([...game.current.dwarves]);
        }
      });

      // --- 交互 ---
      app.stage.eventMode = 'static'; app.stage.hitArea = app.screen;
      let isDrag=false, last={x:0, y:0};
      app.stage.on('pointerdown', e => {
         if (e.button===1 || tool==='SELECT') { isDrag=true; last={x:e.global.x, y:e.global.y}; }
         else {
           const p = world.toLocal(e.global), gx=Math.floor(p.x/TILE_SIZE), gy=Math.floor(p.y/TILE_SIZE);
           if (gx>=0 && gx<MAP_WIDTH && gy>=0 && gy<MAP_HEIGHT) {
             const idx = gy*MAP_WIDTH+gx;
             const type = game.current.modified[idx] ?? game.current.tiles[idx];
             const exists = game.current.tasks.find(t=>t.index===idx);
             if (!exists) {
               const newTask = { id: Date.now(), index: idx, type: tool, assignedTo: undefined };
               if (tool==='CHOP' && type===TileType.FOREST) game.current.tasks.push(newTask);
               else if (tool==='MINE' && type===TileType.MOUNTAIN) game.current.tasks.push(newTask);
               else if (tool==='BUILD' && type===TileType.GRASS) {
                  if (resources.stone >= 1) {
                    setResources(r=>({...r, stone: r.stone-1}));
                    game.current.tasks.push(newTask);
                  } else alert("石头不足!");
               }
             }
           }
         }
      });
      app.stage.on('pointermove', e => {
         if (isDrag) { world.x+=e.global.x-last.x; world.y+=e.global.y-last.y; last={x:e.global.x, y:e.global.y}; }
      });
      app.stage.on('pointerup', ()=>isDrag=false);
      
      const canvas = app.canvas as HTMLCanvasElement;
      canvas.addEventListener('wheel', e => {
         e.preventDefault();
         const s = e.deltaY < 0 ? 1.1 : 0.9;
         world.scale.x *= s; world.scale.y *= s;
      }, {passive:false});

    };
    init();
    return () => { isCancelled=true; if(game.current.app) game.current.app.destroy({removeView:true}); };
  }, []); // eslint-disable-line

  const save = async () => {
    const data = { seed:game.current.seed, resources, modified:game.current.modified, dwarves:game.current.dwarves };
    await saveGameAction(1, LZString.compressToUTF16(JSON.stringify(data)));
    addLog("存档已上传到云端");
  };
  const load = async () => {
    const d = await loadGameAction(1);
    if(d) { alert("读取成功"); window.location.reload(); }
  };

  return (
    <div className="flex w-screen h-screen bg-neutral-950 text-gray-200 font-mono overflow-hidden">
      {/* 左侧：游戏画面 */}
      <div ref={containerRef} className="flex-1 relative bg-black cursor-crosshair border-r border-gray-800" />

      {/* 右侧：侧边栏 (固定宽度) */}
      <div className="w-80 flex flex-col bg-gray-900 shadow-2xl z-10">
        
        {/* 1. 标题 */}
        <div className="p-4 border-b border-gray-800 bg-gray-950">
          <h1 className="text-xl font-bold text-gray-100 tracking-widest text-center">ASCII FORTRESS</h1>
          <div className="text-xs text-gray-600 text-center mt-1">Version 0.3.0 (Alpha)</div>
        </div>

        {/* 2. 仓库资源 */}
        <div className="p-4 border-b border-gray-800 bg-gray-800/30">
          <h2 className="text-xs font-bold text-gray-500 uppercase mb-3">Stockpile</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between bg-black/30 p-2 rounded"><span className="text-yellow-500">💰 金币</span> <span>{resources.gold}</span></div>
            <div className="flex justify-between bg-black/30 p-2 rounded"><span className="text-green-600">🌲 木材</span> <span>{resources.wood}</span></div>
            <div className="flex justify-between bg-black/30 p-2 rounded"><span className="text-gray-400">⛰️ 石材</span> <span>{resources.stone}</span></div>
            <div className="flex justify-between bg-black/30 p-2 rounded"><span className="text-red-400">🍖 食物</span> <span>{resources.food}</span></div>
          </div>
        </div>

        {/* 3. 矮人列表 */}
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-700">
          <h2 className="text-xs font-bold text-gray-500 uppercase mb-3">Citizens ({dwarfStats.length})</h2>
          <div className="space-y-2">
            {dwarfStats.map(d => (
              <div key={d.id} className="bg-gray-800 p-2 rounded border border-gray-700 text-xs hover:bg-gray-750 transition">
                <div className="flex items-center gap-2 mb-1">
                  <span style={{color: d.color}} className="text-base font-bold">☺</span>
                  <span className="font-bold text-gray-300">{d.name}</span>
                </div>
                <div className="flex justify-between text-gray-500 mb-1">
                  <span>状态:</span>
                  <span className={d.state==='IDLE'?'text-gray-400':(d.state==='WORKING'?'text-yellow-400':'text-blue-400')}>
                    [{d.state}]
                  </span>
                </div>
                {/* 能量条 */}
                <div className="w-full bg-black h-1.5 rounded-full overflow-hidden">
                  <div className={`h-full transition-all duration-500 ${d.energy<30?'bg-red-500':'bg-green-600'}`} style={{width: `${d.energy}%`}}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. 日志窗口 */}
        <div className="h-48 border-t border-gray-800 p-3 bg-black font-mono text-xs overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="mb-1 text-gray-400 border-b border-gray-900 pb-1 last:border-0 break-words">
              <span className="text-gray-600 mr-2">{'>'}</span>{log}
            </div>
          ))}
        </div>

        {/* 5. 控制面板 */}
        <div className="p-3 border-t border-gray-800 bg-gray-900 grid grid-cols-4 gap-2">
          <ToolBtn label="✋" active={tool==='SELECT'} onClick={()=>setTool('SELECT')} title="观察移动" />
          <ToolBtn label="🪓" active={tool==='CHOP'} onClick={()=>setTool('CHOP')} title="伐木 (获得木材)" />
          <ToolBtn label="⛏️" active={tool==='MINE'} onClick={()=>setTool('MINE')} title="挖掘 (获得石材/金币)" />
          <ToolBtn label="🧱" active={tool==='BUILD'} onClick={()=>setTool('BUILD')} title="建墙 (消耗石材)" />
        </div>
        
        <div className="p-3 pt-0 flex gap-2">
           <button onClick={save} className="flex-1 bg-blue-900 hover:bg-blue-800 text-blue-100 py-2 rounded text-xs font-bold transition">保存游戏</button>
           <button onClick={load} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded text-xs font-bold transition">读取存档</button>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({label, active, onClick, title}: any) {
  return (
    <button 
      onClick={onClick} 
      title={title}
      className={`h-10 rounded text-xl flex items-center justify-center transition-all ${active ? 'bg-gray-200 text-black shadow-lg scale-105' : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-white'}`}
    >
      {label}
    </button>
  );
}