import { NextRequest, NextResponse } from "next/server";
import { userLogger } from '@/lib/logger/LoggerFactory';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const user_address = searchParams.get('user_address') || undefined;
    const action_type = searchParams.get('action_type') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const logs = await userLogger.queryLogs({ user_address, action_type, limit });
    
    return NextResponse.json({ success: true, data: logs });
  } catch (error) {
    console.error("Error reading user operation logs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read logs" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    
    // Ensure critical fields exist
    if (!payload.action_type || !payload.user_address || !payload.status) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Fire and forget so we can respond to the client immediately
    userLogger.logAction({
      action_type: payload.action_type,
      user_address: payload.user_address,
      status: payload.status,
      details: payload.details || {},
      tx_hash: payload.tx_hash,
      error_message: payload.error_message
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error writing user operation log:", error);
    return NextResponse.json(
      { success: false, error: "Failed to write log" },
      { status: 500 }
    );
  }
}
