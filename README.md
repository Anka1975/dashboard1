# Dashboard

Statyczny dashboard w `index.html`, publikowany przez GitHub Pages. Dotychczasowe
zakładki korzystają z plików XLSX w repozytorium.

## Roadmapa i prognozy

Nowa zakładka pozwala definiować kompetencje, zespoły i co najmniej dwie inicjatywy.
Każda inicjatywa ma uporządkowaną listę elementów, wymagane kompetencje, a każdy
element: zespół, najwcześniejszą datę startu, estymaty min/max dla każdej kompetencji
i opcjonalny termin graniczny **fixed date**. Zespół elementu musi posiadać wszystkie
wymagane kompetencje.

- Estymaty: osobodni pracy danej kompetencji przy pełnej dostępności jednej osoby.
- Capacity: osobodni zespołu i kompetencji w miesiącu, przez 12 miesięcy od bieżącego
  miesiąca. Nowe miesiące i nowo dodane kompetencje mają zerowe capacity.
  Urlopy i dni wolne należy odjąć od wpisywanych wartości. Model rozkłada capacity
  równomiernie na dni kalendarzowe. Nie należy wielokrotnie liczyć tej samej osoby
  w różnych pulach kompetencji.
- Monte Carlo: 2000 niezależnych przebiegów, niezależne jednostajne losowanie pracy
  między min/max. Elementy inicjatywy są sekwencyjne; kompetencje elementu i różne
  inicjatywy pracują równolegle. Przy konflikcie capacity decyduje kolejność
  inicjatyw, zmieniana strzałkami. Kolejny element rusza najwcześniej następnego dnia.
- Gantt i tabela: P50 startu, P50/P85 końca, odsetek ukończeń w horyzoncie i szansa
  dotrzymania fixed date. P85 jest najwcześniejszą datą obejmującą co najmniej 85%
  przebiegów, wraz z nieukończonymi jako wynikami poza horyzontem. Dla całej
  inicjatywy pokazany jest P85 jej ostatniego elementu.
- Fixed date jest terminem, nie wymuszoną datą ukończenia. Nie zmienia priorytetu.
  Jeśli termin wykracza poza kalendarz capacity, podana szansa jest dolną granicą.
  Brak P85 nie oznacza braku pracy, tylko zbyt mało ukończeń w horyzoncie.

Dane wejściowe są zapisywane w `localStorage` przeglądarki, nie na serwerze ani
w repozytorium; nie są współdzielone między urządzeniami. Pierwsze otwarcie zawiera
edytowalny przykład. Wyniki należy przeliczyć po zmianie danych lub ponownym
otwarciu strony. To model planistyczny, nie gwarancja terminów.

## Uruchomienie lokalne

Uruchom serwer statyczny w katalogu repozytorium, np. `python3 -m http.server 8000`,
i otwórz `http://localhost:8000`. Dotychczasowe wykresy wymagają dostępu do CDN
Chart.js i SheetJS; nowa zakładka nie ma zewnętrznych zależności.

Testy silnika prognozowania: `node --test roadmap-engine.test.cjs`.
