// "Final": the yarns the user will actually stitch with. F01–F09 are measured from the user's photos of each ball on
// white paper (yarn_set_final/). Per photo, the paper beside or above the ball is mapped to a neutral white (238), which
// corrects both white balance and exposure; the color is the mean of the 50th–90th lightness percentile of a yarn patch
// clear of the label (the lit strands, without highlights). The names are invented on purpose (the user asked not to
// match them to any brand's names). F10 Laivasto is Novita 7 Veljestä 170 from the yarn card (js/novita.js).
// Aran weight, 100 g ≈ 200 m. code | name | R | G | B.
export const FINAL_RAW = `
F01|Raven|19|18|19
F02|Plum Bark|62|43|44
F03|Driftwood|104|78|66
F04|Fox|160|93|45
F05|Honeycomb|212|150|64
F06|Buttermilk|224|197|139
F07|Kingfisher|27|55|126
F08|Frost|115|129|147
F09|First Snow|186|176|171
F10|Laivasto|21|27|44
`;
