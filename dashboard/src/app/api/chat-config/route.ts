import { NextRequest, NextResponse } from 'next/server';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const SYSTEM_PROMPT = `You are SuiSage's vault configuration assistant. You help users set up their AI trading vault by translating plain-English preferences into configuration values.

There are 6 parameters you can configure:

1. **maxTradeSize** (1-100 SUI): The maximum amount of SUI the agent can trade in a single order. Lower = safer.
2. **maxPositionBps** (500-5000, in basis points): The largest portion of the vault the agent can put into one trade. 1000 = 10%, 3000 = 30%. Lower = more diversified.
3. **stopLossBps** (100-2000, in basis points): If a position drops by this percentage, the agent cuts losses. 300 = 3%, 1000 = 10%. Lower = tighter risk control.
4. **maxDeploymentBps** (1000-8000, in basis points): Maximum portion of the vault that can be actively trading at once. 2500 = 25%, 5000 = 50%. Lower = more cash reserves.
5. **minTradeInterval** (10-300 seconds): Minimum wait time between trades. Higher = less frequent trading.
6. **maxOpenPositions** (1-10): How many trades can be open simultaneously. Lower = simpler, less risk.

Preset profiles for reference:
- **Conservative**: maxTradeSize=5, maxPositionBps=1500 (15%), stopLossBps=300 (3%), maxDeploymentBps=2500 (25%), minTradeInterval=120, maxOpenPositions=1
- **Moderate**: maxTradeSize=10, maxPositionBps=3000 (30%), stopLossBps=500 (5%), maxDeploymentBps=5000 (50%), minTradeInterval=30, maxOpenPositions=3
- **Aggressive**: maxTradeSize=25, maxPositionBps=4000 (40%), stopLossBps=1000 (10%), maxDeploymentBps=7000 (70%), minTradeInterval=15, maxOpenPositions=5

When you recommend a configuration, ALWAYS include a JSON block at the end of your message in this exact format:
\`\`\`config
{"maxTradeSize":10,"maxPositionBps":3000,"stopLossBps":500,"maxDeploymentBps":5000,"minTradeInterval":30,"maxOpenPositions":3}
\`\`\`

Rules:
- Be conversational and helpful. Explain WHY you chose each value.
- If the user is vague, ask clarifying questions instead of guessing.
- Always keep values within the valid ranges.
- If the user mentions their vault size, factor that into maxTradeSize recommendations.
- Only include the config JSON block when you have enough info to make a recommendation.
- Keep responses concise (2-4 short paragraphs max).`;

interface ChatMessage {
  role: string;
  content: string;
}

export async function POST(req: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json(
      { error: 'Smart setup is not configured. Please contact the administrator.' },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();
    const { message, history } = body as { message: string; history?: ChatMessage[] };

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(history || []).map((m: ChatMessage) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('Groq API error:', errText);
      return NextResponse.json(
        { error: 'Unable to generate recommendations right now. Please try again.' },
        { status: 502 },
      );
    }

    const data = await groqResponse.json();
    const rawReply: string = data.choices?.[0]?.message?.content ?? '';

    // Parse config block from reply
    const configMatch = rawReply.match(/```config\s*\n?([\s\S]*?)\n?```/);
    let config: Record<string, number> | undefined;
    let reply = rawReply;

    if (configMatch) {
      try {
        const parsed = JSON.parse(configMatch[1].trim());
        config = {
          maxTradeSize: clamp(parsed.maxTradeSize, 1, 100),
          maxPositionBps: clamp(parsed.maxPositionBps, 500, 5000),
          stopLossBps: clamp(parsed.stopLossBps, 100, 2000),
          maxDeploymentBps: clamp(parsed.maxDeploymentBps, 1000, 8000),
          minTradeInterval: clamp(parsed.minTradeInterval, 10, 300),
          maxOpenPositions: clamp(parsed.maxOpenPositions, 1, 10),
        };
      } catch {
        // If JSON parsing fails, just return the reply without config
      }
      // Remove the config block from the displayed reply
      reply = rawReply.replace(/```config\s*\n?[\s\S]*?\n?```/, '').trim();
    }

    return NextResponse.json({ reply, config });
  } catch (error) {
    console.error('Chat config error:', error);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
