from pathlib import Path
import json,zipfile
D=json.loads(Path('public/scout-data.json').read_text());week=D['meta']['week'];out=Path(f'output/pdf/week{week}-scout')
(out/'README.md').write_text(f'# Week {week} scout report\n\nOpen week{week}-scout-interactive.html directly in a browser. It embeds the matchup and model data and works offline. Copy the Markdown and PNGs into Obsidian. The PDF is a shareable preview.\n\nESPN read: '+D['meta']['rosterReadAt']+'\n\n'+D['meta']['statsCutoff']+'\n\n'+D['meta']['newsStatus']+'\n\nNo roster action executed.\n')
with zipfile.ZipFile(out/f'week{week}-scout-preview-bundle.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in [f'week{week}-scout-interactive.html',f'week{week}-scout-report.md',f'week{week}-scout-report.pdf','team-score-distributions.png','player-score-comparison.png','README.md','summary.json']:
  z.write(out/name,name)
print('Packaged public report artifacts only.')
