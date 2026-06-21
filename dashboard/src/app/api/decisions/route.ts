import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// Read the agent's shared decisions log
const DECISIONS_FILE = path.resolve(process.cwd(), '../.agent-decisions/decisions.json');

export async function GET() {
  try {
    if (!existsSync(DECISIONS_FILE)) {
      return NextResponse.json([]);
    }
    const data = readFileSync(DECISIONS_FILE, 'utf-8');
    const decisions = JSON.parse(data);
    return NextResponse.json(decisions);
  } catch {
    return NextResponse.json([]);
  }
}
