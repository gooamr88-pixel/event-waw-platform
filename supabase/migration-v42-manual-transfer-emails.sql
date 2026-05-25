-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v42: Manual Transfer Emails & Safeguards
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- ⚠️ SAFE TO RUN: Idempotent. Replaces functions/triggers only.
-- ═══════════════════════════════════════════════════════════════


-- ════════════ STEP 1: Seed Email Templates ════════════
-- Seeds the 5 new email templates into the email_templates table.
-- Using high-end, dark-mode premium layouts matching _shared/email-templates.ts.

INSERT INTO email_templates (name, label, subject, body_html, available_variables, category)
VALUES

-- ── 1. Manual Order Created (to Buyer) ──
(
  'manual_order_created',
  'Manual Order Created (Awaiting Payment)',
  '📝 Confirm your payment of {{total_amount}} {{currency}} for "{{event_title}}"',
  '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#09090b;font-family:''Helvetica Neue'',Arial,sans-serif;-webkit-font-smoothing:antialiased;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;"><tr><td align="center" style="padding:48px 24px;"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;"><tr style="padding-bottom:32px;"><td align="center" style="padding-bottom:32px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:36px;height:36px;background:linear-gradient(135deg,#059669,#047857);border-radius:10px;text-align:center;vertical-align:middle;"><span style="font-size:18px;font-weight:800;color:#09090b;line-height:36px;">W</span></td><td style="padding-left:10px;font-size:18px;font-weight:700;color:#059669;letter-spacing:-0.5px;">Eventsli</td></tr></table></td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid rgba(5,150,105,0.08);border-radius:20px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:20px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="font-size:11px;font-weight:800;letter-spacing:0.2em;color:#09090b;text-transform:uppercase;">Order Placed (Awaiting Payment)</span></td></tr></table></td></tr><tr><td style="padding:36px;"><p style="margin:0 0 4px;font-size:14px;color:#a1a1aa;">Hi {{buyer_name}},</p><p style="margin:0 0 28px;font-size:14px;color:#f4f4f5;line-height:1.6;">Thank you for your order! To secure your tickets, please transfer the total amount using the instructions below within <strong>24 hours</strong>.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;border:1px solid rgba(255,255,255,0.06);border-radius:14px;margin-bottom:24px;"><tr><td style="padding:20px;"><h3 style="margin:0 0 16px;font-size:15px;color:#f4f4f5;">Order Details</h3><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:6px 0;font-size:13px;color:#71717a;width:120px;">🎬 Event</td><td style="padding:6px 0;font-size:13px;color:#f4f4f5;font-weight:500;">{{event_title}}</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#71717a;">🎫 Ticket</td><td style="padding:6px 0;font-size:13px;color:#059669;font-weight:600;">{{tier_name}} × {{quantity}}</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#71717a;">💰 Total Amount</td><td style="padding:6px 0;font-size:16px;color:#059669;font-weight:700;">{{total_amount}} {{currency}}</td></tr></table></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(5,150,105,0.04);border:1px solid rgba(5,150,105,0.15);border-radius:14px;margin-bottom:24px;"><tr><td style="padding:20px;"><h3 style="margin:0 0 12px;font-size:15px;color:#f4f4f5;">💸 Transfer Instructions</h3><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:6px 0;font-size:13px;color:#71717a;width:120px;">Method</td><td style="padding:6px 0;font-size:13px;color:#f4f4f5;font-weight:600;">{{payment_method}}</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#71717a;">Send To</td><td style="padding:6px 0;font-size:15px;color:#059669;font-weight:700;font-family:monospace;">{{transfer_destination}}</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#71717a;">Reference Code</td><td style="padding:6px 0;font-size:15px;color:#f59e0b;font-weight:700;font-family:monospace;letter-spacing:1px;">{{transfer_reference}}</td></tr></table><div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#a1a1aa;line-height:1.5;"><strong>Organizer Instructions:</strong><br/>{{transfer_instructions}}</div></td></tr></table><p style="font-size:12px;color:#71717a;line-height:1.6;margin-bottom:20px;">⚠️ <strong>Important:</strong> You must enter the exact Reference Code in your transfer note. Once sent, click <strong>"I''ve Sent the Payment"</strong> on the booking confirmation screen to notify the organizer.</p></td></tr></table></td></tr><tr><td align="center" style="padding-top:32px;"><p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">You received this email because you placed an order on Eventsli.<br/>If you didn''t place this order, please ignore this email.</p><p style="margin:16px 0 0;font-size:10px;color:#3f3f46;">© 2026 Eventsli. All rights reserved.</p></td></tr></table></td></tr></table></body></html>',
  'buyer_name, event_title, tier_name, quantity, total_amount, currency, payment_method, transfer_destination, transfer_reference, transfer_instructions',
  'buyer'
),

-- ── 2. Manual Order Pending Approval (to Organizer) ──
(
  'manual_order_pending_approval',
  'Manual Order Pending Approval (to Organizer)',
  '🟡 Action Required: Verify payment of {{total_amount}} {{currency}} for "{{event_title}}"',
  '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#09090b;font-family:''Helvetica Neue'',Arial,sans-serif;-webkit-font-smoothing:antialiased;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;"><tr><td align="center" style="padding:48px 24px;"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;"><tr style="padding-bottom:32px;"><td align="center" style="padding-bottom:32px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:36px;height:36px;background:linear-gradient(135deg,#059669,#047857);border-radius:10px;text-align:center;vertical-align:middle;"><span style="font-size:18px;font-weight:800;color:#09090b;line-height:36px;">W</span></td><td style="padding-left:10px;font-size:18px;font-weight:700;color:#059669;letter-spacing:-0.5px;">Eventsli</td></tr></table></td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid rgba(5,150,105,0.08);border-radius:20px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:20px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="font-size:11px;font-weight:800;letter-spacing:0.2em;color:#09090b;text-transform:uppercase;">Verify Payment Request</span></td></tr></table></td></tr><tr><td style="padding:36px;"><p style="margin:0 0 4px;font-size:14px;color:#a1a1aa;">Hi {{organizer_name}},</p><p style="margin:0 0 28px;font-size:14px;color:#f4f4f5;line-height:1.6;">A buyer has confirmed sending a manual transfer payment for your event <strong>"{{event_title}}"</strong>. Please verify the receipt of funds.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;border:1px solid rgba(255,255,255,0.06);border-radius:14px;margin-bottom:24px;"><tr><td style="padding:20px;"><h3 style="margin:0 0 16px;font-size:15px;color:#f4f4f5;">Transfer to Verify</h3><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:6px 0;font-size:13px;color:#71717a;width:120px;">👤 Buyer</td><td style="padding:6px 0;font-size:13px;color:#f4f4f5;font-weight:500;">{{buyer_name}} ({{buyer_phone}})</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#71717a;">💰 Amount Expected</td><td style="padding:6px 0;font-size:15px;color:#059669;font-weight:700;">{{total_amount}} {{currency}}</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#71717a;">🔑 Reference Code</td><td style="padding:6px 0;font-size:15px;color:#f59e0b;font-weight:700;font-family:monospace;letter-spacing:1px;">{{transfer_reference}}</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#71717a;">📱 Method</td><td style="padding:6px 0;font-size:13px;color:#f4f4f5;font-weight:500;">{{payment_method}}</td></tr></table>${buyer_notes ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#a1a1aa;line-height:1.5;"><strong>Buyer Note:</strong><br/>{{buyer_notes}}</div>` : ''}</td></tr></table><p style="font-size:12px;color:#71717a;line-height:1.6;margin-bottom:24px;">💡 <strong>How to verify:</strong> Open your mobile wallet or bank statement, check for a received transaction matching the expected amount, and match the Reference Code. Once confirmed, go to your Transfers dashboard to approve or reject the order.</p><table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#059669,#047857);"><a href="{{dashboard_url}}" target="_blank" style="display:inline-block;padding:16px 36px;font-size:14px;font-weight:700;color:#09090b;text-decoration:none;">Go to Transfers Dashboard →</a></td></tr></table></td></tr></table></td></tr><tr><td align="center" style="padding-top:32px;"><p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">You received this email because you are the organizer of this event on Eventsli.</p><p style="margin:16px 0 0;font-size:10px;color:#3f3f46;">© 2026 Eventsli. All rights reserved.</p></td></tr></table></td></tr></table></body></html>',
  'organizer_name, event_title, buyer_name, buyer_phone, total_amount, currency, payment_method, transfer_reference, buyer_notes, dashboard_url',
  'organizer'
),

-- ── 3. Manual Order Rejected (to Buyer) ──
(
  'manual_order_rejected',
  'Manual Order Rejected (to Buyer)',
  '❌ Payment Verification Failed: Order Rejected for "{{event_title}}"',
  '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#09090b;font-family:''Helvetica Neue'',Arial,sans-serif;-webkit-font-smoothing:antialiased;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;"><tr><td align="center" style="padding:48px 24px;"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;"><tr style="padding-bottom:32px;"><td align="center" style="padding-bottom:32px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:36px;height:36px;background:linear-gradient(135deg,#059669,#047857);border-radius:10px;text-align:center;vertical-align:middle;"><span style="font-size:18px;font-weight:800;color:#09090b;line-height:36px;">W</span></td><td style="padding-left:10px;font-size:18px;font-weight:700;color:#059669;letter-spacing:-0.5px;">Eventsli</td></tr></table></td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid rgba(5,150,105,0.08);border-radius:20px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#ef4444,#991b1b);padding:20px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="font-size:11px;font-weight:800;letter-spacing:0.2em;color:#f4f4f5;text-transform:uppercase;">Payment Rejected</span></td></tr></table></td></tr><tr><td style="padding:36px;"><p style="margin:0 0 4px;font-size:14px;color:#a1a1aa;">Hi {{buyer_name}},</p><p style="margin:0 0 28px;font-size:14px;color:#f4f4f5;line-height:1.6;">The event organizer was unable to verify your manual transfer payment for <strong>"{{event_title}}"</strong>. As a result, your order has been rejected and the reserved seats have been released.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fee2e2;border-radius:14px;margin-bottom:24px;"><tr><td style="padding:20px;"><h3 style="margin:0 0 8px;font-size:14px;color:#991b1b;font-weight:700;">Reason for Rejection</h3><p style="margin:0;font-size:13px;color:#b91c1c;line-height:1.5;">{{rejection_reason}}</p></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;border:1px solid rgba(255,255,255,0.06);border-radius:14px;margin-bottom:24px;"><tr><td style="padding:20px;"><h3 style="margin:0 0 16px;font-size:15px;color:#f4f4f5;">Rejected Order Details</h3><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:6px 0;font-size:13px;color:#71717a;width:120px;">🔑 Reference Code</td><td style="padding:6px 0;font-size:13px;color:#f4f4f5;font-weight:600;font-family:monospace;">{{transfer_reference}}</td></tr><tr><td style="padding:6px 0;font-size:13px;color:#71717a;">💰 Total Amount</td><td style="padding:6px 0;font-size:13px;color:#f4f4f5;font-weight:600;">{{total_amount}} {{currency}}</td></tr></table></td></tr></table><p style="font-size:12px;color:#71717a;line-height:1.6;margin:0;">If you believe this was in error, please check that you sent the transfer to the correct wallet/account and contact support or the event organizer with your transaction details.</p></td></tr></table></td></tr><tr><td align="center" style="padding-top:32px;"><p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">You received this email because you placed an order on Eventsli.</p><p style="margin:16px 0 0;font-size:10px;color:#3f3f46;">© 2026 Eventsli. All rights reserved.</p></td></tr></table></td></tr></table></body></html>',
  'buyer_name, event_title, rejection_reason, transfer_reference, total_amount, currency',
  'buyer'
),

-- ── 4. Ticket Delivery — Registered Users (to Buyer) ──
(
  'ticket_delivery_auth',
  'Ticket Delivery — Registered Users',
  '🎫 Your tickets for "{{event_title}}" are ready!',
  '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#09090b;font-family:''Helvetica Neue'',Arial,sans-serif;-webkit-font-smoothing:antialiased;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;"><tr><td align="center" style="padding:48px 24px;"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;"><tr style="padding-bottom:32px;"><td align="center" style="padding-bottom:32px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:36px;height:36px;background:linear-gradient(135deg,#059669,#047857);border-radius:10px;text-align:center;vertical-align:middle;"><span style="font-size:18px;font-weight:800;color:#09090b;line-height:36px;">W</span></td><td style="padding-left:10px;font-size:18px;font-weight:700;color:#059669;letter-spacing:-0.5px;">Eventsli</td></tr></table></td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid rgba(5,150,105,0.08);border-radius:20px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#059669,#047857);padding:20px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="font-size:11px;font-weight:800;letter-spacing:0.2em;color:#09090b;text-transform:uppercase;">Booking Confirmed ✓</span></td><td align="right"><span style="font-size:11px;font-weight:600;color:rgba(9,9,11,.5);">Order #${order_id}</span></td></tr></table></td></tr><tr><td style="padding:36px;"><p style="margin:0 0 4px;font-size:14px;color:#a1a1aa;">Hi {{buyer_name}},</p><p style="margin:0 0 28px;font-size:14px;color:#f4f4f5;line-height:1.6;">Your payment has been verified by the organizer! Your tickets are now confirmed and ready. Present your ticket QR code at the entrance for instant check-in.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;border:1px solid rgba(255,255,255,0.06);border-radius:14px;"><tr><td style="padding:24px;"><h2 style="margin:0 0 20px;font-size:18px;font-weight:700;color:#f4f4f5;line-height:1.3;">{{event_title}}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:8px 0;font-size:13px;color:#71717a;width:90px;vertical-align:top;">📅 Date</td><td style="padding:8px 0;font-size:13px;color:#f4f4f5;font-weight:500;">{{event_date}}</td></tr><tr><td style="padding:8px 0;font-size:13px;color:#71717a;vertical-align:top;">📍 Venue</td><td style="padding:8px 0;font-size:13px;color:#f4f4f5;font-weight:500;">{{event_venue}}</td></tr><tr><td style="padding:8px 0;font-size:13px;color:#71717a;vertical-align:top;">🎫 Ticket</td><td style="padding:8px 0;font-size:13px;color:#059669;font-weight:600;">{{tier_name}} × {{quantity}}</td></tr><tr><td colspan="2" style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);"></td></tr><tr><td style="padding:8px 0;font-size:14px;color:#71717a;font-weight:600;">Total</td><td style="padding:8px 0;font-size:18px;color:#059669;font-weight:700;">{{total_amount}} {{currency}}</td></tr></table></td></tr></table><table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin-top:28px;"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#059669,#047857);"><a href="{{ticket_link}}" target="_blank" style="display:inline-block;padding:16px 36px;font-size:14px;font-weight:700;color:#09090b;text-decoration:none;letter-spacing:-0.2px;">View My Tickets & QR Code →</a></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td style="padding:16px;background:rgba(5,150,105,0.04);border:1px solid rgba(5,150,105,0.08);border-radius:12px;"><p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.6;">💡 <strong>Pro tip:</strong> Bookmark your ticket link or take a screenshot of your QR code before arriving at the venue to ensure smooth entry even without a stable internet connection.</p></td></tr></table></td></tr></table></td></tr><tr><td align="center" style="padding-top:32px;"><p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">You received this email because you booked tickets on Eventsli.</p><p style="margin:16px 0 0;font-size:10px;color:#3f3f46;">© 2026 Eventsli. All rights reserved.</p></td></tr></table></td></tr></table></body></html>',
  'buyer_name, event_title, tier_name, quantity, total_amount, currency, event_date, event_venue, order_id, ticket_link',
  'buyer'
),

-- ── 5. Ticket Delivery — Guest Users (to Buyer) ──
(
  'ticket_delivery_guest',
  'Ticket Delivery — Guest Users',
  '🎫 Your tickets for "{{event_title}}" are ready!',
  '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#09090b;font-family:''Helvetica Neue'',Arial,sans-serif;-webkit-font-smoothing:antialiased;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;"><tr><td align="center" style="padding:48px 24px;"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;"><tr style="padding-bottom:32px;"><td align="center" style="padding-bottom:32px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:36px;height:36px;background:linear-gradient(135deg,#059669,#047857);border-radius:10px;text-align:center;vertical-align:middle;"><span style="font-size:18px;font-weight:800;color:#09090b;line-height:36px;">W</span></td><td style="padding-left:10px;font-size:18px;font-weight:700;color:#059669;letter-spacing:-0.5px;">Eventsli</td></tr></table></td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid rgba(5,150,105,0.08);border-radius:20px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#059669,#047857);padding:20px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="font-size:11px;font-weight:800;letter-spacing:0.2em;color:#09090b;text-transform:uppercase;">Guest Booking Confirmed ✓</span></td><td align="right"><span style="font-size:11px;font-weight:600;color:rgba(9,9,11,.5);">Order #${order_id}</span></td></tr></table></td></tr><tr><td style="padding:36px;"><p style="margin:0 0 4px;font-size:14px;color:#a1a1aa;">Hi {{buyer_name}},</p><p style="margin:0 0 28px;font-size:14px;color:#f4f4f5;line-height:1.6;">Your payment has been verified by the organizer! Since you purchased as a guest, <strong style="color:#059669;">save this email</strong> — the link below is your only way to access your tickets and QR codes.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;border:1px solid rgba(255,255,255,0.06);border-radius:14px;"><tr><td style="padding:24px;"><h2 style="margin:0 0 20px;font-size:18px;font-weight:700;color:#f4f4f5;line-height:1.3;">{{event_title}}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:8px 0;font-size:13px;color:#71717a;width:90px;vertical-align:top;">📅 Date</td><td style="padding:8px 0;font-size:13px;color:#f4f4f5;font-weight:500;">{{event_date}}</td></tr><tr><td style="padding:8px 0;font-size:13px;color:#71717a;vertical-align:top;">📍 Venue</td><td style="padding:8px 0;font-size:13px;color:#f4f4f5;font-weight:500;">{{event_venue}}</td></tr><tr><td style="padding:8px 0;font-size:13px;color:#71717a;vertical-align:top;">🎫 Ticket</td><td style="padding:8px 0;font-size:13px;color:#059669;font-weight:600;">{{tier_name}} × {{quantity}}</td></tr><tr><td colspan="2" style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);"></td></tr><tr><td style="padding:8px 0;font-size:14px;color:#71717a;font-weight:600;">Total</td><td style="padding:8px 0;font-size:18px;color:#059669;font-weight:700;">{{total_amount}} {{currency}}</td></tr></table></td></tr></table><table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin-top:28px;"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#059669,#047857);"><a href="{{ticket_link}}" target="_blank" style="display:inline-block;padding:16px 36px;font-size:14px;font-weight:700;color:#09090b;text-decoration:none;letter-spacing:-0.2px;">View My Tickets & QR Code →</a></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td style="padding:16px;background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,.1);border-radius:12px;"><p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.6;">⚠️ <strong>Important Guest Warning:</strong> You do not have an account. The link above is your <strong>only secure access link</strong> to present tickets. Do not share it. Bookmark this page immediately.</p></td></tr></table></td></tr></table></td></tr><tr><td align="center" style="padding-top:32px;"><p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">You received this email because you booked tickets on Eventsli.</p><p style="margin:16px 0 0;font-size:10px;color:#3f3f46;">© 2026 Eventsli. All rights reserved.</p></td></tr></table></td></tr></table></body></html>',
  'buyer_name, event_title, tier_name, quantity, total_amount, currency, event_date, event_venue, order_id, ticket_link',
  'buyer'
)
ON CONFLICT (name) DO UPDATE SET
  label = EXCLUDED.label,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  available_variables = EXCLUDED.available_variables,
  category = EXCLUDED.category;


-- ════════════ STEP 2: Update settle_commission RPC ════════════
-- Allows service_role calls by checking auth.role() and bypassing admin check.

CREATE OR REPLACE FUNCTION settle_commission(
  p_debt_id    UUID,
  p_amount     DECIMAL,
  p_method     TEXT,
  p_reference  TEXT DEFAULT NULL,
  p_proof_url  TEXT DEFAULT NULL,
  p_notes      TEXT DEFAULT NULL
) RETURNS JSONB AS $func$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_role TEXT;
  v_debt        RECORD;
  v_new_balance DECIMAL;
BEGIN
  -- Admin-only or service role check
  IF auth.role() = 'authenticated' THEN
    SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
    IF v_caller_role NOT IN ('admin', 'super_admin') THEN
      RETURN jsonb_build_object('error', 'Admin access required');
    END IF;
  ELSIF auth.role() = 'anon' THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be greater than 0');
  END IF;

  -- Validate method
  IF p_method NOT IN ('bank_transfer', 'stripe_deduction', 'admin_waiver', 'manual_cash') THEN
    RETURN jsonb_build_object('error', 'Invalid settlement method');
  END IF;

  -- Lock debt record
  SELECT * INTO v_debt
  FROM commission_debt WHERE id = p_debt_id
  FOR UPDATE;

  IF v_debt IS NULL THEN
    RETURN jsonb_build_object('error', 'Commission debt record not found');
  END IF;

  IF p_amount > v_debt.commission_balance THEN
    RETURN jsonb_build_object('error', 'Settlement amount exceeds outstanding balance',
      'balance', v_debt.commission_balance, 'attempted', p_amount);
  END IF;

  -- Record the settlement (audit log)
  INSERT INTO commission_settlements (
    debt_id, organizer_id, amount, method,
    reference, proof_url, verified_by, verified_at, notes
  ) VALUES (
    p_debt_id, v_debt.organizer_id, p_amount, p_method,
    p_reference, p_proof_url, CASE WHEN auth.role() = 'authenticated' THEN v_caller_id ELSE NULL END, now(), p_notes
  );

  -- Update the debt record
  v_new_balance := v_debt.commission_balance - p_amount;

  UPDATE commission_debt
  SET commission_paid    = commission_paid + p_amount,
      commission_balance = v_new_balance,
      last_settled_at    = now(),
      settlement_method  = p_method,
      settlement_reference = p_reference,
      -- If fully settled, unlock scanner and update status
      scanner_locked     = CASE WHEN v_new_balance <= 0 THEN false ELSE scanner_locked END,
      status             = CASE WHEN v_new_balance <= 0 THEN 'settled' ELSE status END,
      updated_at         = now()
  WHERE id = p_debt_id;

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'status', CASE WHEN v_new_balance <= 0 THEN 'settled' ELSE 'partial' END,
    'scanner_unlocked', v_new_balance <= 0,
    'message', CASE WHEN v_new_balance <= 0 THEN 'Commission debt fully settled' ELSE 'Partial settlement recorded' END
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 3: Manual Orders Notification Trigger Helper ════════════
-- Wrapper to send custom templates to explicit email recipients via Deno Edge Function.

CREATE OR REPLACE FUNCTION notify_manual_order_email(
  p_template_name TEXT,
  p_recipient_email TEXT,
  p_recipient_name TEXT,
  p_event_id UUID,
  p_variables JSONB,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS void AS $func$
DECLARE
  v_url TEXT := 'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1/send-notification';
  v_key TEXT;
BEGIN
  -- Read service role key from platform_settings
  SELECT value->>'service_role_key' INTO v_key
  FROM platform_settings
  WHERE key = 'notification_config';

  IF v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'notification_config.service_role_key not set in platform_settings — email skipped';
    RETURN;
  END IF;

  -- Fire async HTTP POST via pg_net
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'template_name', p_template_name,
      'recipients', jsonb_build_array(jsonb_build_object('email', p_recipient_email, 'name', p_recipient_name)),
      'event_id', p_event_id,
      'variables', p_variables,
      'context', p_context
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    )
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════ STEP 4: Trigger Function — Manual Order Changes ════════════
-- Triggers emails:
--   • INSERT: pending_payment → order created, send instructions
--   • UPDATE:
--       - pending_payment → pending_approval: send verification alert to organizer
--       - pending_approval → approved: send tickets (auth or guest)
--       - pending_approval/pending_payment → rejected: send rejection explanation

CREATE OR REPLACE FUNCTION trg_manual_order_notification()
RETURNS TRIGGER AS $func$
DECLARE
  v_event RECORD;
  v_tier RECORD;
  v_org RECORD;
  v_vars JSONB;
  v_origin TEXT := 'https://eventsli.com';
  v_order_id UUID;
BEGIN
  -- Read origin from platform_settings
  SELECT value->>'origin' INTO v_origin
  FROM platform_settings
  WHERE key = 'notification_config';
  IF v_origin IS NULL OR v_origin = '' THEN
    v_origin := 'https://eventsli.com';
  END IF;

  -- Get event, tier, and organizer details
  SELECT e.title, e.date, e.venue, e.organizer_id INTO v_event FROM events e WHERE e.id = NEW.event_id;
  SELECT tt.name INTO v_tier FROM ticket_tiers tt WHERE tt.id = NEW.tier_id;
  
  SELECT p.full_name as organizer_name, p.email as organizer_email
    FROM organizers org
    JOIN profiles p ON p.id = org.user_id
    WHERE org.user_id = v_event.organizer_id INTO v_org;

  -- ── CASE 1: AFTER INSERT (status = 'pending_payment') ──
  IF TG_OP = 'INSERT' AND NEW.status = 'pending_payment' THEN
    v_vars := jsonb_build_object(
      'buyer_name', NEW.buyer_name,
      'event_title', v_event.title,
      'tier_name', v_tier.name,
      'quantity', NEW.quantity,
      'total_amount', NEW.total_amount,
      'currency', NEW.currency,
      'payment_method', CASE 
        WHEN NEW.payment_method = 'vodafone_cash' THEN 'Vodafone Cash (Mobile Wallet)'
        WHEN NEW.payment_method = 'instapay' THEN 'InstaPay App'
        WHEN NEW.payment_method = 'bank_transfer' THEN 'Bank Transfer'
        WHEN NEW.payment_method = 'fawry' THEN 'Fawry Payment Reference'
        ELSE 'Manual Transfer'
      END,
      'transfer_destination', NEW.transfer_destination,
      'transfer_reference', NEW.transfer_reference,
      'transfer_instructions', COALESCE(NEW.buyer_notes, '')  -- We fallback if custom ones are inside notes
    );
    PERFORM notify_manual_order_email('manual_order_created', NEW.buyer_email, NEW.buyer_name, NEW.event_id, v_vars);
  END IF;

  -- ── CASE 2: AFTER UPDATE (status transitions) ──
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    
    -- ── 2a: pending_payment -> pending_approval (buyer confirmed payment) ──
    IF NEW.status = 'pending_approval' THEN
      v_vars := jsonb_build_object(
        'organizer_name', COALESCE(v_org.organizer_name, 'Organizer'),
        'event_title', v_event.title,
        'buyer_name', NEW.buyer_name,
        'buyer_phone', NEW.buyer_phone,
        'total_amount', NEW.total_amount,
        'currency', NEW.currency,
        'payment_method', NEW.payment_method::text,
        'transfer_reference', NEW.transfer_reference,
        'buyer_notes', COALESCE(NEW.buyer_notes, ''),
        'dashboard_url', v_origin || '/dashboard.html'
      );
      PERFORM notify_manual_order_email('manual_order_pending_approval', v_org.organizer_email, COALESCE(v_org.organizer_name, 'Organizer'), NEW.event_id, v_vars);
    
    -- ── 2b: pending_approval -> approved (organizer approved payment) ──
    ELSIF NEW.status = 'approved' THEN
      SELECT id INTO v_order_id FROM orders WHERE manual_transfer_order_id = NEW.id;

      IF NEW.user_id IS NOT NULL THEN
        -- Authenticated user ticket delivery
        v_vars := jsonb_build_object(
          'buyer_name', NEW.buyer_name,
          'event_title', v_event.title,
          'tier_name', v_tier.name,
          'quantity', NEW.quantity,
          'total_amount', NEW.total_amount,
          'currency', NEW.currency,
          'event_date', COALESCE(to_char(v_event.date, 'Day, Month DD, YYYY at HH12:MI AM'), 'TBD'),
          'event_venue', COALESCE(v_event.venue, 'TBD'),
          'order_id', v_order_id::text,
          'ticket_link', v_origin || '/my-tickets.html#guest_token=' || COALESCE(NEW.guest_token, '')
        );
        PERFORM notify_manual_order_email('ticket_delivery_auth', NEW.buyer_email, NEW.buyer_name, NEW.event_id, v_vars, jsonb_build_object('order_id', v_order_id));
      ELSE
        -- Guest ticket delivery
        v_vars := jsonb_build_object(
          'buyer_name', NEW.buyer_name,
          'event_title', v_event.title,
          'tier_name', v_tier.name,
          'quantity', NEW.quantity,
          'total_amount', NEW.total_amount,
          'currency', NEW.currency,
          'event_date', COALESCE(to_char(v_event.date, 'Day, Month DD, YYYY at HH12:MI AM'), 'TBD'),
          'event_venue', COALESCE(v_event.venue, 'TBD'),
          'order_id', v_order_id::text,
          'ticket_link', v_origin || '/my-tickets.html#guest_token=' || COALESCE(NEW.guest_token, '')
        );
        PERFORM notify_manual_order_email('ticket_delivery_guest', NEW.buyer_email, NEW.buyer_name, NEW.event_id, v_vars, jsonb_build_object('order_id', v_order_id));
      END IF;
      
    -- ── 2c: pending_approval/pending_payment -> rejected (organizer rejected payment) ──
    ELSIF NEW.status = 'rejected' THEN
      v_vars := jsonb_build_object(
        'buyer_name', NEW.buyer_name,
        'event_title', v_event.title,
        'rejection_reason', COALESCE(NEW.rejection_reason, 'No specific reason provided.'),
        'transfer_reference', NEW.transfer_reference,
        'total_amount', NEW.total_amount,
        'currency', NEW.currency
      );
      PERFORM notify_manual_order_email('manual_order_rejected', NEW.buyer_email, NEW.buyer_name, NEW.event_id, v_vars);
    
    END IF;
  END IF;

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach Trigger to manual_transfer_orders
DROP TRIGGER IF EXISTS trg_manual_order_notification_event ON manual_transfer_orders;
CREATE TRIGGER trg_manual_order_notification_event
  AFTER INSERT OR UPDATE ON manual_transfer_orders
  FOR EACH ROW
  EXECUTE FUNCTION trg_manual_order_notification();


-- ════════════ STEP 5: Trigger Function — Payout Failed Rollback ════════════
-- Self-healing database mechanism.
-- If a payout fails/cancels, we must refund the auto-deducted manual commission
-- debt by deleting the auto-generated settlements and restoring the balances.

CREATE OR REPLACE FUNCTION trg_payout_failed_rollback()
RETURNS TRIGGER AS $func$
DECLARE
  v_settlement RECORD;
  v_debt RECORD;
BEGIN
  -- Only roll back when moving from processing/pending to failed/cancelled
  IF OLD.status IN ('pending', 'processing') AND NEW.status IN ('failed', 'cancelled') AND NEW.platform_fees > 0 THEN
    RAISE NOTICE 'trg_payout_failed_rollback: payout % failed with platform_fees %. Rolling back auto-deductions...', NEW.id, NEW.platform_fees;

    -- Find all auto-settlements recorded for this payout ID
    FOR v_settlement IN
      SELECT * FROM commission_settlements
      WHERE reference = 'auto_payout_deduction_' || NEW.id::text
    LOOP
      -- Lock corresponding commission_debt row
      SELECT * INTO v_debt
      FROM commission_debt
      WHERE id = v_settlement.debt_id
      FOR UPDATE;

      IF v_debt IS NOT NULL THEN
        -- Restore the debt balance
        UPDATE commission_debt
        SET commission_paid    = commission_paid - v_settlement.amount,
            commission_balance = commission_balance + v_settlement.amount,
            -- If it was settled, mark it due/accruing again
            status             = 'due',
            updated_at         = now()
        WHERE id = v_debt.id;

        -- Delete the settlement record to complete the audit rollback
        DELETE FROM commission_settlements WHERE id = v_settlement.id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach Payout Rollback Trigger
DROP TRIGGER IF EXISTS trg_payout_rollback_event ON payouts;
CREATE TRIGGER trg_payout_rollback_event
  AFTER UPDATE ON payouts
  FOR EACH ROW
  EXECUTE FUNCTION trg_payout_failed_rollback();
