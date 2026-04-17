/* ═══════════════════════════════════
   EVENT WAW — Professional Email Templates
   ═══════════════════════════════════
   Reusable across Edge Functions.
   Copy these into your Deno edge functions.
   ═══════════════════════════════════ */

// ── Shared design tokens ──
const BRAND = {
  name: 'Event Waw',
  color: '#D4AF37',
  colorDark: '#b8941f',
  bg: '#09090b',
  cardBg: '#18181b',
  text: '#f4f4f5',
  textMuted: '#a1a1aa',
  textDim: '#71717a',
  border: 'rgba(212,175,55,0.08)',
  borderLight: 'rgba(255,255,255,0.06)',
};

// ═════════════════════════════════
// Wrapper — used by all emails
// ═════════════════════════════════
function emailWrapper(content, footerLinks = true) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${BRAND.name}</title>
  <!--[if mso]><style>body,table,td{font-family:Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};">
    <tr><td align="center" style="padding:48px 24px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:36px;height:36px;background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});border-radius:10px;text-align:center;vertical-align:middle;">
              <span style="font-size:18px;font-weight:800;color:${BRAND.bg};line-height:36px;">W</span>
            </td>
            <td style="padding-left:10px;font-size:18px;font-weight:700;color:${BRAND.color};letter-spacing:-0.5px;">
              ${BRAND.name}
            </td>
          </tr></table>
        </td></tr>

        <!-- Content Card -->
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
            style="background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:20px;overflow:hidden;">
            ${content}
          </table>
        </td></tr>

        ${footerLinks ? `
        <!-- Footer -->
        <tr><td align="center" style="padding-top:32px;">
          <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">
            You received this email because you have an account on ${BRAND.name}.<br/>
            If you didn't expect this email, please ignore it.
          </p>
          <p style="margin:16px 0 0;font-size:10px;color:#3f3f46;">
            © ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
          </p>
        </td></tr>
        ` : ''}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ═════════════════════════════════
// 1. OTP — Login Verification
// ═════════════════════════════════
export function otpLoginEmail(code) {
  const content = `
    <tr><td style="padding:40px 36px;text-align:center;">
      <div style="width:56px;height:56px;margin:0 auto 20px;background:rgba(212,175,55,0.08);border-radius:50%;line-height:56px;text-align:center;">
        <span style="font-size:24px;">🔐</span>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${BRAND.text};">Login Verification</h1>
      <p style="margin:0 0 28px;font-size:14px;color:${BRAND.textMuted};line-height:1.6;">
        Enter this code to complete your sign-in:
      </p>
      <table role="presentation" align="center" cellpadding="0" cellspacing="0"
        style="background:${BRAND.bg};border:2px solid rgba(212,175,55,0.15);border-radius:16px;">
        <tr><td style="padding:20px 40px;">
          <span style="font-size:38px;font-weight:800;letter-spacing:10px;color:${BRAND.color};font-family:'Courier New',monospace;">
            ${code}
          </span>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:${BRAND.textDim};">
        ⏱ This code expires in <strong style="color:${BRAND.textMuted};">5 minutes</strong>
      </p>
    </td></tr>
  `;
  return emailWrapper(content);
}

// ═════════════════════════════════
// 2. OTP — Registration Verification
// ═════════════════════════════════
export function otpRegisterEmail(code, name) {
  const content = `
    <tr><td style="padding:40px 36px;text-align:center;">
      <div style="width:56px;height:56px;margin:0 auto 20px;background:rgba(212,175,55,0.08);border-radius:50%;line-height:56px;text-align:center;">
        <span style="font-size:24px;">✉️</span>
      </div>
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${BRAND.text};">Verify your email</h1>
      <p style="margin:0 0 28px;font-size:14px;color:${BRAND.textMuted};line-height:1.6;">
        Hi${name ? ' <strong style="color:' + BRAND.text + ';">' + name + '</strong>' : ''}, 
        welcome to ${BRAND.name}! Use this code to complete your registration:
      </p>
      <table role="presentation" align="center" cellpadding="0" cellspacing="0"
        style="background:${BRAND.bg};border:2px solid rgba(212,175,55,0.15);border-radius:16px;">
        <tr><td style="padding:20px 40px;">
          <span style="font-size:38px;font-weight:800;letter-spacing:10px;color:${BRAND.color};font-family:'Courier New',monospace;">
            ${code}
          </span>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:${BRAND.textDim};">
        ⏱ This code expires in <strong style="color:${BRAND.textMuted};">5 minutes</strong>
      </p>
    </td></tr>
  `;
  return emailWrapper(content);
}

// ═════════════════════════════════
// 3. Ticket Confirmation
// ═════════════════════════════════
export function ticketConfirmationEmail(data) {
  const { userName, eventTitle, tierName, quantity, totalAmount, eventVenue, eventDate, orderId, ticketLink } = data;
  const content = `
    <!-- Gold Header -->
    <tr><td style="background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});padding:20px 36px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="font-size:11px;font-weight:800;letter-spacing:0.2em;color:${BRAND.bg};text-transform:uppercase;">Booking Confirmed ✓</span></td>
        <td align="right"><span style="font-size:11px;font-weight:600;color:rgba(9,9,11,.5);">${orderId ? orderId.substring(0, 8) : ''}</span></td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:36px;">
      <p style="margin:0 0 4px;font-size:14px;color:${BRAND.textMuted};">Hi ${userName || 'there'},</p>
      <p style="margin:0 0 28px;font-size:14px;color:${BRAND.text};line-height:1.6;">
        Your tickets are confirmed! Show your QR code at the entrance for instant access.
      </p>

      <!-- Event Details Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:${BRAND.bg};border:1px solid ${BRAND.borderLight};border-radius:14px;">
        <tr><td style="padding:24px;">
          <h2 style="margin:0 0 20px;font-size:18px;font-weight:700;color:${BRAND.text};line-height:1.3;">
            ${eventTitle}
          </h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;font-size:13px;color:${BRAND.textDim};width:90px;vertical-align:top;">📅 Date</td>
              <td style="padding:8px 0;font-size:13px;color:${BRAND.text};font-weight:500;">${eventDate}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:13px;color:${BRAND.textDim};vertical-align:top;">📍 Venue</td>
              <td style="padding:8px 0;font-size:13px;color:${BRAND.text};font-weight:500;">${eventVenue}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:13px;color:${BRAND.textDim};vertical-align:top;">🎫 Ticket</td>
              <td style="padding:8px 0;font-size:13px;color:${BRAND.color};font-weight:600;">${tierName} × ${quantity}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding-top:16px;border-top:1px solid ${BRAND.borderLight};"></td>
            </tr>
            <tr>
              <td style="padding:8px 0;font-size:14px;color:${BRAND.textDim};font-weight:600;">Total</td>
              <td style="padding:8px 0;font-size:18px;color:${BRAND.color};font-weight:700;">${Number(totalAmount).toLocaleString()} EGP</td>
            </tr>
          </table>
        </td></tr>
      </table>

      <!-- CTA Button -->
      <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin-top:28px;">
        <tr><td style="border-radius:12px;background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});">
          <a href="${ticketLink || '#'}" target="_blank"
            style="display:inline-block;padding:16px 36px;font-size:14px;font-weight:700;color:${BRAND.bg};text-decoration:none;letter-spacing:-0.2px;">
            View My Tickets & QR Code →
          </a>
        </td></tr>
      </table>

      <!-- Important Note -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr><td style="padding:16px;background:rgba(212,175,55,0.04);border:1px solid ${BRAND.border};border-radius:12px;">
          <p style="margin:0;font-size:12px;color:${BRAND.textMuted};line-height:1.6;">
            💡 <strong style="color:${BRAND.text};">Pro tip:</strong> Take a screenshot of your QR code or save this email. 
            You'll need it when entering the event.
          </p>
        </td></tr>
      </table>
    </td></tr>
  `;
  return emailWrapper(content);
}

// ═════════════════════════════════
// 4. Welcome Email (after registration)
// ═════════════════════════════════
export function welcomeEmail(name, role) {
  const isOrganizer = role === 'organizer';
  const content = `
    <tr><td style="padding:40px 36px;text-align:center;">
      <div style="width:64px;height:64px;margin:0 auto 20px;background:linear-gradient(135deg,rgba(212,175,55,0.1),rgba(212,175,55,0.05));border-radius:50%;line-height:64px;">
        <span style="font-size:28px;">${isOrganizer ? '🎪' : '🎫'}</span>
      </div>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${BRAND.text};">
        Welcome to ${BRAND.name}${name ? ', ' + name : ''}!
      </h1>
      <p style="margin:0 0 28px;font-size:14px;color:${BRAND.textMuted};line-height:1.6;">
        ${isOrganizer
          ? 'Your organizer account is ready. Start creating unforgettable events and selling tickets in minutes.'
          : 'Your account is ready. Discover amazing events and book tickets with a seamless, premium experience.'
        }
      </p>
      <table role="presentation" align="center" cellpadding="0" cellspacing="0">
        <tr><td style="border-radius:12px;background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});">
          <a href="${isOrganizer ? '#/dashboard.html' : '#/events.html'}" target="_blank"
            style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:700;color:${BRAND.bg};text-decoration:none;">
            ${isOrganizer ? 'Go to Dashboard →' : 'Browse Events →'}
          </a>
        </td></tr>
      </table>
    </td></tr>

    ${isOrganizer ? `
    <!-- Quick Start Guide -->
    <tr><td style="padding:0 36px 36px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:${BRAND.bg};border:1px solid ${BRAND.borderLight};border-radius:14px;overflow:hidden;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid ${BRAND.borderLight};">
          <span style="font-size:12px;font-weight:700;letter-spacing:0.1em;color:${BRAND.textDim};text-transform:uppercase;">Quick Start</span>
        </td></tr>
        <tr><td style="padding:16px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:10px 0;font-size:13px;color:${BRAND.text};">
              <strong style="color:${BRAND.color};">1.</strong> Create your first event from the Dashboard
            </td></tr>
            <tr><td style="padding:10px 0;font-size:13px;color:${BRAND.text};">
              <strong style="color:${BRAND.color};">2.</strong> Add ticket tiers (General, VIP, VVIP)
            </td></tr>
            <tr><td style="padding:10px 0;font-size:13px;color:${BRAND.text};">
              <strong style="color:${BRAND.color};">3.</strong> Publish and start selling — payments go directly to you
            </td></tr>
            <tr><td style="padding:10px 0;font-size:13px;color:${BRAND.text};">
              <strong style="color:${BRAND.color};">4.</strong> Use the Scanner on event day for instant check-in
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
    ` : ''}
  `;
  return emailWrapper(content);
}
