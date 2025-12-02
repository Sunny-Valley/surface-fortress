'use server';

import { sql } from '@vercel/postgres';

// 定义存档结构
export interface SaveData {
  seed: number;
  dwarves: any[];
  modifiedTiles: Record<number, number>; // 记录被改变的地块索引和新类型
}

export async function saveGameAction(slotId: number, data: string) {
  try {
    // 简单的 Upsert：如果有就更新，没用就插入 (这里简化为只用 slot_id 区分，暂不区分用户)
    // 这里的 user_id 我们暂时写死为 'demo-user'，以后可以接登录系统
    await sql`
      INSERT INTO saves (user_id, slot_id, data, updated_at)
      VALUES ('demo-user', ${slotId}, ${data}, NOW())
      ON CONFLICT (user_id, slot_id)
      DO UPDATE SET data = ${data}, updated_at = NOW();
    `;
    return { success: true };
  } catch (error) {
    console.error('Save error:', error);
    return { success: false, error: '数据库连接失败' };
  }
}

export async function loadGameAction(slotId: number) {
  try {
    const { rows } = await sql`
      SELECT data FROM saves WHERE user_id = 'demo-user' AND slot_id = ${slotId} LIMIT 1;
    `;
    return rows.length > 0 ? rows[0].data : null;
  } catch (error) {
    return null;
  }
}