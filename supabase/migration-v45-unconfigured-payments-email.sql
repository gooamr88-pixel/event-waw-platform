-- ═══════════════════════════════════════════════════════════════
-- EVENTSLI — Migration v45: Unconfigured Payments Email Template
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

INSERT INTO email_templates (name, label, subject, body_html, available_variables, category)
VALUES (
  'event_payments_unconfigured',
  'Event Published (Payments Unconfigured)',
  '⚠️ Action Required: Configure payment methods for "{{event_title}}"',
  '<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#09090b;font-family:''Helvetica Neue'',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;">
  <tr>
    <td align="center" style="padding:48px 24px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr style="padding-bottom:32px;">
          <td align="center" style="padding-bottom:32px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:36px;height:36px;background:linear-gradient(135deg,#ec4899,#8b5cf6);border-radius:10px;text-align:center;vertical-align:middle;">
                  <span style="font-size:18px;font-weight:800;color:#ffffff;line-height:36px;">E</span>
                </td>
                <td style="padding-left:10px;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Eventsli</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid rgba(236,72,153,0.08);border-radius:20px;overflow:hidden;">
              <tr>
                <td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:20px 36px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td><span style="font-size:11px;font-weight:800;letter-spacing:0.2em;color:#09090b;text-transform:uppercase;">Action Required</span></td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:36px;">
                  <p style="margin:0 0 4px;font-size:14px;color:#a1a1aa;">Hi {{organizer_name}},</p>
                  <p style="margin:0 0 20px;font-size:16px;font-weight:600;color:#f4f4f5;line-height:1.4;">Your event <strong>"{{event_title}}"</strong> has been successfully published!</p>
                  <p style="margin:0 0 28px;font-size:14px;color:#d4d4d8;line-height:1.6;">However, we noticed that you have not configured any payment methods for this event (Stripe or manual transfer payment options). <strong>Currently, buyers cannot purchase tickets for this event.</strong></p>
                  
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;border:1px solid rgba(255,255,255,0.06);border-radius:14px;margin-bottom:28px;">
                    <tr>
                      <td style="padding:20px;">
                        <h3 style="margin:0 0 12px;font-size:14px;color:#f4f4f5;">How to fix this:</h3>
                        <ol style="margin:0;padding-left:20px;font-size:13px;color:#a1a1aa;line-height:1.8;">
                          <li>Go to your <strong>Dashboard &rarr; Profile</strong>.</li>
                          <li>Scroll to <strong>Payment Methods</strong>.</li>
                          <li>Connect your Stripe account or add your manual wallets (e.g. Vodafone Cash, InstaPay, Fawry).</li>
                        </ol>
                        <p style="margin:12px 0 0 0;font-size:12px;color:#f59e0b;">💡 Once you add Stripe or manual wallets, your event will automatically activate and ticketing checkout will be instantly available to all buyers!</p>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" align="center" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="border-radius:12px;background:linear-gradient(135deg,#ec4899,#8b5cf6);">
                        <a href="{{dashboard_url}}" target="_blank" style="display:inline-block;padding:16px 36px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.2px;">Go to My Dashboard &rarr;</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:32px;">
            <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">You received this email because you are a registered event organizer on Eventsli.</p>
            <p style="margin:16px 0 0;font-size:10px;color:#3f3f46;">&copy; 2026 Eventsli. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>',
  'organizer_name, event_title, dashboard_url',
  'organizer'
)
ON CONFLICT (name) DO UPDATE SET
  label = EXCLUDED.label,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  available_variables = EXCLUDED.available_variables,
  category = EXCLUDED.category;
