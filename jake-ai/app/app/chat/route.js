import { NextResponse } from 'next/server';
import { askJake } from '@/lib/groq';

export async function POST(request) {
  try {
    const { message, history } = await request.json();
    
    const response = await askJake(message, history);
    
    return NextResponse.json({ response });
  } catch (error) {
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
