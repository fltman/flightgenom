# flightgenom — att göra förseningarnas dominoeffekt synlig

En enskild försenad flygning stannar sällan vid sig själv. Samma flygplan ska
vidare till nästa sträcka, andra avgångar väntar på dess passagerare och
besättning, och på några timmar kan en morgonförsening i en ände av Europa ha
spridit sig till dussintals flygningar i en annan. Den kedjan är i praktiken
osynlig i dag: vi ser att enskilda flygningar är försenade, men inte hur de
hänger ihop eller var problemet egentligen började.

flightgenom är en realtidskarta över flygtrafiken byggd kring just den frågan.
Varje försenad flygning bär med sig sitt *förseningsgenom* — ID:t på alla
flygningar uppströms som bidragit till dess försening. Därmed går det att klicka
på vilket plan som helst och spåra förseningen bakåt till sin ursprungskälla,
och framåt till varje flygning och passagerare som drabbas nedströms.

Det gör en annars osynlig orsakskedja både synlig och mätbar:

- Kausala kaskadträd som visar hela spridningen från en enda störning.
- En topplista över dagens mest följdrika förseningar, och en värmekarta över
  var ny försening faktiskt uppstår i nätverket.
- Möjlighet att markera en störning och direkt se vilka plan i luften som hör
  till samma kaskad.
- En AI-analytiker som sammanfattar nätverksläget, pekar ut de känsligaste
  flaskhalsarna och uppskattar den samlade kostnaden i förlorad restid.

Positionerna är riktiga och hämtas live via ADS-B. Genomet är i nuläget
simulerat, men arkitekturen är förberedd för att kopplas mot verklig schema- och
rotationsdata för ett genom byggt på faktiska flygningar.

Byggt med Claude Code, från idé till färdig demo.

github.com/fltman/flightgenom
