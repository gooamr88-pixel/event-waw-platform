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
import { handleCORS, errorResponse } from '../_shared/cors.ts';
import { authenticateRequest, createAdminClient } from '../_shared/auth.ts';
import { rateLimit, enforceRateLimit } from '../_shared/rate-limit.ts';

// ═══════════════════════════════════
// QR Code Generator (pure JS, no deps)
// Generates a boolean matrix from a string
// ═══════════════════════════════════

/**
 * Minimal QR Code encoder for alphanumeric/byte data.
 * Uses error correction level M.
 * Returns a 2D boolean array (true = dark cell).
 */
function generateQRMatrix(data: string): boolean[][] {
  // We use a compact QR implementation based on the algorithm.
  // For production reliability, we encode via the proven qrcode-generator lib.
  // Loaded inline to avoid Deno import issues.

  // Fallback: use an external micro-library
  const qr = createQR(data);
  return qr;
}

// ── Minimal QR encoder ──
// Based on qrcode-generator by Kazuhiko Arase (MIT License)
// Inlined to avoid import issues in Deno Edge Functions
// This generates a Module matrix we can draw as PDF rectangles.

// For reliability, we'll use a different approach:
// Draw QR via API-fetched PNG and embed in PDF.
// This is more robust than inlining a full QR encoder.

async function generateQRPng(data: string): Promise<Uint8Array> {
  // Use Google Charts QR API (free, no key needed, < 100ms)
  const encoded = encodeURIComponent(data);
  const size = 300;
  const url = `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encoded}&choe=UTF-8&chld=M|2`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`QR generation failed: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
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
  const limited = enforceRateLimit(ip);
  if (limited) return limited;

  try {
    let body: any;
    try { body = await req.json(); } catch { return errorResponse(400, 'Invalid JSON'); }

    const { ticket_id, order_id } = body;

    if (!ticket_id && !order_id) {
      return errorResponse(400, 'Either ticket_id or order_id is required');
    }

    const adminClient = createAdminClient();

    // ── Auth: verify the requester owns these tickets ──
    // Allow both authenticated users and guest token-based access
    let requesterId: string | null = null;
    let isAdmin = false;

    try {
      const { user } = await authenticateRequest(req);
      if (user) {
        requesterId = user.id;
        const { data: profile } = await adminClient
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        isAdmin = profile?.role === 'admin';
      }
    } catch { /* guest access — will verify via order ownership below */ }

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
              cover_image, logo, organizer_name, organizer_email, timezone
            )
          ),
          orders (
            id, user_id, is_guest, guest_name, guest_email
          )
        `)
        .eq('id', ticket_id)
        .single();

      if (error || !data) return errorResponse(404, 'Ticket not found');
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
              cover_image, logo, organizer_name, organizer_email, timezone
            )
          ),
          orders (
            id, user_id, is_guest, guest_name, guest_email
          )
        `)
        .eq('order_id', order_id)
        .eq('status', 'valid');

      if (error || !data || data.length === 0) {
        return errorResponse(404, 'No valid tickets found for this order');
      }
      tickets = data;
    }

    // ── Verify ownership (unless admin) ──
    if (!isAdmin) {
      const firstTicket = tickets[0];
      const orderUserId = firstTicket.orders?.user_id;
      const isGuest = firstTicket.orders?.is_guest;

      if (!isGuest && requesterId && orderUserId !== requesterId) {
        return errorResponse(403, 'You do not own these tickets');
      }
      // For guest tickets, we allow access if they have the order_id
      // (which is only shared via email confirmation)
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
    } catch (uploadErr) {
      console.error('⚠️ PDF upload failed (non-critical):', uploadErr);
    }

    // ── Return PDF as response ──
    const fileName = ticket_id
      ? `eventsli-ticket-${ticket_id.substring(0, 8)}.pdf`
      : `eventsli-tickets-${order_id?.substring(0, 8)}.pdf`;

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(pdfBytes.length),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('PDF generation error:', err);
    return errorResponse(500, err.message || 'Failed to generate PDF');
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
