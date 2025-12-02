'use client'; // <--- 必须放在第一行！

import dynamic from 'next/dynamic';

// 动态引入游戏组件，并彻底关闭服务端渲染
const GameMap = dynamic(() => import('./GameMap'), { 
  ssr: false,
  loading: () => <div className="text-white text-center pt-20">正在加载游戏资源...</div>
});

export default function Home() {
  return (
    <main className="w-screen h-screen bg-black overflow-hidden">
      <GameMap />
    </main>
  );
}