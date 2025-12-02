'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import LZString from 'lz-string';
import { createNoise2D } from 'simplex-noise';
import { saveGameAction, loadGameAction } from './actions';

// --- 配置 ---
const TILE_SIZE = 32;
const MAP_WIDTH = 60;
const MAP_HEIGHT = 45;

enum TileType { WATER=0, GRASS=1, FOREST=2, MOUNTAIN=3, WALL=4, FLOOR=5, BASE=99 }

interface Task { id: number; index: number; type: string; assignedTo?: number; }
interface Dwarf { id: number; name: string; x: number; y: number; color: number; state: string; targetIndex?: number; workTimer: number; energy: number; }

const NAMES = ["Urist", "Zon", "Bomrek", "Kogan", "Dastot", "Mebzuth", "Iden"];
const getRandomName = () => NAMES[Math.floor(Math.random()*NAMES.length)];

export default function GameMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 1. 修复：统一使用 'error' 变量名，防止 ReferenceError
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tool, setTool] = useState('SELECT');
  const [resources, setResources] = useState({ wood: 0, stone: 0 });
  const [hoverInfo, setHoverInfo] = useState<string>("");

  // 游戏核心数据
  const game = useRef({
    app: null as PIXI.Application | null,
    seed: Math.random(),
    tiles: [] as number[],
    modified: {} as Record<number, number>,
    dwarves: [] as Dwarf[],
    tasks: [] as Task[],
    spawn: { x: 0, y: 0 },
    // 视觉缓存: 避免每帧创建新文字对象导致卡顿
    spriteMap: new Map<number, PIXI.Container>() 
  });

  useEffect(() => {
    let isCancelled = false;
    const currentContainer = containerRef.current;

    const init = async () => {
      try {
        if (!currentContainer) return;
        
        // --- 初始化 PixiJS ---
        const app = new PIXI.Application();
        await app.init({
          width: window.innerWidth,
          height: window.innerHeight,
          backgroundColor: 0x1a1a2e,
          antialias: true
        });

        // 2. 修复：双重检查，防止在组件卸载后继续执行导致报错
        if (isCancelled) { await app.destroy(); return; }
        
        currentContainer.innerHTML = '';
        currentContainer.appendChild(app.canvas);
        game.current.app = app;

        // --- 地图生成 ---
        const noise = createNoise2D(() => game.current.seed);
        const tiles = [];
        let spawn = { x: 0, y: 0 };
        for (let y = 0; y < MAP_HEIGHT; y++) {
          for (let x = 0; x < MAP_WIDTH; x++) {
            const h = noise(x/15, y/15);
            let t = TileType.GRASS;
            if (h < -0.2) t = TileType.WATER;
            else if (h > 0.4) t = TileType.MOUNTAIN;
            else if (h > 0.15) t = TileType.FOREST;
            if (t === TileType.GRASS && h > 0 && h < 0.1) spawn = {x:x*TILE_SIZE, y:y*TILE_SIZE};
            tiles.push(t);
          }
        }
        game.current.tiles = tiles;
        game.current.spawn = spawn;

        // --- 矮人生成 ---
        if (game.current.dwarves.length === 0) {
          for (let i = 0; i < 5; i++) {
            game.current.dwarves.push({
              id: i,
              name: getRandomName(),
              x: spawn.x + Math.random()*200 - 100, // 分散出生
              y: spawn.y + Math.random()*200 - 100,
              color: [0xe74c3c, 0x3498db, 0xf1c40f][i%3],
              state: 'IDLE',
              workTimer: 0,
              energy: 100
            });
          }
          const idx = Math.floor(spawn.y/TILE_SIZE)*MAP_WIDTH + Math.floor(spawn.x/TILE_SIZE);
          game.current.modified[idx] = TileType.BASE;
        }

        // --- 图层 ---
        const world = new PIXI.Container();
        const terrainLayer = new PIXI.Container();
        const uiLayer = new PIXI.Graphics();
        const dwarfLayer = new PIXI.Container();
        world.addChild(terrainLayer, uiLayer, dwarfLayer);
        app.stage.addChild(world);
        
        world.x = app.screen.width/2 - spawn.x;
        world.y = app.screen.height/2 - spawn.y;

        // --- 绘图辅助 ---
        const drawTree = (g: PIXI.Graphics, x: number, y: number) => {
          g.rect(x+12, y+18, 8, 14).fill(0x5D4037);
          g.poly([x+16, y+2, x+4, y+16, x+28, y+16]).fill(0x2E7D32); // 树叶
        };
        const drawRock = (g: PIXI.Graphics, x: number, y: number) => {
          g.poly([x+6, y+28, x+16, y+8, x+26, y+28]).fill(0x7f8c8d); // 山峰
        };

        const renderMap = () => {
          terrainLayer.removeChildren();
          const g = new PIXI.Graphics();
          game.current.tiles.forEach((base, i) => {
            const type = game.current.modified[i] ?? base;
            const x = (i%MAP_WIDTH)*TILE_SIZE, y = Math.floor(i/MAP_WIDTH)*TILE_SIZE;
            
            let c = 0x27AE60;
            if(type===TileType.WATER) c=0x2980B9;
            if(type===TileType.FLOOR) c=0x5D6D7E;
            g.rect(x, y, TILE_SIZE, TILE_SIZE).fill(c);

            if(type===TileType.FOREST) drawTree(g, x, y);
            else if(type===TileType.MOUNTAIN) drawRock(g, x, y);
            else if(type===TileType.BASE) g.rect(x+8,y+8,16,16).fill(0xE67E22);
          });
          terrainLayer.addChild(g);
        };
        renderMap();

        // --- 游戏循环 ---
        app.ticker.add((time) => {
          const delta = time.deltaTime;
          
          // AI 逻辑
          game.current.dwarves.forEach(d => {
            if (d.state === 'IDLE') {
              // 3. 修复：任务认领逻辑 (防止所有人抢一个任务)
              const freeTask = game.current.tasks.find(t => t.assignedTo === undefined);
              if (freeTask) {
                freeTask.assignedTo = d.id;
                d.targetIndex = freeTask.index;
                d.state = 'MOVING';
              } else if (Math.random() < 0.01) {
                // 闲逛
                d.x += (Math.random()-0.5)*10;
                d.y += (Math.random()-0.5)*10;
              }
            } else if (d.state === 'MOVING' && d.targetIndex !== undefined) {
              const tx = (d.targetIndex%MAP_WIDTH)*TILE_SIZE+16;
              const ty = Math.floor(d.targetIndex/MAP_WIDTH)*TILE_SIZE+16;
              const dx = tx-d.x, dy = ty-d.y;
              const dist = Math.sqrt(dx*dx+dy*dy);
              
              if (dist < 4) {
                d.state = 'WORKING'; d.workTimer = 40;
              } else {
                // 4. 修复：排斥场 (防止重叠)
                let pushX=0, pushY=0;
                game.current.dwarves.forEach(o => {
                  if(d.id!==o.id) {
                    const odx=d.x-o.x, ody=d.y-o.y, odist=Math.sqrt(odx*odx+ody*ody);
                    if(odist<20 && odist>0) { pushX+=odx/odist; pushY+=ody/odist; }
                  }
                });
                d.x += (dx/dist)*3*delta + pushX; // 速度系数 3
                d.y += (dy/dist)*3*delta + pushY;
              }
            } else if (d.state === 'WORKING') {
              d.workTimer -= delta;
              if (d.workTimer <= 0) {
                const tIdx = game.current.tasks.findIndex(t => t.index === d.targetIndex);
                if (tIdx !== -1) {
                  const task = game.current.tasks[tIdx];
                  const idx = task.index;
                  if(task.type==='CHOP') { game.current.modified[idx]=TileType.GRASS; setResources(r=>({...r, wood:r.wood+5})); }
                  if(task.type==='MINE') { game.current.modified[idx]=TileType.FLOOR; setResources(r=>({...r, stone:r.stone+1})); }
                  if(task.type==='BUILD') { game.current.modified[idx]=TileType.WALL; }
                  game.current.tasks.splice(tIdx, 1);
                  renderMap();
                }
                d.state = 'IDLE';
              }
            }
          });

          // 5. 修复：渲染性能 (使用缓存池，避免卡顿)
          game.current.dwarves.forEach(d => {
            let sprite = game.current.spriteMap.get(d.id);
            if (!sprite) {
              sprite = new PIXI.Container();
              const body = new PIXI.Graphics();
              body.rect(-6, -10, 12, 14).fill(d.color);
              body.rect(-6, -16, 12, 6).fill(0xffccaa); // 脸
              
              const text = new PIXI.Text({
                text: d.name,
                style: { fontSize: 10, fill: 0xffffff, stroke: { color: 0x000000, width: 2 } }
              });
              text.anchor.set(0.5, 1);
              text.y = -20;
              
              sprite.addChild(body, text);
              dwarfLayer.addChild(sprite);
              game.current.spriteMap.set(d.id, sprite);
            }
            // 插值平滑移动
            sprite.x += (d.x - sprite.x) * 0.5;
            sprite.y += (d.y - sprite.y) * 0.5;
          });

          // UI 绘制
          uiLayer.clear();
          game.current.tasks.forEach(t => {
             const tx = (t.index%MAP_WIDTH)*TILE_SIZE, ty = Math.floor(t.index/MAP_WIDTH)*TILE_SIZE;
             uiLayer.rect(tx, ty, TILE_SIZE, TILE_SIZE).stroke({width:2, color:0xFFFFFF});
          });
        });

        // 交互
        app.stage.eventMode = 'static'; app.stage.hitArea = app.screen;
        let isDrag=false, last={x:0, y:0};
        app.stage.on('pointerdown', e=>{
          if(e.button===1 || tool==='SELECT') { isDrag=true; last={x:e.global.x, y:e.global.y}; }
          else {
            const p = world.toLocal(e.global), gx=Math.floor(p.x/TILE_SIZE), gy=Math.floor(p.y/TILE_SIZE);
            if(gx>=0 && gx<MAP_WIDTH) {
              const idx = gy*MAP_WIDTH+gx;
              const type = game.current.modified[idx]??game.current.tiles[idx];
              const exists = game.current.tasks.find(t=>t.index===idx);
              if(!exists) {
                const newTask = {id:Date.now(), index:idx, type:tool, assignedTo: undefined};
                if(tool==='CHOP' && type===TileType.FOREST) game.current.tasks.push(newTask);
                if(tool==='MINE' && type===TileType.MOUNTAIN) game.current.tasks.push(newTask);
                if(tool==='BUILD' && type===TileType.GRASS && resources.stone>=1) {
                  setResources(r=>({...r, stone:r.stone-1}));
                  game.current.tasks.push(newTask);
                }
              }
            }
          }
        });
        app.stage.on('pointermove', e=>{
          if(isDrag) { world.x+=e.global.x-last.x; world.y+=e.global.y-last.y; last={x:e.global.x, y:e.global.y}; }
          const p = world.toLocal(e.global), gx=Math.floor(p.x/TILE_SIZE), gy=Math.floor(p.y/TILE_SIZE);
          if(gx>=0) setHoverInfo(`[${gx},${gy}]`);
        });
        app.stage.on('pointerup', ()=>isDrag=false);

        setLoading(false);
      } catch (err: any) {
        setError(err.message);
      }
    };

    init();
    return () => { 
      isCancelled = true; 
      // 3. 修复：安全的销毁逻辑
      if (game.current.app) {
        game.current.app.destroy({ removeView: true }, { children: true });
        game.current.app = null;
      }
    };
  }, []); // eslint-disable-line

  const save = async () => {
    const data = { seed:game.current.seed, resources, modified:game.current.modified, dwarves:game.current.dwarves };
    await saveGameAction(1, LZString.compressToUTF16(JSON.stringify(data)));
    alert("已保存!");
  };
  const load = async () => {
    const d = await loadGameAction(1);
    if(d) { alert("读取成功, 刷新..."); window.location.reload(); }
  };

  if (error) return <div className="p-10 text-red-500 bg-black h-screen">错误: {error}</div>;

  return (
    <div className="w-screen h-screen bg-black overflow-hidden select-none text-white font-sans relative">
      <div ref={containerRef} className="absolute inset-0" />
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-black z-50">正在加载世界...</div>}

      <div className="absolute top-4 left-4 flex gap-4 bg-slate-800/80 p-3 rounded-xl border border-white/10">
         <div>🪵 <span className="text-amber-500 font-bold">{resources.wood}</span></div>
         <div>🪨 <span className="text-gray-400 font-bold">{resources.stone}</span></div>
         <div className="text-sm text-gray-400 pl-4 border-l border-gray-600">{hoverInfo}</div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3 bg-slate-900/90 p-2 rounded-2xl border border-white/10">
         <Btn icon="✋" active={tool==='SELECT'} onClick={()=>setTool('SELECT')} />
         <Btn icon="🪓" active={tool==='CHOP'} onClick={()=>setTool('CHOP')} color="bg-amber-600" />
         <Btn icon="⛏️" active={tool==='MINE'} onClick={()=>setTool('MINE')} color="bg-gray-600" />
         <Btn icon="🧱" active={tool==='BUILD'} onClick={()=>setTool('BUILD')} color="bg-indigo-600" />
      </div>

      <div className="absolute top-4 right-4 flex gap-2">
         <button onClick={save} className="bg-blue-600 px-3 py-1 rounded">保存</button>
         <button onClick={load} className="bg-gray-600 px-3 py-1 rounded">读取</button>
      </div>
    </div>
  );
}

function Btn({icon, active, onClick, color='bg-blue-600'}: any) {
  return <button onClick={onClick} className={`w-12 h-12 rounded-lg text-2xl transition ${active ? color + ' scale-110 ring-2 ring-white' : 'hover:bg-white/10'}`}>{icon}</button>;
}