'use server';

import { sql } from '@vercel/postgres';

// 定义存档的数据结构
export interface SaveData {
  seed: number;
  dwarves: any[];
  modifiedTiles: Record<number, number>; // 记录被改变的地块
}

// 保存存档
export async function saveGameAction(slotId: number, data: string) {
  try {
    // 简单的 "有则更新，无则插入" 逻辑
    // 为了演示方便，user_id 暂时写死，以后可以接登录系统
    await sql`
      INSERT INTO saves (user_id, slot_id, data, updated_at)
      VALUES ('demo-user', ${slotId}, ${data}, NOW())
      ON CONFLICT (user_id, slot_id)
      DO UPDATE SET data = ${data}, updated_at = NOW();
    `;
    return { success: true };
  } catch (error) {
    console.error('Save error:', error);
    return { success: false, error: '数据库连接失败，请检查 .env.local' };
  }
}

// 读取存档
export async function loadGameAction(slotId: number) {
  try {
    const { rows } = await sql`
      SELECT data FROM saves WHERE user_id = 'demo-user' AND slot_id = ${slotId} LIMIT 1;
    `;
    return rows.length > 0 ? rows[0].data : null;
  } catch (error) {
    console.error('Load error:', error);
    return null;
  }
}