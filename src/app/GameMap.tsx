'use client';

import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';

export default function GameMap() {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 标记组件是否还“活着”，防止异步操作在组件卸载后继续运行报错
    let isMounted = true;
    let app: PIXI.Application | null = null;

    const initGame = async () => {
      // 创建一个新的应用实例
      const _app = new PIXI.Application();

      // 异步初始化
      await _app.init({ 
        resizeTo: window,
        backgroundColor: 0x2c3e50,
      });

      // 【关键修复】如果初始化还没完成组件就被关了，立刻销毁并退出，防止报错
      if (!isMounted) {
        _app.destroy();
        return;
      }

      // 确认挂载成功，赋值给外部变量
      app = _app;

      if (mapRef.current) {
        mapRef.current.appendChild(app.canvas);
      }

      // --- 绘制游戏内容 ---
      const dwarf = new PIXI.Graphics();
      dwarf.rect(0, 0, 40, 40);
      dwarf.fill(0xe74c3c);
      
      dwarf.x = app.screen.width / 2;
      dwarf.y = app.screen.height / 2;
      dwarf.pivot.set(20, 20);

      app.stage.addChild(dwarf);

      app.ticker.add(() => {
        dwarf.rotation += 0.05;
      });
    };

    initGame();

    // 清理函数
    return () => {
      isMounted = false; // 标记已卸载
      if (app) {
        app.destroy({ removeView: true }, { children: true });
      }
    };
  }, []);

  return <div ref={mapRef} style={{ width: '100vw', height: '100vh' }} />;
}