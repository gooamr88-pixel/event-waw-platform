import glob, re, time

timestamp = int(time.time())

for filepath in glob.glob('*.html'):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Update image paths
    content = re.sub(r'images/logo-light-theme\.png(\?v=\d+)?', f'images/logo-light-theme.png?v={timestamp}', content)
    content = re.sub(r'images/logo-dark-theme\.png(\?v=\d+)?', f'images/logo-dark-theme.png?v={timestamp}', content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
