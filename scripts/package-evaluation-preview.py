"""Package public model audit artifacts for offline browser and Obsidian use."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
folder = root / 'output/evaluation/2026-model-performance'
readme = folder / 'README.txt'
readme.write_text('Open model-performance-interactive.html in a browser: all chart data and gallery graphics are embedded.\nFor Obsidian, extract this folder into your vault and open model-performance.md.\nPDF and CSV are included. Weeks 1-5 are causal historical replays; saved Week 5 forecasts are reported separately.\n')
names = ['model-performance-interactive.html', 'model-performance.md', 'model-performance.pdf', 'player-week-results.csv', 'summary.json', 'calibration-manifest.json', 'repair-comparison.json', 'README.txt']
paths = [folder / name for name in names] + sorted(folder.glob('*.png'))
with ZipFile(folder / 'model-performance-preview-bundle.zip', 'w', ZIP_DEFLATED) as bundle:
    for path in paths:
        bundle.write(path, 'model-performance/' + path.name)
print('Packaged public model-performance artifacts.')
