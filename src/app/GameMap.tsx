'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import LZString from 'lz-string';
import { createNoise2D } from 'simplex-noise';
import { saveGameAction, loadGameAction } from './actions';

// --- 1. 游戏配置 ---
const TILE_SIZE = 32;
const MAP_WIDTH = 60;
const MAP_HEIGHT = 45;
const MOVEMENT_SPEED = 5.0; // ⚡ 核心修改：大幅提升移动速度

enum TileType {
  WATER = 0,
  GRASS = 1,
  FOREST = 2,
  MOUNTAIN = 3,
  WALL = 4,
  FLOOR = 5,
  BASE = 99
}

interface Task {
  id: number;
  index: number;
  type: string;
  assignedTo?: number; 
}

interface Dwarf {
  id: number;
  name: string;
  x: number;
  y: number;
  color: number;
  state: string;
  // 目标不仅仅是格子索引，而是具体的像素坐标 (tx, ty)
  target?: { x: number, y: number, index: number }; 
  workTimer: number;
  energy: number;
}

const NAMES = ["Urist", "Zon", "Bomrek", "Kogan", "Dastot", "Mebzuth", "Iden", "Sodel", "Catten", "Deler"];
const getRandomName = () => NAMES[Math.floor(Math.random() * NAMES.length)];

export default function GameMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState('SELECT');
  const [resources, setResources] = useState({ wood: 0, stone: 0 });
  const [hoverInfo, setHoverInfo] = useState<string>("");

  const game = useRef({
    app: null as PIXI.Application | null,
    seed: Math.random(),
    tiles: [] as number[],
    modified: {} as Record<number, number>,
    dwarves: [] as Dwarf[],
    tasks: [] as Task[],
    spawn: { x: 0, y: 0 },
    spriteMap: new Map<number, PIXI.Container>()
  });

  useEffect(() => {
    let isCancelled = false;
    const currentContainer = containerRef.current;

    const init = async () => {
      try {
        if (!currentContainer) return;
        
        const app = new PIXI.Application();
        await app.init({
          width: window.innerWidth,
          height: window.innerHeight,
          backgroundColor: 0x1a1a2e,
          antialias: true
        });

        if (isCancelled) { app.destroy(); return; }
        currentContainer.innerHTML = '';
        currentContainer.appendChild(app.canvas);
        game.current.app = app;

        // 地图生成
        const noise = createNoise2D(() => game.current.seed);
        const tiles = [];
        let spawn = { x: 0, y: 0 };
        for (let y = 0; y < MAP_HEIGHT; y++) {
          for (let x = 0; x < MAP_WIDTH; x++) {
            const h = noise(x / 15, y / 15);
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

        // 矮人生成
        if (game.current.dwarves.length === 0) {
          for (let i = 0; i < 5; i++) {
            game.current.dwarves.push({
              id: i,
              name: getRandomName(),
              // 分散出生
              x: spawn.x + (Math.random() - 0.5) * 150, 
              y: spawn.y + (Math.random() - 0.5) * 150,
              color: [0xe74c3c, 0x3498db, 0xf1c40f][i % 3],
              state: 'IDLE',
              workTimer: 0,
              energy: 100
            });
          }
          const spawnIdx = Math.floor(spawn.y/TILE_SIZE)*MAP_WIDTH + Math.floor(spawn.x/TILE_SIZE);
          game.current.modified[spawnIdx] = TileType.BASE;
        }

        // 图层
        const world = new PIXI.Container();
        const terrainLayer = new PIXI.Container();
        const uiLayer = new PIXI.Graphics();
        const dwarfLayer = new PIXI.Container();
        
        world.addChild(terrainLayer, uiLayer, dwarfLayer);
        app.stage.addChild(world);
        world.x = app.screen.width/2 - spawn.x;
        world.y = app.screen.height/2 - spawn.y;

        // --- 静态绘制函数 ---
        const drawTree = (g: PIXI.Graphics, x: number, y: number) => {
          g.rect(x + 12, y + 18, 8, 14).fill(0x5D4037);
          g.poly([x+16, y+2, x+4, y+16, x+28, y+16]).fill(0x2E7D32);
          g.poly([x+16, y+8, x+2, y+24, x+30, y+24]).fill(0x388E3C);
        };
        const drawRock = (g: PIXI.Graphics, x: number, y: number) => {
          g.poly([x+4, y+28, x+12, y+10, x+20, y+24, x+26, y+6, x+30, y+28]).fill(0x7f8c8d);
        };
        const drawBase = (g: PIXI.Graphics, x: number, y: number) => {
          g.rect(x+4,y+10,24,20).fill(0xd35400); // 屋身
          g.poly([x+2,y+10, x+16,y, x+30,y+10]).fill(0xe67e22); // 屋顶
          g.rect(x+12,y+18,8,12).fill(0x5d4037); // 门
        };

        const renderMap = () => {
          terrainLayer.removeChildren();
          const g = new PIXI.Graphics();
          game.current.tiles.forEach((base, i) => {
            const type = game.current.modified[i] ?? base;
            const x = (i % MAP_WIDTH) * TILE_SIZE;
            const y = Math.floor(i / MAP_WIDTH) * TILE_SIZE;

            let color = 0x27AE60;
            if (type === TileType.WATER) color = 0x2980B9;
            if (type === TileType.FLOOR) color = 0x5D6D7E;
            if (type === TileType.WALL) color = 0x2C3E50;
            g.rect(x, y, TILE_SIZE, TILE_SIZE).fill(color);

            if (type === TileType.FOREST) drawTree(g, x, y);
            else if (type === TileType.MOUNTAIN) drawRock(g, x, y);
            else if (type === TileType.BASE) drawBase(g, x, y);
            else if (type === TileType.WALL) g.rect(x+4,y+4,24,24).stroke({width:2,color:0x000000});
          });
          terrainLayer.addChild(g);
        };
        renderMap();

        // --- 游戏循环 ---
        app.ticker.add((time) => {
          const delta = time.deltaTime; // 约等于 1.0

          // 1. AI 逻辑
          game.current.dwarves.forEach(d => {
            // A. 找任务
            if (d.state === 'IDLE') {
              const freeTask = game.current.tasks.find(t => t.assignedTo === undefined);
              if (freeTask) {
                 freeTask.assignedTo = d.id;
                 // ⚡ 核心修改：目标点增加随机偏移，防止聚集！
                 // 每个人都在目标格子的不同位置工作
                 const offsetX = (Math.random() - 0.5) * 20;
                 const offsetY = (Math.random() - 0.5) * 20;
                 
                 d.target = { 
                   index: freeTask.index,
                   x: (freeTask.index % MAP_WIDTH) * TILE_SIZE + 16 + offsetX,
                   y: Math.floor(freeTask.index / MAP_WIDTH) * TILE_SIZE + 16 + offsetY
                 };
                 d.state = 'MOVING';
              } else {
                 if (Math.random() < 0.01) { // 闲逛
                   d.x += (Math.random()-0.5) * 20; d.y += (Math.random()-0.5) * 20;
                 }
              }
            }

            // B. 移动
            else if (d.state === 'MOVING' && d.target) {
              const dx = d.target.x - d.x;
              const dy = d.target.y - d.y;
              const dist = Math.sqrt(dx*dx + dy*dy);

              // ⚡ 核心修改：判定范围扩大到 8，防止在终点鬼畜抖动
              if (dist < 8) {
                 d.state = 'WORKING'; 
                 d.workTimer = 30;
              } else {
                 // ⚡ 核心修改：移动速度提升
                 let vx = (dx/dist) * MOVEMENT_SPEED * delta;
                 let vy = (dy/dist) * MOVEMENT_SPEED * delta;

                 // ⚡ 核心修改：排斥场优化，更加柔和但坚定
                 game.current.dwarves.forEach(other => {
                    if (d.id !== other.id) {
                       const odx = d.x - other.x;
                       const ody = d.y - other.y;
                       const odist = Math.sqrt(odx*odx + ody*ody);
                       if (odist < 20 && odist > 0) {
                          const force = (20 - odist) * 0.15; // 稍微减小排斥力，避免弹飞
                          vx += (odx/odist) * force * delta;
                          vy += (ody/odist) * force * delta;
                       }
                    }
                 });

                 d.x += vx;
                 d.y += vy;
              }
            }

            // C. 工作
            else if (d.state === 'WORKING') {
               d.workTimer -= delta;
               d.x += Math.sin(Date.now()/50) * 0.5; // 轻微抖动
               if (d.workTimer <= 0) {
                 const tIdx = game.current.tasks.findIndex(t => t.index === d.target?.index);
                 if (tIdx !== -1) {
                   const task = game.current.tasks[tIdx];
                   const i = task.index;
                   
                   if (task.type === 'CHOP') {
                     game.current.modified[i] = TileType.GRASS;
                     setResources(r => ({...r, wood: r.wood+5}));
                   } else if (task.type === 'MINE') {
                     game.current.modified[i] = TileType.FLOOR;
                     setResources(r => ({...r, stone: r.stone+1}));
                   } else if (task.type === 'BUILD') {
                     game.current.modified[i] = TileType.WALL;
                   }
                   game.current.tasks.splice(tIdx, 1);
                   renderMap();
                 }
                 d.state = 'IDLE';
                 d.target = undefined;
               }
            }
          });

          // 2. 渲染小人 (使用 Sprite 缓存，高性能)
          game.current.dwarves.forEach(d => {
             let sprite = game.current.spriteMap.get(d.id);
             if (!sprite) {
                sprite = new PIXI.Container();
                
                // 身体
                const g = new PIXI.Graphics();
                g.rect(-8, -12, 16, 18).fill(d.color); // 衣服
                g.rect(-8, -20, 16, 8).fill(0xffccaa); // 脸
                g.rect(-8, -14, 16, 6).fill(0xecf0f1); // 胡子
                
                // 名字标签 (带背景，更清晰)
                const nameBg = new PIXI.Graphics();
                nameBg.roundRect(-20, -38, 40, 14, 4).fill({color:0x000000, alpha:0.6});
                
                const text = new PIXI.Text({
                   text: d.name,
                   style: { fontFamily: 'Arial', fontSize: 10, fill: 0xffffff }
                });
                text.anchor.set(0.5);
                text.y = -31;

                sprite.addChild(g, nameBg, text);
                dwarfLayer.addChild(sprite);
                game.current.spriteMap.set(d.id, sprite);
             }
             // 位置同步
             sprite.x = d.x;
             sprite.y = d.y;
             
             // 工作时头顶冒泡
             if (d.state === 'WORKING') sprite.alpha = 0.7 + Math.sin(Date.now()/100)*0.3;
             else sprite.alpha = 1;
          });

          // 3. UI 绘制
          uiLayer.clear();
          game.current.tasks.forEach(t => {
            const tx = (t.index % MAP_WIDTH) * TILE_SIZE;
            const ty = Math.floor(t.index / MAP_WIDTH) * TILE_SIZE;
            
            // 绘制任务框
            uiLayer.rect(tx, ty, TILE_SIZE, TILE_SIZE);
            const color = t.type==='MINE'?0xE74C3C : (t.type==='CHOP'?0xF1C40F : 0x3498DB);
            uiLayer.stroke({ width: 2, color });
            
            // 如果有人认领了，画一条线连向认领者
            if (t.assignedTo !== undefined) {
               uiLayer.circle(tx+16, ty+16, 3).fill(color);
            }
          });
        });

        // 交互逻辑
        app.stage.eventMode = 'static';
        app.stage.hitArea = app.screen;
        let isDrag = false, lastPos = {x:0, y:0};

        app.stage.on('pointerdown', e => {
           if (e.button === 1 || tool === 'SELECT') {
             isDrag = true; lastPos = {x:e.global.x, y:e.global.y};
           } else {
             const p = world.toLocal(e.global);
             const gx = Math.floor(p.x/TILE_SIZE), gy = Math.floor(p.y/TILE_SIZE);
             if (gx>=0 && gx<MAP_WIDTH && gy>=0 && gy<MAP_HEIGHT) {
               const idx = gy*MAP_WIDTH+gx;
               const type = game.current.modified[idx] ?? game.current.tiles[idx];
               const exists = game.current.tasks.find(t=>t.index===idx);
               if (!exists) {
                  const newTask = { id: Date.now(), index: idx, type: tool, assignedTo: undefined };
                  if (tool==='CHOP' && type===TileType.FOREST) game.current.tasks.push(newTask);
                  else if (tool==='MINE' && type===TileType.MOUNTAIN) game.current.tasks.push(newTask);
                  else if (tool==='BUILD' && type===TileType.GRASS && resources.stone>=1) {
                     setResources(r=>({...r, stone: r.stone-1}));
                     game.current.tasks.push(newTask);
                  }
               }
             }
           }
        });

        app.stage.on('pointermove', e => {
           if (isDrag) {
             world.x += e.global.x - lastPos.x;
             world.y += e.global.y - lastPos.y;
             lastPos = {x:e.global.x, y:e.global.y};
           }
           const p = world.toLocal(e.global);
           const gx = Math.floor(p.x/TILE_SIZE), gy = Math.floor(p.y/TILE_SIZE);
           if (gx>=0 && gx<MAP_WIDTH) {
              const idx = gy*MAP_WIDTH+gx;
              const type = game.current.modified[idx] ?? game.current.tiles[idx];
              let t = "荒野";
              if (type===TileType.FOREST) t="🌲 森林";
              else if (type===TileType.MOUNTAIN) t="⛰️ 岩石";
              else if (type===TileType.BASE) t="🏠 基地";
              setHoverInfo(`${t} [${gx},${gy}]`);
           }
        });
        
        app.stage.on('pointerup', () => isDrag=false);
        const canvas = app.canvas as HTMLCanvasElement;
        canvas.addEventListener('wheel', e => {
           e.preventDefault();
           const s = e.deltaY < 0 ? 1.1 : 0.9;
           world.scale.x *= s; world.scale.y *= s;
        }, {passive:false});

        setLoading(false);

      } catch (err: any) { setError(err.message); }
    };

    init();
    return () => { isCancelled=true; if(game.current.app) game.current.app.destroy({removeView:true}); };
  }, []);

  const save = async () => {
    const data = { seed:game.current.seed, resources, modified:game.current.modified, dwarves:game.current.dwarves };
    await saveGameAction(1, LZString.compressToUTF16(JSON.stringify(data)));
    alert("保存成功!");
  };
  const load = async () => {
    const d = await loadGameAction(1);
    if(d) { alert("读取成功, 刷新..."); window.location.reload(); }
  };

  if (error) return <div className="text-red-500 p-10 bg-black h-screen">错误: {error}</div>;

  return (
    <div className="w-screen h-screen bg-black overflow-hidden select-none text-white font-sans relative">
      <div ref={containerRef} className="absolute inset-0" />
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-black z-50">正在加载...</div>}

      <div className="absolute top-4 left-4 flex gap-4 bg-slate-800/80 p-3 rounded-xl border border-white/10 backdrop-blur">
         <div>🪵 <span className="text-amber-500 font-bold text-lg">{resources.wood}</span></div>
         <div>🪨 <span className="text-gray-400 font-bold text-lg">{resources.stone}</span></div>
         <div className="pl-4 border-l border-white/20 text-sm text-gray-300 flex items-center">{hoverInfo}</div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3 bg-slate-900/90 p-2 rounded-2xl border border-white/10 shadow-2xl">
         <Btn icon="✋" active={tool==='SELECT'} onClick={()=>setTool('SELECT')} label="移动" />
         <Btn icon="🪓" active={tool==='CHOP'} onClick={()=>setTool('CHOP')} color="bg-amber-600" label="伐木" />
         <Btn icon="⛏️" active={tool==='MINE'} onClick={()=>setTool('MINE')} color="bg-gray-600" label="挖掘" />
         <Btn icon="🧱" active={tool==='BUILD'} onClick={()=>setTool('BUILD')} color="bg-indigo-600" label="建墙" />
      </div>

      <div className="absolute top-4 right-4 flex gap-2">
         <button onClick={save} className="bg-blue-600 px-3 py-1 rounded hover:bg-blue-500 font-bold shadow">保存</button>
         <button onClick={load} className="bg-gray-700 px-3 py-1 rounded hover:bg-gray-600 font-bold shadow">读取</button>
      </div>
    </div>
  );
}

function Btn({icon, active, onClick, color='bg-blue-600', label}: any) {
  return (
    <button onClick={onClick} className={`relative group w-14 h-14 rounded-xl text-2xl transition-all duration-200 ${active ? color + ' scale-110 -translate-y-2 ring-2 ring-white shadow-lg' : 'hover:bg-white/10 text-gray-400 hover:text-white'}`}>
       {icon}
       <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black/90 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap pointer-events-none">{label}</span>
    </button>
  );
}