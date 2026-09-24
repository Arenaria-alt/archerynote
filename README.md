# ArcheryNote — v0.1

Notatnik łuczniczy ze zdjęcia tarczy. Maszyna rejestruje geometrię, człowiek wskazuje trafienia.

## Co działa w v0.1

- Wczytanie zdjęcia (aparat albo plik) → wykrycie 4 markerów ArUco (DICT_4X4_50, ID 0–3), przypisanie rogów **po położeniu w kadrze**, nie po ID.
- Balans bieli z białych i czarnych komórek markerów — bez tego zdjęcia wieczorne z 22.09 psuły klasyfikację kolorów.
- **Profil stanowiska** z pierwszego zdjęcia sesji: środek lica i korekta skali/owalności z dopasowania granic stref koloru (żółte/czerwone/niebieskie/czarne/białe).
- **Bramka** na każdym zdjęciu: ponowne dopasowanie granic i porównanie z profilem. ≤ 4 mm zielona, 4–8 mm żółta, > 8 mm lub skala > 3% czerwona. Przy braku markera komunikat, w którym rogu.
- Nakładka pierścieni rysowana z homografii, tapnięcie = strzała, przeciąganie z lupą, punktacja z promienia z regułą linii (`trzon_od_mm`), X, pudło.
- Zapis serii, statystyki sesji (suma, średnia, 10/X, pudła, środek grupy, σ, czas), eksport/import JSON.
- Rejestracja ręczna jako fallback: środek + 3 punkty na zewnętrznej krawędzi czarnego pola.

## Walidacja na zdjęciach z 22.09 (1200 × 1600, WhatsApp)

| | wynik |
| --- | --- |
| 4 markery wykryte | 24 / 25 (OpenCV: 23 / 25) |
| środki markerów vs OpenCV | 0,1–1,6 px |
| kalibracja udana (także ze strzałami) | 24 / 24 |
| odchyłka środka vs profil z jednego czystego zdjęcia | 0,3–1,7 mm |
| korekta skali przy rozstawie 606 × 718 | +0,4% ± 0,4% |
| czas na zdjęcie (desktop Chromium) | ok. 0,8–1,1 s |

Test czułości bramki: profil przesunięty o 3 mm → zielona, 6 mm → żółta, 10 mm → czerwona; skala +5% → czerwona.

## Struktura

```
index.html            gotowa aplikacja (składana przez build.py)
sw.js                 service worker — offline; podbij VERSION przy każdym wydaniu
manifest.webmanifest  instalacja jako aplikacja
src/core.js           detekcja markerów, homografia, kalibracja, punktacja (zero zależności)
src/app.html          interfejs
tests/regression.js   test na folderze zdjęć (Node + jpeg-js)
```

## Publikacja na GitHub Pages

1. Nowe repozytorium na GitHubie, np. `archerynote` (publiczne — Pages na darmowym koncie tego wymaga).
2. Wgraj zawartość tego folderu do katalogu głównego repo (Add file → Upload files albo `git push`).
3. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
4. Po minucie aplikacja jest pod `https://<login>.github.io/archerynote/`. Na iPhonie: Safari → Udostępnij → *Do ekranu początkowego*. Na Xiaomi: Chrome → menu → *Zainstaluj aplikację*.

## Czego jeszcze nie ma

- podgląd z kamery na żywo z zieloną/czerwoną siatką (rdzeń jest gotowy — 0,8 s na klatkę 2000 px trzeba zejść do ~960 px),
- IndexedDB i historia sesji (teraz: bieżąca sesja w localStorage + eksport),
- czas z EXIF (teraz: `lastModified` pliku),
- tryb poprawek po treningu i status sesji roboczej,
- raport postępów i trendy,
- 3-spot.

ARENARIA & Claude (Anthropic)
