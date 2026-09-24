# Składa index.html z src/app.html + src/core.js (jeden plik, zero zależności).
# Po zmianie podbij VERSION w sw.js, żeby telefony pobrały nową wersję.
import pathlib
root = pathlib.Path(__file__).parent
app = (root / 'src/app.html').read_text(encoding='utf-8')
core = (root / 'src/core.js').read_text(encoding='utf-8')
(root / 'index.html').write_text(app.replace('/*CORE*/', core), encoding='utf-8')
print('index.html OK')
