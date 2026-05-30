// @ts-nocheck — Deno Edge Function
// ═══════════════════════════════════
// EVENTSLI — Generate Ticket PDF Edge Function
// Phase 3: BRD Sections 10 + 16
// ═══════════════════════════════════
// Deploy: supabase functions deploy generate-ticket-pdf --no-verify-jwt
//
// Endpoints:
//   POST /generate-ticket-pdf  { ticket_id: UUID }  → single ticket PDF
//   POST /generate-ticket-pdf  { order_id: UUID }   → all tickets in order (multi-page)
//
// Returns: PDF binary (Content-Type: application/pdf)
// Also uploads to Storage: ticket-pdfs/<ticket_id>.pdf

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1?target=deno';
import { handleCORS, errorResponse, jsonResponse, getCorsHeaders } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { rateLimit, enforceRateLimit } from '../_shared/rate-limit.ts';
import qrcode from 'https://esm.sh/qrcode-generator@1.4.4?target=deno';

// ═══════════════════════════════════
// QR Code Generator (pure JS, no deps)
// Generates a boolean matrix from a string
// ═══════════════════════════════════

// ── Self-contained QR PNG generator (FIX 4.1: zero external API calls) ──
// Previously called api.qrserver.com / quickchart.io which could timeout,
// producing blank gray rectangles. Now generates QR entirely in-process.

// CRC32 table for PNG chunks
const _crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  _crcTable[n] = c;
}
function _crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = _crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function _pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = new DataView(new ArrayBuffer(4));
  len.setUint32(0, data.length);
  const combined = new Uint8Array(typeBytes.length + data.length);
  combined.set(typeBytes, 0);
  combined.set(data, typeBytes.length);
  const crc = _crc32(combined);
  const crcBytes = new DataView(new ArrayBuffer(4));
  crcBytes.setUint32(0, crc);
  const chunk = new Uint8Array(4 + combined.length + 4);
  chunk.set(new Uint8Array(len.buffer), 0);
  chunk.set(combined, 4);
  chunk.set(new Uint8Array(crcBytes.buffer), 4 + combined.length);
  return chunk;
}

async function generateQRPng(data: string): Promise<Uint8Array> {
  // Generate QR matrix using local library
  const qr = qrcode(0, 'M');  // Auto version, Medium error correction
  qr.addData(data);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const cellSize = Math.max(2, Math.floor(280 / moduleCount));
  const margin = cellSize * 2;
  const totalSize = moduleCount * cellSize + margin * 2;

  // Build raw RGB pixel data for PNG
  const rowBytes = totalSize * 3 + 1; // +1 for PNG filter byte
  const raw = new Uint8Array(totalSize * rowBytes);

  for (let y = 0; y < totalSize; y++) {
    raw[y * rowBytes] = 0; // PNG filter: none
    for (let x = 0; x < totalSize; x++) {
      const idx = y * rowBytes + 1 + x * 3;
      const mx = Math.floor((x - margin) / cellSize);
      const my = Math.floor((y - margin) / cellSize);
      const isDark = mx >= 0 && mx < moduleCount && my >= 0 && my < moduleCount && qr.isDark(my, mx);
      const val = isDark ? 0 : 255;
      raw[idx] = val;
      raw[idx + 1] = val;
      raw[idx + 2] = val;
    }
  }

  // Compress pixel data
  const deflated = await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
  ).arrayBuffer();

  // Build minimal valid PNG
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, totalSize);  // width
  ihdrView.setUint32(4, totalSize);  // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB

  const parts = [
    sig,
    _pngChunk('IHDR', ihdr),
    _pngChunk('IDAT', new Uint8Array(deflated)),
    _pngChunk('IEND', new Uint8Array(0)),
  ];

  let totalLen = 0;
  for (const p of parts) totalLen += p.length;
  const png = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png;
}

// ═══════════════════════════════════
// PDF LAYOUT CONSTANTS
// ═══════════════════════════════════

const PAGE_W = 595.28;  // A4 width in points
const PAGE_H = 841.89;  // A4 height in points
const MARGIN = 40;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// Brand colors
const PURPLE = rgb(0.655, 0.545, 0.98);   // #a78bfa
const DARK_BG = rgb(0.098, 0.098, 0.133); // #191922
const WHITE = rgb(1, 1, 1);
const GRAY = rgb(0.627, 0.627, 0.627);    // #a0a0a0
const LIGHT = rgb(0.878, 0.878, 0.878);   // #e0e0e0

// ═══════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════

serve(async (req) => {
  const corsResponse = handleCORS(req);
  if (corsResponse) return corsResponse;

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit(ip, req);
  if (limited) return limited;

  try {
    let body: any;
    try { body = await req.json(); } catch { return errorResponse(400, 'Invalid JSON', {}, req); }

    const { ticket_id, order_id, guest_token } = body;

    if (!ticket_id && !order_id) {
      return errorResponse(400, 'Either ticket_id or order_id is required', {}, req);
    }

    const adminClient = createAdminClient();

    // ── Auth: verify the requester owns these tickets ──
    // C-4 FIX: Require either valid JWT or verified guest_token
    let requesterId: string | null = null;
    let isAdmin = false;
    let guestVerifiedOrderId: string | null = null;

    // Try JWT auth first
    const { user } = await authenticateRequest(req);
    if (user) {
      requesterId = user.id;
      const { data: profile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      // M6 FIX: Include super_admin in admin check
      isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
    } else if (guest_token && typeof guest_token === 'string') {
      // C-4 FIX: Hash the guest_token with SHA-256 and verify via RPC
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(guest_token));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const { data: rpcResult, error: rpcError } = await adminClient
        .rpc('verify_guest_token', { p_token_hash: tokenHash });

      if (rpcError || !rpcResult || !rpcResult.is_valid || !rpcResult.order_id) {
        return errorResponse(401, 'Invalid or expired guest token', {}, req);
      }

      guestVerifiedOrderId = rpcResult.order_id;
    } else {
      // C-4 FIX: Neither JWT nor guest_token — reject
      return errorResponse(401, 'Authentication required', {}, req);
    }

    // ── Fetch ticket(s) ──
    let tickets: any[] = [];

    if (ticket_id) {
      const { data, error } = await adminClient
        .from('tickets')
        .select(`
          id, qr_hash, status, seat_label, scan_count, max_scans_allowed,
          order_id,
          ticket_tiers (
            id, name, price, currency,
            events (
              id, title, venue, city, country, date, end_date,
              cover_image, organizer_name, organizer_email, timezone
            )
          ),
          orders (
            id, user_id, is_guest, guest_name, guest_email
          )
        `)
        .eq('id', ticket_id)
        .single();

      if (error || !data) return errorResponse(404, 'Ticket not found', {}, req);
      tickets = [data];
    } else {
      // Fetch all tickets for an order
      const { data, error } = await adminClient
        .from('tickets')
        .select(`
          id, qr_hash, status, seat_label, scan_count, max_scans_allowed,
          order_id,
          ticket_tiers (
            id, name, price, currency,
            events (
              id, title, venue, city, country, date, end_date,
              cover_image, organizer_name, organizer_email, timezone
            )
          ),
          orders (
            id, user_id, is_guest, guest_name, guest_email
          )
        `)
        .eq('order_id', order_id)
        .eq('status', 'valid');

      if (error || !data || data.length === 0) {
        return errorResponse(404, 'No valid tickets found for this order', {}, req);
      }
      tickets = data;
    }

    // ── Verify ownership (unless admin) ──
    if (!isAdmin) {
      const firstTicket = tickets[0];
      const orderUserId = firstTicket.orders?.user_id;
      const ticketOrderId = firstTicket.order_id;

      if (guestVerifiedOrderId) {
        // C-4 FIX: Guest token was verified — ensure ticket belongs to the verified order
        if (ticketOrderId !== guestVerifiedOrderId) {
          return errorResponse(403, 'Ticket does not belong to your order', {}, req);
        }
      } else if (requesterId) {
        // Authenticated user — verify they own the tickets
        if (orderUserId !== requesterId) {
          return errorResponse(403, 'You do not own these tickets', {}, req);
        }
      }
    }

    // ── Generate multi-page PDF ──
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    for (const ticket of tickets) {
      const event = ticket.ticket_tiers?.events || {};
      const tier = ticket.ticket_tiers || {};
      const order = ticket.orders || {};
      const buyerName = order.is_guest ? (order.guest_name || 'Guest') : '';

      // If authenticated, fetch user name
      let displayName = buyerName;
      if (!order.is_guest && order.user_id) {
        try {
          const { data: profile } = await adminClient
            .from('profiles')
            .select('full_name')
            .eq('id', order.user_id)
            .single();
          displayName = profile?.full_name || 'Attendee';
        } catch { displayName = 'Attendee'; }
      }

      // ── Generate QR PNG ──
      const qrData = ticket.qr_hash || ticket.id;
      const qrPngBytes = await generateQRPng(qrData);
      const qrImage = await pdfDoc.embedPng(qrPngBytes);

      // ── Create page ──
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      // ── Background ──
      page.drawRectangle({
        x: 0, y: 0,
        width: PAGE_W, height: PAGE_H,
        color: WHITE,
      });

      // ── Header banner ──
      const bannerH = 120;
      page.drawRectangle({
        x: 0, y: PAGE_H - bannerH,
        width: PAGE_W, height: bannerH,
        color: DARK_BG,
      });

      // Platform name in banner
      page.drawText('EVENTSLI', {
        x: MARGIN,
        y: PAGE_H - 50,
        size: 28,
        font: helveticaBold,
        color: PURPLE,
      });

      // "E-TICKET" label
      page.drawText('E - T I C K E T', {
        x: MARGIN,
        y: PAGE_H - 80,
        size: 12,
        font: helvetica,
        color: GRAY,
      });

      // Ticket # in top right
      const ticketNum = ticket.id.substring(0, 8).toUpperCase();
      const ticketLabel = `#${ticketNum}`;
      const ticketLabelW = helvetica.widthOfTextAtSize(ticketLabel, 14);
      page.drawText(ticketLabel, {
        x: PAGE_W - MARGIN - ticketLabelW,
        y: PAGE_H - 50,
        size: 14,
        font: helveticaBold,
        color: PURPLE,
      });

      // Status badge
      const statusText = ticket.status.toUpperCase();
      const statusW = helvetica.widthOfTextAtSize(statusText, 10);
      page.drawText(statusText, {
        x: PAGE_W - MARGIN - statusW,
        y: PAGE_H - 75,
        size: 10,
        font: helvetica,
        color: ticket.status === 'valid' ? rgb(0.29, 0.85, 0.5) : rgb(0.97, 0.44, 0.44),
      });

      // ── Decorative accent line ──
      page.drawRectangle({
        x: 0, y: PAGE_H - bannerH - 4,
        width: PAGE_W, height: 4,
        color: PURPLE,
      });

      // ── Event Title ──
      let cursorY = PAGE_H - bannerH - 50;
      const title = event.title || 'Event';
      const titleSize = title.length > 40 ? 20 : 26;
      page.drawText(title, {
        x: MARGIN,
        y: cursorY,
        size: titleSize,
        font: helveticaBold,
        color: DARK_BG,
        maxWidth: CONTENT_W,
      });

      // ── Event Details Grid ──
      cursorY -= 45;

      const detailRows = [
        { label: 'DATE', value: formatDate(event.date) },
        { label: 'VENUE', value: event.venue || 'TBA' },
        { label: 'CITY', value: [event.city, event.country].filter(Boolean).join(', ') || '' },
      ];

      for (const row of detailRows) {
        if (!row.value) continue;

        page.drawText(row.label, {
          x: MARGIN,
          y: cursorY,
          size: 9,
          font: helvetica,
          color: GRAY,
        });
        page.drawText(row.value, {
          x: MARGIN,
          y: cursorY - 16,
          size: 13,
          font: helveticaBold,
          color: DARK_BG,
          maxWidth: CONTENT_W,
        });
        cursorY -= 40;
      }

      // ── Divider ──
      cursorY -= 5;
      page.drawRectangle({
        x: MARGIN, y: cursorY,
        width: CONTENT_W, height: 1,
        color: rgb(0.9, 0.9, 0.9),
      });
      cursorY -= 25;

      // ── Ticket Info Grid (2-column) ──
      const col1X = MARGIN;
      const col2X = PAGE_W / 2 + 10;

      // Row 1: Ticket Type + Buyer Name
      page.drawText('TICKET TYPE', { x: col1X, y: cursorY, size: 9, font: helvetica, color: GRAY });
      page.drawText(tier.name || 'General', { x: col1X, y: cursorY - 16, size: 13, font: helveticaBold, color: DARK_BG });

      page.drawText('ATTENDEE', { x: col2X, y: cursorY, size: 9, font: helvetica, color: GRAY });
      page.drawText(displayName || 'N/A', { x: col2X, y: cursorY - 16, size: 13, font: helveticaBold, color: DARK_BG });

      cursorY -= 45;

      // Row 2: Price + Seat
      const currency = (tier.currency || 'USD').toUpperCase();
      const priceStr = tier.price > 0 ? `${Number(tier.price).toFixed(2)} ${currency}` : 'FREE';

      page.drawText('PRICE', { x: col1X, y: cursorY, size: 9, font: helvetica, color: GRAY });
      page.drawText(priceStr, { x: col1X, y: cursorY - 16, size: 13, font: helveticaBold, color: DARK_BG });

      if (ticket.seat_label) {
        page.drawText('SEAT / TABLE', { x: col2X, y: cursorY, size: 9, font: helvetica, color: GRAY });
        page.drawText(ticket.seat_label, { x: col2X, y: cursorY - 16, size: 13, font: helveticaBold, color: DARK_BG });
      }

      cursorY -= 45;

      // Row 3: Order ID + Organizer
      page.drawText('ORDER', { x: col1X, y: cursorY, size: 9, font: helvetica, color: GRAY });
      page.drawText(order.id?.substring(0, 8).toUpperCase() || '', { x: col1X, y: cursorY - 16, size: 11, font: helvetica, color: DARK_BG });

      if (event.organizer_name) {
        page.drawText('ORGANIZED BY', { x: col2X, y: cursorY, size: 9, font: helvetica, color: GRAY });
        page.drawText(event.organizer_name, { x: col2X, y: cursorY - 16, size: 11, font: helvetica, color: DARK_BG });
      }

      cursorY -= 50;

      // ── Divider ──
      page.drawRectangle({
        x: MARGIN, y: cursorY,
        width: CONTENT_W, height: 1,
        color: rgb(0.9, 0.9, 0.9),
      });
      cursorY -= 20;

      // ── QR Code Section ──
      const qrSize = 180;
      const qrX = (PAGE_W - qrSize) / 2;

      page.drawText('SCAN TO VERIFY', {
        x: (PAGE_W - helvetica.widthOfTextAtSize('SCAN TO VERIFY', 10)) / 2,
        y: cursorY,
        size: 10,
        font: helvetica,
        color: GRAY,
      });

      cursorY -= qrSize + 15;

      page.drawImage(qrImage, {
        x: qrX,
        y: cursorY,
        width: qrSize,
        height: qrSize,
      });

      cursorY -= 15;

      // Ticket ID below QR
      const idStr = `Ticket: ${ticket.id}`;
      const idW = helvetica.widthOfTextAtSize(idStr, 8);
      page.drawText(idStr, {
        x: (PAGE_W - idW) / 2,
        y: cursorY,
        size: 8,
        font: helvetica,
        color: GRAY,
      });

      // ── Footer ──
      const footerY = MARGIN + 20;
      page.drawRectangle({
        x: 0, y: 0,
        width: PAGE_W, height: footerY + 15,
        color: rgb(0.97, 0.97, 0.97),
      });

      page.drawText('This ticket is non-transferable. Present this QR code at the entrance.', {
        x: MARGIN,
        y: footerY,
        size: 8,
        font: helvetica,
        color: GRAY,
      });

      page.drawText('Generated by Eventsli · eventsli.com', {
        x: MARGIN,
        y: footerY - 14,
        size: 8,
        font: helvetica,
        color: GRAY,
      });
    }

    // ── Serialize PDF ──
    const pdfBytes = await pdfDoc.save();

    // ── Upload to Supabase Storage (best-effort) ──
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const firstTicket = tickets[0];
    const storageKey = ticket_id
      ? `tickets/${ticket_id}.pdf`
      : `orders/${order_id}.pdf`;

    try {
      await supabase.storage
        .from('ticket-pdfs')
        .upload(storageKey, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        });
      console.log(`📄 PDF uploaded: ${storageKey}`);

      // FIX 4.3: Track PDF generation status for retry mechanism
      if (order_id) {
        try {
          await supabase
            .from('orders')
            .update({ pdf_status: 'completed' })
            .eq('id', order_id);
        } catch (statusErr) {
          console.warn('Failed to update pdf_status:', statusErr);
        }
      }
    } catch (uploadErr) {
      console.error('⚠️ PDF upload failed (non-critical):', uploadErr);
    }

    // ── Return PDF as response ──
    const fileName = ticket_id
      ? `eventsli-ticket-${ticket_id.substring(0, 8)}.pdf`
      : `eventsli-tickets-${order_id?.substring(0, 8)}.pdf`;

    // Build response headers with proper CORS (no wildcard)
    const pdfHeaders = {
      ...getCorsHeaders(req),
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(pdfBytes.length),
      'Cache-Control': 'private, max-age=3600',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };

    return new Response(pdfBytes, {
      status: 200,
      headers: pdfHeaders,
    });
  } catch (err) {
    console.error('PDF generation error:', err);
    // FIX 4.3: Mark PDF as failed for retry
    try {
      const failClient = createAdminClient();
      const failBody = await req.clone().json().catch(() => ({}));
      if (failBody?.order_id) {
        await failClient
          .from('orders')
          .update({ pdf_status: 'failed' })
          .eq('id', failBody.order_id);
      }
    } catch (_) { /* best effort */ }
    return errorResponse(500, err.message || 'Failed to generate PDF', {}, req);
  }
});


// ═══════════════════════════════════
// HELPERS
// ═══════════════════════════════════

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'TBA';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
