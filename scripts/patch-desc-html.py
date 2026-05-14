"""Fix the HTML description section in event-detail.html."""
import os

ed_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'event-detail.html')
with open(ed_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the line with "Description with See More"
target_start = None
for i, line in enumerate(lines):
    if '<!-- Description with See More -->' in line:
        target_start = i
        break

if target_start is None:
    print('[SKIP] Could not find description section marker')
else:
    # Find the closing </div> - it's 6 lines after (indices: 0=comment, 1=div open, 2=wrapper open, 3=p, 4=wrapper close, 5=button, 6=div close)
    target_end = target_start + 6  # inclusive

    replacement = [
        '          <!-- Short Description (blurb) -->\r\n',
        '          <div class="event-detail-section" id="ed-short-desc-section" style="display:none;">\r\n',
        '            <p id="event-short-description" style="font-size:1.05rem;line-height:1.7;color:var(--text-primary);font-weight:500;padding:20px 24px;background:rgba(5,150,105,.04);border-left:4px solid rgba(5,150,105,.4);border-radius:0 12px 12px 0;"></p>\r\n',
        '          </div>\r\n',
        '\r\n',
        '          <!-- Full Description with See More -->\r\n',
        '          <div class="event-detail-section" id="ed-full-desc-section">\r\n',
        '            <h2 style="font-family:var(--font-serif);font-size:1.1rem;font-weight:700;margin-bottom:16px;">\U0001f4dd About This Event</h2>\r\n',
        '            <div id="event-description-wrap" class="ed-desc-wrap">\r\n',
        '              <p id="event-description" style="color:var(--text-secondary);line-height:1.8;font-size:0.95rem;">Loading event details\u2026</p>\r\n',
        '            </div>\r\n',
        '            <button id="desc-toggle" class="ed-see-more" style="display:none;">See more</button>\r\n',
        '          </div>\r\n',
    ]

    new_lines = lines[:target_start] + replacement + lines[target_end + 1:]

    with open(ed_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f'[OK] Replaced lines {target_start+1}-{target_end+1} with short+full description sections')
