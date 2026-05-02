// @ts-nocheck — This file runs on Deno (Supabase Edge Functions)
// ═══════════════════════════════════
// EVENT WAW — Gemini Chat Proxy
// Keeps GEMINI_API_KEY server-side (Supabase secret)
// Deploy: supabase functions deploy gemini-chat --no-verify-jwt
// Set key: supabase secrets set GEMINI_API_KEY=your_key_here
// ═══════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { handleCORS, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { rateLimit } from '../_shared/rate-limit.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

const SYSTEM_PROMPT = `You are the official AI assistant for **Event Waw** — a premium event ticketing platform. Your name is "Waw Assistant".

ABOUT EVENT WAW:
- Event Waw lets users discover, book, and attend events (concerts, festivals, conferences, sports, workshops, trips, nightlife, art & culture, food & drink).
- Tickets are delivered as QR codes for instant entry.
- Payments are handled securely via Stripe (bank-grade security, PCI DSS compliant).
- The platform supports roles: Attendees, Event Hosts/Organizers, Sponsors, Vendors, and Exhibitors.
- Organizers get a full dashboard with analytics, attendee tracking, promo codes, and venue/seating chart designer.
- The platform was founded in 2026.

KEY FACTS:
- To buy tickets: Browse Events page → pick event → select tier → pay via Stripe → receive QR ticket.
- To create an event: Register as Organizer → Dashboard → Create Event → set details, pricing, venue → publish.
- Refund policies are set by each event organizer individually.
- QR scanner: Organizers scan tickets at the door for contactless, fraud-proof entry in ~2 seconds.
- Support email: support@eventwaw.com
- WhatsApp support: +1 (619) 666-6620 (link: https://wa.me/16196666620)
- Contact page: contact.html
- Guest checkout is available (no account needed to buy tickets).

RULES:
1. Always be friendly, professional, and concise.
2. Keep answers SHORT (2-4 sentences max). Use bullet points for lists.
3. If asked about something unrelated to events/ticketing, politely redirect: "I'm here to help with Event Waw! Ask me about events, tickets, or our platform."
4. Never reveal you are powered by Gemini/Google AI. You are "Waw Assistant".
5. Use HTML formatting: <b>bold</b>, <a href='...'>links</a> when helpful.
6. Never make up event names, prices, or dates. Say "check the Events page" instead.
7. Do NOT generate code, essays, or long content.`;

// List of Gemini model endpoints to try (fallback chain)
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
];

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set. Run: supabase secrets set GEMINI_API_KEY=your_key_here');
    return errorResponse(500, 'Chat service not configured — API key missing', {}, req);
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch (_parseErr) {
      return errorResponse(400, 'Invalid JSON body', {}, req);
    }

    const { message, history = [] } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return errorResponse(400, 'Message is required', {}, req);
    }

    if (message.trim().length > 500) {
      return errorResponse(400, 'Message too long (max 500 chars)', {}, req);
    }

    // Rate limit: 10 messages per minute per IP
    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
    if (!rateLimit(`gemini-chat:${clientIp}`, 10, 60_000)) {
      return errorResponse(429, 'Too many messages. Please wait a moment.', {}, req);
    }

    // Build Gemini conversation (last 10 messages for context)
    const recentHistory = history.slice(-10);
    const contents = [];

    // Add conversation history
    for (const msg of recentHistory) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text || '' }],
      });
    }

    // Add current user message
    contents.push({ role: 'user', parts: [{ text: message.trim() }] });

    const requestBody = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 300,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    });

    // Try each model in the fallback chain
    let lastError = '';
    for (const model of GEMINI_MODELS) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

        const geminiResp = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        });

        if (!geminiResp.ok) {
          const errData = await geminiResp.text();
          console.error(`Gemini API error (${model}):`, geminiResp.status, errData);
          lastError = `${model}: ${geminiResp.status}`;

          // If it's an auth error (invalid API key), don't try other models
          if (geminiResp.status === 400 || geminiResp.status === 401 || geminiResp.status === 403) {
            return errorResponse(502, 'Chat service authentication failed — check API key', { detail: `status ${geminiResp.status}` }, req);
          }

          // For 404 (model not found) or 429 (quota), try next model
          continue;
        }

        const geminiData = await geminiResp.json();
        const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reply) {
          // Check if the response was blocked by safety filters
          const blockReason = geminiData?.candidates?.[0]?.finishReason;
          if (blockReason === 'SAFETY') {
            return jsonResponse({ reply: "I can only help with Event Waw topics — events, tickets, and our platform. Let me know how I can assist!" }, 200, req);
          }
          console.error(`No reply text from ${model}:`, JSON.stringify(geminiData));
          lastError = `${model}: empty response`;
          continue;
        }

        return jsonResponse({ reply: reply.trim() }, 200, req);

      } catch (fetchErr) {
        console.error(`Fetch error for ${model}:`, fetchErr);
        lastError = `${model}: ${fetchErr.message}`;
        continue;
      }
    }

    // All models failed
    console.error('All Gemini models failed. Last error:', lastError);
    return errorResponse(502, 'Chat service temporarily unavailable', { detail: lastError }, req);

  } catch (err) {
    console.error('Gemini chat error:', err);
    return errorResponse(500, 'Internal error', { detail: err.message }, req);
  }
});
