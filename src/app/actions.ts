'use server';

import { sql } from '@vercel/postgres';

export interface SaveData {
  seed: number;
  resources: { wood: number; stone: number; food: number };
  dwarves: any[];
  modifiedTiles: Record<number, number>;
  tasks: any[]; // 保存未完成的任务
}

export async function saveGameAction(slotId: number, data: string) {
  try {
    await sql`
      INSERT INTO saves (user_id, slot_id, data, updated_at)
      VALUES ('demo-user', ${slotId}, ${data}, NOW())
      ON CONFLICT (user_id, slot_id)
      DO UPDATE SET data = ${data}, updated_at = NOW();
    `;
    return { success: true };
  } catch (error) {
    console.error('Save error:', error);
    return { success: false, error: 'Database connection failed' };
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