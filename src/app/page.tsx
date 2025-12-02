'use client';

import dynamic from 'next/dynamic';

// 动态引入组件，关闭服务端渲染
const GameMapNoSSR = dynamic(() => import('./GameMap'), { 
  ssr: false,
  loading: () => <div className="text-white text-center mt-20">正在加载资源...</div> 
});

export default function Home() {
  return (
    <main>
      <GameMapNoSSR />
    </main>
  );
}