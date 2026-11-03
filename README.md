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

Dane wejściowe zalogowanego użytkownika są automatycznie zapisywane w Cloud
Firestore, w dokumencie `users/{uid}/plans/roadmap`. Każde konto Google ma własny
prywatny plan, dostępny na innych urządzeniach po zalogowaniu na to samo konto.
Stan zapisu i błędy są widoczne nad edytorem. Przy błędzie zmiany pozostają tylko
w otwartej karcie: użyj „Ponów zapis” przed jej zamknięciem. Równoczesna edycja na
innym urządzeniu lub w innej karcie powoduje konflikt zamiast nadpisania nowszego
planu; zachowaj swoje zmiany i użyj „Wczytaj ponownie z bazy”.

Bez logowania działa dotychczasowy zapis w `localStorage`, tylko w tej
przeglądarce. Plan lokalny nie jest automatycznie przypisywany do konta.
Przycisk „Importuj lokalny plan do konta” przenosi go po potwierdzeniu,
zastępując plan konta. Plany z kont nie są kopiowane do lokalnego planu gościa.
Pierwsze otwarcie zawiera edytowalny przykład. Wyniki należy przeliczyć po zmianie
danych lub ponownym otwarciu strony. To model planistyczny, nie gwarancja terminów.

## Konfiguracja Firebase (wymagana przed korzystaniem z bazy)

Strona publiczna: https://anka1975.github.io/dashboard1/.
Konfiguracja aplikacji webowej projektu `dashboard1-ef52e` znajduje się
w `roadmap-cloud.js`. Nie wymaga Analytics ani Firebase Hosting. Konfiguracja
webowa jest publiczna; ochronę danych zapewniają logowanie i reguły Firestore,
nie ukrywanie `apiKey`. Nie dodawaj do repozytorium kluczy kont usług.

W konsoli Firebase:

1. W **Authentication → Sign-in method** włącz dostawcę **Google** i ustaw adres
   kontaktowy projektu.
2. W **Authentication → Settings → Authorized domains** dodaj
   `anka1975.github.io`. Do testów lokalnych dodaj również `localhost`.
3. Utwórz bazę **Cloud Firestore** o identyfikatorze `(default)` w trybie
   produkcyjnym, najlepiej w regionie UE.
4. W **Firestore Database → Rules** wklej całą zawartość pliku
   [`firestore.rules`](./firestore.rules) i kliknij **Publish**. Nie używaj reguł
   pozwalających wszystkim na odczyt lub zapis. Dostęp jest dozwolony wyłącznie
   właścicielowi dokumentu; pozostałe ścieżki są domyślnie zablokowane.

Alternatywnie reguły może wdrożyć właściciel projektu z Firebase CLI:
`firebase login`, następnie
`firebase deploy --only firestore:rules --project dashboard1-ef52e`.
Samo opublikowanie strony przez GitHub Pages **nie publikuje reguł Firebase**.

Po konfiguracji zaloguj się na stronie, zmień plan i poczekaj na komunikat
„Zapisano prywatny plan w Firebase”. Na drugim urządzeniu zaloguj się na to samo
konto i sprawdź dane. Inne konto powinno otrzymać osobny plan. W Firestore Rules
Playground sprawdź też, że anonimowy użytkownik i inne UID nie mogą odczytać ani
zapisać dokumentu właściciela.

## Uruchomienie lokalne

Uruchom serwer statyczny w katalogu repozytorium, np. `python3 -m http.server 8000`,
i otwórz `http://localhost:8000`. Dotychczasowe wykresy wymagają dostępu do CDN
Chart.js i SheetJS; zapis w chmurze wymaga Firebase SDK pobieranego z
`www.gstatic.com` oraz połączenia z usługami Firebase. Przy niedostępnym SDK
strona pokazuje błąd i udostępnia tylko plan lokalny.

Testy silnika prognozowania: `node --test roadmap-engine.test.cjs`.
Testy integracji zapisu (z atrapami Firebase, bez dostępu do produkcyjnej bazy):
`node --experimental-vm-modules --test roadmap-cloud.test.cjs roadmap.test.cjs`.
