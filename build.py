# Składa index.html z src/app.html + src/core.js + src/stats.js (jeden plik, zero zależności).
# Po zmianie podbij VERSION w sw.js, żeby telefony pobrały nową wersję.
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
app = (src / 'app.html').read_text(encoding='utf-8')
for tag, f in (('/*CORE*/', 'core.js'), ('/*STATS*/', 'stats.js')):
    app = app.replace(tag, (src / f).read_text(encoding='utf-8'))
(root / 'index.html').write_text(app, encoding='utf-8')
print('index.html OK')
